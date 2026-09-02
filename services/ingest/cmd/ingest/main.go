package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"

	"openrum/internal/config"
	"openrum/internal/httpx"
	"openrum/internal/ingest"
	"openrum/internal/metadata"
	"openrum/internal/observability"
	"openrum/internal/service"
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
	redisClient := redis.NewClient(&redis.Options{Addr: configuration.RedisAddress})
	authenticator := ingest.NewCachedAuthenticator(metadata.NewProjectKeyRepository(database))
	limiter := ingest.NewRedisRateLimiter(redisClient)
	producer := ingest.NewKafkaProducer(configuration.KafkaBrokers, configuration.KafkaEventTopic)
	metrics, err := ingestservice.NewMetrics(registry)
	if err != nil {
		_ = producer.Close()
		_ = redisClient.Close()
		_ = database.Close()
		return nil, err
	}
	handler := ingestservice.NewHandler(authenticator, limiter, ingestservice.NewKafkaAcceptor(producer), logger, ingestservice.WithMetrics(metrics))
	router.Handle("POST /ingest/v1/envelope", http.HandlerFunc(handler.ServeHTTP))
	router.Handle("OPTIONS /ingest/v1/envelope", http.HandlerFunc(handler.ServeHTTP))
	return func() error {
		return errors.Join(database.Close(), redisClient.Close(), producer.Close())
	}, nil
}
