package main

import (
	"context"
	"errors"
	"log"
	"sync"
	"time"

	"github.com/rs/zerolog"

	"openrum/internal/config"
	"openrum/internal/httpx"
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
	metrics, err := consumerservice.NewMetrics(registry)
	if err != nil {
		return nil, err
	}
	connectCtx, cancelConnect := context.WithTimeout(ctx, 5*time.Second)
	defer cancelConnect()
	writerOptions := consumerservice.DefaultClickHouseWriterOptions()
	writerOptions.Observer = metrics
	writer, err := consumerservice.OpenBufferedClickHouseWriter(connectCtx, configuration.ClickHouseDSN, writerOptions)
	if err != nil {
		return nil, err
	}
	deadLetters := consumerservice.NewKafkaDeadLetterSink(configuration.KafkaBrokers, configuration.KafkaEventTopic+".dlq")
	workerCtx, cancelWorkers := context.WithCancel(ctx)
	const workerCount = 4
	consumers := make([]*consumerservice.Consumer, 0, workerCount)
	var workers sync.WaitGroup
	for range workerCount {
		source := consumerservice.NewKafkaMessageSource(configuration.KafkaBrokers, configuration.KafkaEventTopic, "openrum-consumer-v1")
		consumer := consumerservice.NewConsumer(source, writer, deadLetters, consumerservice.WithMetrics(metrics))
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
		closeErrors = append(closeErrors, deadLetters.Close(), writer.Close())
		return errors.Join(closeErrors...)
	}, nil
}
