package main

import (
	"context"
	"errors"
	"log"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"

	"openrum/internal/config"
	"openrum/internal/httpx"
	"openrum/internal/ingest"
	"openrum/internal/metadata"
	"openrum/internal/observability"
	"openrum/internal/service"
	consumerservice "openrum/services/consumer/internal"
)

func main() {
	if err := service.MainWithRoutes(config.ServiceConsumer, registerRoutes); err != nil {
		log.Fatal(err)
	}
}

func registerRoutes(ctx context.Context, _ *httpx.Router, configuration config.Config, logger zerolog.Logger, registry *observability.MetricsRegistry) (func() error, error) {
	metrics, err := consumerservice.NewMetrics(registry, configuration.KafkaRetention)
	if err != nil {
		return nil, err
	}
	connectCtx, cancelConnect := context.WithTimeout(ctx, 5*time.Second)
	defer cancelConnect()
	writerOptions := consumerservice.DefaultClickHouseWriterOptions()
	writerOptions.FlushInterval = configuration.ConsumerFlushInterval
	writerOptions.Observer = metrics
	redisClient := redis.NewClient(&redis.Options{Addr: configuration.RedisAddress, ContextTimeoutEnabled: true})
	writerOptions.ConnectionStatus = ingest.NewRedisConnectionStatus(redisClient)
	metadataDatabase, err := metadata.OpenPostgres(connectCtx, configuration.PostgresDSN)
	if err != nil {
		_ = redisClient.Close()
		return nil, err
	}
	writer, err := consumerservice.OpenBufferedClickHouseWriter(connectCtx, configuration.ClickHouseDSN, writerOptions)
	if err != nil {
		_ = metadataDatabase.Close()
		_ = redisClient.Close()
		return nil, err
	}
	retentionPolicies := consumerservice.NewCachedRetentionPolicyProvider(
		metadata.NewProjectConfigRepository(metadataDatabase), configuration.SystemSettings, 30*time.Second,
	)
	// Shared across workers so one project's settings are compiled once, not
	// once per worker goroutine.
	inboundFilters := consumerservice.NewCachedFilterSettingsProvider(
		metadata.NewProjectFilterRepository(metadataDatabase), 30*time.Second,
	)
	processingRules := consumerservice.NewCachedProcessingSettingsProvider(
		metadata.NewProjectProcessingRepository(metadataDatabase), 30*time.Second,
	)
	deadLetters := consumerservice.NewKafkaDeadLetterSink(configuration.KafkaBrokers, configuration.KafkaEventTopic+".dlq")
	workerCtx, cancelWorkers := context.WithCancel(ctx)
	// More workers can fill shared ClickHouse batches across Kafka partitions.
	// Keep the default conservative; size this against partition count and CPU.
	workerCount := configuration.ConsumerWorkers
	consumers := make([]*consumerservice.Consumer, 0, workerCount)
	var workers sync.WaitGroup
	for range workerCount {
		source := consumerservice.NewKafkaMessageSource(configuration.KafkaBrokers, configuration.KafkaEventTopic, "openrum-consumer-v1")
		consumer := consumerservice.NewConsumer(source, writer, deadLetters,
			consumerservice.WithMetrics(metrics), consumerservice.WithRetentionPolicies(retentionPolicies),
			consumerservice.WithInboundFilters(inboundFilters),
			consumerservice.WithProcessingRules(processingRules))
		consumers = append(consumers, consumer)
		workers.Add(1)
		go func() {
			defer workers.Done()
			if runErr := consumer.Run(workerCtx); runErr != nil {
				logger.Error().Err(runErr).Msg("consumer worker stopped")
			}
		}()
	}
	return func() error {
		cancelWorkers()
		closeErrors := make([]error, 0, len(consumers)+2)
		for _, consumer := range consumers {
			closeErrors = append(closeErrors, consumer.Close())
		}
		workers.Wait()
		closeErrors = append(closeErrors, deadLetters.Close(), writer.Close(), redisClient.Close(), metadataDatabase.Close())
		return errors.Join(closeErrors...)
	}, nil
}
