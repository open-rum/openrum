package main

import (
	"context"
	"errors"
	"log"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"

	"openrum/internal/config"
	openrumcrypto "openrum/internal/crypto"
	"openrum/internal/httpx"
	"openrum/internal/metadata"
	"openrum/internal/migrate"
	"openrum/internal/observability"
	"openrum/internal/service"
	"openrum/internal/servicehealth"
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
	dataPurgeJob := worker.NewProjectDataPurgeJob(worker.NewPostgresProjectDataPurgeStore(database), worker.NewClickHouseProjectDeleter(clickHouse), storage)
	retentionJob := worker.NewRetentionCleanupJob(metadata.NewMaintenanceJobRepository(database), worker.NewClickHouseRetentionCleaner(clickHouse))
	emergencyCleanupJob := worker.NewEmergencyCleanupJob(
		metadata.NewEmergencyCleanupRepository(database),
		worker.NewClickHouseEmergencyPartitionCleaner(clickHouse),
	)
	if storage != nil {
		mapper := sourcemap.NewMapper(sourcemap.NewArtifactCatalog(database), storage, sourcemap.NewCache(256<<20))
		job := worker.NewSourceMapJob(worker.NewClickHouseMappings(clickHouse), mapper)
		go runSourceMapWorker(ctx, job, logger)
	} else {
		logger.Info().Msg("object storage is disabled; source map processing is paused")
	}
	go runProjectDeletionWorker(ctx, deletionJob, logger)
	go runProjectDataPurgeWorker(ctx, dataPurgeJob, logger)
	go runRetentionWorker(ctx, retentionJob, logger)
	go runEmergencyCleanupWorker(ctx, emergencyCleanupJob, logger)
	// Channel configs are sealed with the Instance master key. Without it, breaches
	// are still recorded and shown in the Console, and each delivery is logged as
	// secrets_unavailable so the Console can say why nothing arrived.
	var channelOpener worker.ChannelOpener
	if configuration.AllowManagedSecrets {
		keyring, keyErr := openrumcrypto.NewKeyring(configuration.ManagedSecretsKeyID, openrumcrypto.Key{
			ID: configuration.ManagedSecretsKeyID, Material: configuration.ManagedSecretsMasterKey,
		})
		if keyErr != nil {
			_ = database.Close()
			_ = clickHouse.Close()
			return nil, keyErr
		}
		channelOpener = keyring
	}
	var heartbeatRedis *redis.Client
	if configuration.RedisAddress != "" {
		heartbeatRedis = redis.NewClient(&redis.Options{Addr: configuration.RedisAddress, ContextTimeoutEnabled: true})
		go runWorkerHeartbeat(ctx, heartbeatRedis, servicehealth.WorkerHeartbeatKey(configuration.PublicBaseURL.String()), logger)
	} else {
		logger.Warn().Msg("REDIS_ADDR is missing; worker heartbeat is unavailable")
	}
	alertStore := worker.NewPostgresAlertStore(database)
	alertScheduler := worker.NewAlertScheduler(
		worker.NewPostgresAlertLeader(database),
		worker.NewAlertEvaluator(
			alertStore,
			worker.NewClickHouseAlertMetrics(clickHouse),
			alertStore,
			worker.NewChannelDispatcher(alertStore, channelOpener, configuration.PublicBaseURL, func(message string) {
				logger.Warn().Msg(message)
			}),
		),
	)
	go runAlertScheduler(ctx, alertScheduler, logger)
	return func() error {
		if heartbeatRedis != nil {
			return errors.Join(database.Close(), clickHouse.Close(), heartbeatRedis.Close())
		}
		return errors.Join(database.Close(), clickHouse.Close())
	}, nil
}

func runWorkerHeartbeat(ctx context.Context, client servicehealth.WorkerHeartbeatWriter, key string, logger zerolog.Logger) {
	ticker := time.NewTicker(servicehealth.WorkerHeartbeatInterval)
	defer ticker.Stop()
	previouslyFailed := false
	for {
		pulseCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
		err := servicehealth.WriteWorkerHeartbeat(pulseCtx, client, key)
		cancel()
		if err != nil && !errors.Is(err, context.Canceled) && !previouslyFailed {
			logger.Warn().Err(err).Msg("worker heartbeat unavailable")
		} else if err == nil && previouslyFailed {
			logger.Info().Msg("worker heartbeat restored")
		}
		previouslyFailed = err != nil
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func runEmergencyCleanupWorker(ctx context.Context, job *worker.EmergencyCleanupJob, logger zerolog.Logger) {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		jobCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
		processed, err := job.RunOne(jobCtx)
		cancel()
		if err != nil && !errors.Is(err, context.Canceled) {
			logger.Error().Err(err).Msg("emergency storage cleanup step failed")
		} else if processed {
			logger.Info().Msg("emergency storage cleanup step completed")
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// runAlertScheduler keeps the scheduler alive across failures. Run returns on
// the first evaluation error, but a single unreadable metric must not silence
// alerting for the rest of the process lifetime.
func runAlertScheduler(ctx context.Context, scheduler *worker.AlertScheduler, logger zerolog.Logger) {
	for {
		if err := scheduler.Run(ctx); err != nil && !errors.Is(err, context.Canceled) {
			logger.Error().Err(err).Msg("alert evaluation failed")
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(time.Minute):
		}
	}
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

func runProjectDataPurgeWorker(ctx context.Context, job *worker.ProjectDataPurgeJob, logger zerolog.Logger) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		jobCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
		processed, err := job.RunOne(jobCtx)
		cancel()
		if err != nil && !errors.Is(err, context.Canceled) {
			logger.Error().Err(err).Msg("project data deletion failed")
		} else if processed {
			logger.Info().Msg("project data deletion step completed")
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
