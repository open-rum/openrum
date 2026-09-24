package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"

	"openrum/internal/clientip"
	"openrum/internal/config"
	"openrum/internal/geo"
	"openrum/internal/httpx"
	"openrum/internal/ingest"
	"openrum/internal/metadata"
	"openrum/internal/migrate"
	"openrum/internal/observability"
	"openrum/internal/service"
	"openrum/internal/storagepressure"
	ingestservice "openrum/services/ingest/internal"
)

func main() {
	if err := service.MainWithRoutes(config.ServiceIngest, registerRoutes); err != nil {
		log.Fatal(err)
	}
}

func registerRoutes(ctx context.Context, router *httpx.Router, configuration config.Config, logger zerolog.Logger, registry *observability.MetricsRegistry) (func() error, error) {
	connectCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	database, err := metadata.OpenPostgres(connectCtx, configuration.PostgresDSN)
	if err != nil {
		return nil, err
	}
	redisClient := redis.NewClient(&redis.Options{Addr: configuration.RedisAddress, ContextTimeoutEnabled: true})
	authenticator := ingest.NewCachedAuthenticator(metadata.NewProjectKeyRepository(database))
	limiter := ingest.NewRedisRateLimiter(redisClient)
	connectionStatus := ingest.NewRedisConnectionStatus(redisClient)
	producer := ingest.NewKafkaProducer(configuration.KafkaBrokers, configuration.KafkaEventTopic)
	metrics, err := ingestservice.NewMetrics(registry)
	if err != nil {
		_ = producer.Close()
		_ = redisClient.Close()
		_ = database.Close()
		return nil, err
	}
	var pressureDatabase interface{ Close() error }
	handlerOptions := []ingestservice.HandlerOption{
		ingestservice.WithMetrics(metrics),
		ingestservice.WithConnectionStatus(connectionStatus),
	}
	if configuration.StoragePressure.Enabled {
		if configuration.ClickHouseDSN == "" {
			_ = producer.Close()
			_ = redisClient.Close()
			_ = database.Close()
			return nil, errors.New("CLICKHOUSE_DSN is required when the storage-pressure guard is enabled")
		}
		clickHouse, openErr := migrate.OpenClickHouse(configuration.ClickHouseDSN)
		if openErr != nil {
			_ = producer.Close()
			_ = redisClient.Close()
			_ = database.Close()
			return nil, openErr
		}
		pressureDatabase = clickHouse
		pressureMonitor := storagepressure.NewMonitor(
			storagepressure.SQLCapacityReader{Database: clickHouse}, configuration.StoragePressure,
		)
		if registerErr := storagepressure.RegisterMetrics(registry, pressureMonitor); registerErr != nil {
			_ = clickHouse.Close()
			_ = producer.Close()
			_ = redisClient.Close()
			_ = database.Close()
			return nil, registerErr
		}
		go pressureMonitor.Run(ctx)
		handlerOptions = append(handlerOptions, ingestservice.WithStoragePressureGate(pressureMonitor))
	}
	// A development stack has no edge to declare, and the peer address of a
	// request from the host to a published port differs by platform, so trust
	// there is decided by the environment rather than by address.
	countries := geo.NewForDevelopment(configuration.GeoCountryHeader)
	if configuration.AppEnv != "development" {
		countries, err = geo.New(configuration.GeoCountryHeader, configuration.GeoTrustedProxies)
		if err != nil {
			if pressureDatabase != nil {
				_ = pressureDatabase.Close()
			}
			_ = producer.Close()
			_ = redisClient.Close()
			_ = database.Close()
			return nil, err
		}
	}
	// Declaring the edge is opt-in and has no development relaxation: unlike a
	// country, the rate-limit identity is what keeps one caller from occupying
	// the whole limit, so an undeclared edge keeps the identity on the socket
	// peer rather than believing a header.
	callers, err := clientip.New(configuration.IngestTrustedProxies)
	if err != nil {
		if pressureDatabase != nil {
			_ = pressureDatabase.Close()
		}
		_ = producer.Close()
		_ = redisClient.Close()
		_ = database.Close()
		return nil, err
	}
	handlerOptions = append(handlerOptions, ingestservice.WithGeoResolver(countries), ingestservice.WithClientIPResolver(callers))
	handler := ingestservice.NewHandler(authenticator, limiter, ingestservice.NewKafkaAcceptor(producer), logger, handlerOptions...)
	router.Handle("POST /ingest/v1/envelope", http.HandlerFunc(handler.ServeHTTP))
	router.Handle("OPTIONS /ingest/v1/envelope", http.HandlerFunc(handler.ServeHTTP))
	return func() error {
		var pressureErr error
		if pressureDatabase != nil {
			pressureErr = pressureDatabase.Close()
		}
		return errors.Join(database.Close(), redisClient.Close(), producer.Close(), pressureErr)
	}, nil
}
