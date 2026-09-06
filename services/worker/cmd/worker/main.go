package main

import (
	"context"
	"errors"
	"log"
	"time"

	"github.com/rs/zerolog"

	"openrum/internal/config"
	"openrum/internal/httpx"
	"openrum/internal/metadata"
	"openrum/internal/migrate"
	"openrum/internal/observability"
	"openrum/internal/service"
	"openrum/internal/sourcemap"
	worker "openrum/services/worker/internal"
)

func main() {
	if err := service.MainWithRoutes(config.ServiceWorker, registerWorker); err != nil {
		log.Fatal(err)
	}
}

func registerWorker(ctx context.Context, _ *httpx.Router, configuration config.Config, logger zerolog.Logger, _ *observability.MetricsRegistry) (func() error, error) {
	connectCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	database, err := metadata.OpenPostgres(connectCtx, configuration.PostgresDSN)
	if err != nil {
		return nil, err
	}
	clickHouse, err := migrate.OpenClickHouse(configuration.ClickHouseDSN)
	if err != nil {
		_ = database.Close()
		return nil, err
	}
	storage, _, err := sourcemap.NewConfiguredStorage(connectCtx, configuration)
	if err != nil {
		_ = database.Close()
		_ = clickHouse.Close()
		return nil, err
	}
	deletionJob := worker.NewProjectDeletionJob(worker.NewPostgresProjectDeletionStore(database), worker.NewClickHouseProjectDeleter(clickHouse), storage)
	retentionJob := worker.NewRetentionCleanupJob(metadata.NewMaintenanceJobRepository(database), worker.NewClickHouseRetentionCleaner(clickHouse))
	if storage != nil {
		mapper := sourcemap.NewMapper(sourcemap.NewArtifactCatalog(database), storage, sourcemap.NewCache(256<<20))
		job := worker.NewSourceMapJob(worker.NewClickHouseMappings(clickHouse), mapper)
		go runSourceMapWorker(ctx, job, logger)
	} else {
		logger.Info().Msg("object storage is disabled; source map processing is paused")
	}
	go runProjectDeletionWorker(ctx, deletionJob, logger)
	go runRetentionWorker(ctx, retentionJob, logger)
	return func() error { return errors.Join(database.Close(), clickHouse.Close()) }, nil
}

func runRetentionWorker(ctx context.Context, job *worker.RetentionCleanupJob, logger zerolog.Logger) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		jobCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
		processed, err := job.RunOne(jobCtx)
		cancel()
		if err != nil && !errors.Is(err, context.Canceled) {
			logger.Error().Err(err).Msg("retention cleanup step failed")
		} else if processed {
			logger.Info().Msg("retention cleanup step completed")
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func runProjectDeletionWorker(ctx context.Context, job *worker.ProjectDeletionJob, logger zerolog.Logger) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		jobCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
		processed, err := job.RunOne(jobCtx)
		cancel()
		if err != nil && !errors.Is(err, context.Canceled) {
			logger.Error().Err(err).Msg("project deletion failed")
		} else if processed {
			logger.Info().Msg("project deletion completed")
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func runSourceMapWorker(ctx context.Context, job *worker.SourceMapJob, logger zerolog.Logger) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		batchCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
		processed, err := job.RunBatch(batchCtx, worker.MaxBatchSize)
		cancel()
		if err != nil && !errors.Is(err, context.Canceled) {
			logger.Error().Err(err).Msg("source map batch failed")
		} else if processed > 0 {
			logger.Info().Int("processed", processed).Msg("source map batch completed")
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
