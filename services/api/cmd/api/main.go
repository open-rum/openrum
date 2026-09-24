package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"runtime/debug"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"

	"openrum/internal/auth"
	"openrum/internal/config"
	openrumcrypto "openrum/internal/crypto"
	"openrum/internal/httpx"
	"openrum/internal/ingest"
	"openrum/internal/metadata"
	"openrum/internal/migrate"
	"openrum/internal/observability"
	"openrum/internal/query"
	"openrum/internal/service"
	"openrum/internal/sourcemap"
	"openrum/internal/storagepressure"
	"openrum/services/api/internal/handlers"
)

func main() {
	if err := service.MainWithRoutes(config.ServiceAPI, registerRoutes); err != nil {
		log.Fatal(err)
	}
}

var (
	version   = "development"
	commit    = "unknown"
	startedAt = time.Now().UTC()
)

func buildVersion() string {
	if version != "" && version != "development" {
		return version
	}
	if info, ok := debug.ReadBuildInfo(); ok && info.Main.Version != "" && info.Main.Version != "(devel)" {
		return info.Main.Version
	}
	return version
}

func deploymentMode() string {
	if os.Getenv("KUBERNETES_SERVICE_HOST") != "" {
		return "kubernetes"
	}
	return "standalone"
}

func registerRoutes(ctx context.Context, router *httpx.Router, configuration config.Config, logger zerolog.Logger, metrics *observability.MetricsRegistry) (func() error, error) {
	browserSDKBundle, err := loadBrowserSDKBundle()
	if err != nil {
		return nil, err
	}
	browserSDKHandler, err := handlers.NewBrowserSDKHandler(browserSDKBundle)
	if err != nil {
		return nil, err
	}
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
	if err := clickHouse.PingContext(connectCtx); err != nil {
		_ = database.Close()
		_ = clickHouse.Close()
		return nil, err
	}
	secureCookie := configuration.PublicBaseURL.Scheme == "https"
	setupHandler := handlers.NewSetupHandler(auth.NewBootstrapper(database, configuration.BootstrapToken), logger, secureCookie)
	redisClient := redis.NewClient(&redis.Options{Addr: configuration.RedisAddress, ContextTimeoutEnabled: true})
	loginManager, err := auth.NewLoginManager(database, auth.NewRedisFailureLimiter(redisClient))
	if err != nil {
		_ = database.Close()
		_ = clickHouse.Close()
		_ = redisClient.Close()
		return nil, err
	}
	sessionManager := auth.NewSessionManager(database)
	authHandler := handlers.NewAuthHandler(loginManager, sessionManager, logger, secureCookie)
	organizationRepository := metadata.NewOrganizationRepository(database)
	projectRepository := metadata.NewProjectRepository(database)
	projectKeyRepository := metadata.NewProjectKeyRepository(database)
	projectConfigRepository := metadata.NewProjectConfigRepository(database)
	pressureMonitor := storagepressure.NewMonitor(
		storagepressure.SQLCapacityReader{Database: clickHouse}, configuration.StoragePressure,
	)
	if err := storagepressure.RegisterMetrics(metrics, pressureMonitor); err != nil {
		_ = database.Close()
		_ = clickHouse.Close()
		_ = redisClient.Close()
		return nil, err
	}
	go pressureMonitor.Run(ctx)
	connectionStatus := ingest.NewRedisConnectionStatus(redisClient)
	eventProducer := ingest.NewKafkaProducer(configuration.KafkaBrokers, configuration.KafkaEventTopic)
	organizationHandler := handlers.NewOrganizationHandler(organizationRepository, logger)
	memberHandler := handlers.NewMemberHandler(organizationRepository, logger)
	instanceMemberRepository := metadata.NewInstanceMemberRepository(database)
	instanceAuditRepository := metadata.NewInstanceAuditRepository(database)
	adminMutationAudit := handlers.AdminMutationAudit(instanceAuditRepository, logger)
	adminAuditHandler := handlers.NewAdminAuditHandler(instanceMemberRepository, instanceAuditRepository, logger)
	adminMemberHandler := handlers.NewAdminMemberHandler(instanceMemberRepository, sessionManager, logger)
	adminConfigurationHandler := handlers.NewAdminConfigurationHandler(
		metadata.NewInstanceSettingRepository(database), instanceMemberRepository, sessionManager, configuration.SystemSettings, logger,
	)
	adminRetentionHandler := handlers.NewAdminRetentionHandler(
		instanceMemberRepository, metadata.NewMaintenanceJobRepository(database), projectConfigRepository,
		handlers.NewSQLRetentionPreviewSource(clickHouse), sessionManager, configuration.SystemSettings, logger,
	)
	adminEmergencyCleanupHandler := handlers.NewAdminEmergencyCleanupHandler(
		instanceMemberRepository,
		metadata.NewEmergencyCleanupRepository(database),
		handlers.NewSQLEmergencyCleanupPlanner(database, clickHouse),
		pressureMonitor,
		sessionManager,
		logger,
	)
	adminOverviewHandler := handlers.NewAdminOverviewHandler(
		instanceMemberRepository,
		handlers.NewSQLAdminOverviewSource(
			database, clickHouse, redisClient, buildVersion(), configuration.AppEnv, deploymentMode(),
			configuration.ObjectStorageProvider != config.ObjectStorageProviderNone, startedAt, pressureMonitor,
		),
		logger,
	)
	projectHandler := handlers.NewProjectHandler(organizationRepository, projectRepository, configuration.IngestEnvelopeURL(), logger)
	projectKeyHandler := handlers.NewProjectKeyHandler(projectKeyRepository, configuration.IngestEnvelopeURL(), logger)
	projectFilterHandler := handlers.NewProjectFilterHandler(projectRepository,
		metadata.NewProjectFilterRepository(database), logger)
	projectProcessingHandler := handlers.NewProjectProcessingHandler(projectRepository,
		metadata.NewProjectProcessingRepository(database), logger)
	sdkConfigHandler := handlers.NewSDKConfigHandler(projectKeyRepository, projectConfigRepository, logger, pressureMonitor)
	storagePressureHandler := handlers.NewStoragePressureHandler(pressureMonitor)
	connectionStatusHandler := handlers.NewConnectionStatusHandler(projectKeyRepository, connectionStatus, logger)
	testEventHandler := handlers.NewTestEventHandler(projectRepository, eventProducer, connectionStatus, logger)
	devDataHandler := handlers.NewDevDataHandler(configuration.AppEnv, projectRepository, configuration.IngestEnvelopeURL(), logger, projectKeyRepository)
	overviewHandler := handlers.NewOverviewHandler(projectRepository, query.NewOverviewRepository(clickHouse), query.NewOverviewCache(redisClient), connectionStatus, logger)
	dashboardHandler := handlers.NewDashboardHandler(projectRepository, metadata.NewDashboardRepository(database), logger)
	analyticsHandler := handlers.NewAnalyticsHandler(projectRepository, query.NewBehaviorRepository(clickHouse), logger)
	funnelHandler := handlers.NewFunnelHandler(projectRepository, query.NewFunnelRepository(clickHouse), logger)
	journeyHandler := handlers.NewJourneyHandler(projectRepository, query.NewPathRepository(clickHouse), query.NewRetentionRepository(clickHouse), logger)
	performanceHandler := handlers.NewPerformanceHandler(projectRepository, query.NewPerformanceRepository(clickHouse), logger)
	logHandler := handlers.NewLogHandler(projectRepository, query.NewLogRepository(clickHouse), logger)
	apiHandler := handlers.NewAPIHandler(projectRepository, query.NewAPIRepository(clickHouse), logger)
	usageHandler := handlers.NewUsageHandler(projectRepository, query.NewUsageRepository(clickHouse), logger)
	issueStateRepository := metadata.NewIssueRepository(database)
	issuesRepository := query.NewIssuesRepository(clickHouse, issueStateRepository)
	eventRepository := query.NewEventRepository(clickHouse)
	issueHandler := handlers.NewIssueHandler(projectRepository, issuesRepository, eventRepository, issueStateRepository, logger)
	eventHandler := handlers.NewEventHandler(projectRepository, eventRepository, logger)
	sessionHandler := handlers.NewSessionHandler(projectRepository, query.NewSessionRepository(clickHouse), logger)
	sourceMapStorage, storageProber, storageErr := sourcemap.NewConfiguredStorage(connectCtx, configuration)
	if storageErr != nil {
		_ = database.Close()
		_ = clickHouse.Close()
		_ = redisClient.Close()
		_ = eventProducer.Close()
		return nil, storageErr
	}
	var instanceSecretRepository *metadata.InstanceSecretRepository
	var storageSwitcher *sourcemap.SwitchableStorage
	// Nil until managed secrets are configured. Alert rules work regardless;
	// only notification channels need to seal a webhook secret at rest.
	var channelCodec metadata.EnvelopeCodec
	if configuration.AllowManagedSecrets {
		keyring, keyErr := openrumcrypto.NewKeyring(configuration.ManagedSecretsKeyID, openrumcrypto.Key{ID: configuration.ManagedSecretsKeyID, Material: configuration.ManagedSecretsMasterKey})
		if keyErr != nil {
			return nil, keyErr
		}
		channelCodec = keyring
		instanceSecretRepository = metadata.NewInstanceSecretRepository(database, keyring)
		managed, _, managedErr := instanceSecretRepository.GetObjectStorage(connectCtx)
		if managedErr == nil {
			configuration.ObjectStorageProvider = config.ObjectStorageProvider(managed.Provider)
			configuration.ObjectStorageEndpoint = managed.Endpoint
			configuration.ObjectStorageBucket = managed.Bucket
			configuration.ObjectStorageRegion = managed.Region
			configuration.ObjectStorageForcePathStyle = managed.ForcePathStyle
			configuration.ObjectStorageCredential = config.ObjectStorageCredentialManaged
			configuration.ObjectStorageMaskedIdentity = managed.AccessKeyID[:min(len(managed.AccessKeyID), 3)] + "••••"
			sourceMapStorage, storageProber, storageErr = sourcemap.NewManagedStorage(connectCtx, managed)
		} else if !errors.Is(managedErr, metadata.ErrNotFound) {
			return nil, managedErr
		}
		storageSwitcher = sourcemap.NewSwitchableStorage(sourceMapStorage, storageProber)
		sourceMapStorage, storageProber = storageSwitcher, storageSwitcher
	}
	if storageErr != nil {
		return nil, storageErr
	}
	adminStorageHandler := handlers.NewAdminStorageHandler(instanceMemberRepository, sessionManager, storageProber, configuration, logger)
	if instanceSecretRepository != nil {
		adminStorageHandler.EnableManagedSecrets(instanceSecretRepository, storageSwitcher)
	}
	releaseHandler := handlers.NewReleaseHandler(projectRepository, issueStateRepository, sourceMapStorage, logger)
	var sourceMapMapper *sourcemap.Mapper
	if sourceMapStorage != nil {
		sourceMapMapper = sourcemap.NewMapper(sourcemap.NewArtifactCatalog(database), sourceMapStorage, sourcemap.NewCache(128<<20))
	}
	sourceMapMatchHandler := handlers.NewSourceMapMatchHandler(projectRepository, sourceMapMapper, logger)
	alertRepository := metadata.NewAlertRepository(database, channelCodec)
	alertHandler := handlers.NewAlertHandler(alertRepository, logger)
	channelHandler := handlers.NewChannelHandler(alertRepository, organizationRepository, logger)
	router.HandleFunc("GET /api/v1/setup/status", setupHandler.Status)
	router.HandleFunc("POST /api/v1/setup/bootstrap", setupHandler.Bootstrap)
	router.HandleFunc("POST /api/v1/auth/login", authHandler.Login)
	router.Handle("GET "+handlers.BrowserSDKPublicPath, browserSDKHandler)
	router.Handle("GET "+handlers.BrowserSDKLegacyPublicPath, browserSDKHandler)
	router.HandleFunc("GET /api/v1/sdk/config", sdkConfigHandler.Get)
	router.HandleFunc("OPTIONS /api/v1/sdk/config", sdkConfigHandler.Options)
	requireSession := httpx.RequireSession(sessionManager)
	requireCSRF := httpx.RequireCSRF(configuration.PublicBaseURL)
	router.Handle("GET /api/v1/auth/me", requireSession(http.HandlerFunc(authHandler.Me)))
	router.Handle("GET /api/v1/storage-pressure", requireSession(http.HandlerFunc(storagePressureHandler.Get)))
	router.Handle("POST /api/v1/auth/logout", requireSession(requireCSRF(http.HandlerFunc(authHandler.Logout))))
	router.Handle("POST /api/v1/auth/password", requireSession(requireCSRF(http.HandlerFunc(authHandler.ChangePassword))))
	router.Handle("POST /api/v1/auth/reauthenticate", requireSession(requireCSRF(http.HandlerFunc(authHandler.Reauthenticate))))
	router.Handle("GET /api/v1/organizations", requireSession(http.HandlerFunc(organizationHandler.List)))
	router.Handle("POST /api/v1/organizations", requireSession(requireCSRF(http.HandlerFunc(organizationHandler.Create))))
	router.Handle("GET /api/v1/organizations/{orgId}/members", requireSession(http.HandlerFunc(memberHandler.List)))
	router.Handle("POST /api/v1/organizations/{orgId}/members", requireSession(requireCSRF(http.HandlerFunc(memberHandler.Add))))
	router.Handle("PATCH /api/v1/organizations/{orgId}/members/{userId}", requireSession(requireCSRF(http.HandlerFunc(memberHandler.Update))))
	router.Handle("DELETE /api/v1/organizations/{orgId}/members/{userId}", requireSession(requireCSRF(http.HandlerFunc(memberHandler.Remove))))
	router.Handle("GET /api/v1/admin/members", requireSession(http.HandlerFunc(adminMemberHandler.List)))
	router.Handle("POST /api/v1/admin/members", requireSession(adminMutationAudit(requireCSRF(http.HandlerFunc(adminMemberHandler.Add)))))
	router.Handle("PATCH /api/v1/admin/members/{userId}", requireSession(adminMutationAudit(requireCSRF(http.HandlerFunc(adminMemberHandler.Update)))))
	router.Handle("DELETE /api/v1/admin/members/{userId}", requireSession(adminMutationAudit(requireCSRF(http.HandlerFunc(adminMemberHandler.Remove)))))
	router.Handle("GET /api/v1/admin/configuration", requireSession(http.HandlerFunc(adminConfigurationHandler.Get)))
	router.Handle("PATCH /api/v1/admin/configuration", requireSession(adminMutationAudit(requireCSRF(http.HandlerFunc(adminConfigurationHandler.Patch)))))
	router.Handle("POST /api/v1/admin/retention-policy/preview", requireSession(requireCSRF(http.HandlerFunc(adminRetentionHandler.Preview))))
	router.Handle("POST /api/v1/admin/retention-jobs", requireSession(adminMutationAudit(requireCSRF(http.HandlerFunc(adminRetentionHandler.CreateJob)))))
	router.Handle("GET /api/v1/admin/maintenance-jobs", requireSession(http.HandlerFunc(adminRetentionHandler.ListJobs)))
	router.Handle("POST /api/v1/admin/emergency-cleanup/preview", requireSession(requireCSRF(http.HandlerFunc(adminEmergencyCleanupHandler.Preview))))
	router.Handle("POST /api/v1/admin/emergency-cleanup/jobs", requireSession(adminMutationAudit(requireCSRF(http.HandlerFunc(adminEmergencyCleanupHandler.CreateJob)))))
	router.Handle("GET /api/v1/admin/emergency-cleanup/jobs/latest", requireSession(http.HandlerFunc(adminEmergencyCleanupHandler.LatestJob)))
	router.Handle("GET /api/v1/admin/overview", requireSession(http.HandlerFunc(adminOverviewHandler.Get)))
	router.Handle("GET /api/v1/admin/audit-logs", requireSession(http.HandlerFunc(adminAuditHandler.List)))
	router.Handle("GET /api/v1/admin/object-storage", requireSession(http.HandlerFunc(adminStorageHandler.Get)))
	router.Handle("POST /api/v1/admin/object-storage/test", requireSession(adminMutationAudit(requireCSRF(http.HandlerFunc(adminStorageHandler.Test)))))
	router.Handle("PUT /api/v1/admin/object-storage/managed", requireSession(adminMutationAudit(requireCSRF(http.HandlerFunc(adminStorageHandler.PutManaged)))))
	router.Handle("GET /api/v1/organizations/{orgId}/projects", requireSession(http.HandlerFunc(projectHandler.List)))
	router.Handle("POST /api/v1/organizations/{orgId}/projects", requireSession(requireCSRF(http.HandlerFunc(projectHandler.Create))))
	router.Handle("GET /api/v1/projects/{projectId}", requireSession(http.HandlerFunc(projectHandler.Get)))
	router.Handle("PATCH /api/v1/projects/{projectId}", requireSession(requireCSRF(http.HandlerFunc(projectHandler.Update))))
	router.Handle("DELETE /api/v1/projects/{projectId}", requireSession(requireCSRF(http.HandlerFunc(projectHandler.Delete))))
	router.Handle("GET /api/v1/projects/{projectId}/data-purge", requireSession(http.HandlerFunc(projectHandler.GetDataPurge)))
	router.Handle("POST /api/v1/projects/{projectId}/data-purge", requireSession(requireCSRF(http.HandlerFunc(projectHandler.CreateDataPurge))))
	router.Handle("GET /api/v1/projects/{projectId}/filters", requireSession(http.HandlerFunc(projectFilterHandler.Get)))
	router.Handle("PUT /api/v1/projects/{projectId}/filters", requireSession(requireCSRF(http.HandlerFunc(projectFilterHandler.Put))))
	router.Handle("GET /api/v1/projects/{projectId}/url-rules", requireSession(http.HandlerFunc(projectProcessingHandler.GetURLRules)))
	router.Handle("PUT /api/v1/projects/{projectId}/url-rules", requireSession(requireCSRF(http.HandlerFunc(projectProcessingHandler.PutURLRules))))
	router.Handle("GET /api/v1/projects/{projectId}/scrub-rules", requireSession(http.HandlerFunc(projectProcessingHandler.GetScrubRules)))
	router.Handle("PUT /api/v1/projects/{projectId}/scrub-rules", requireSession(requireCSRF(http.HandlerFunc(projectProcessingHandler.PutScrubRules))))
	router.Handle("GET /api/v1/projects/{projectId}/keys", requireSession(http.HandlerFunc(projectKeyHandler.List)))
	router.Handle("GET /api/v1/projects/{projectId}/connection-status", requireSession(http.HandlerFunc(connectionStatusHandler.Get)))
	router.Handle("GET /api/v1/projects/{projectId}/overview", requireSession(http.HandlerFunc(overviewHandler.Get)))
	router.Handle("GET /api/v1/projects/{projectId}/overview/config", requireSession(http.HandlerFunc(dashboardHandler.Get)))
	router.Handle("PUT /api/v1/projects/{projectId}/overview/config", requireSession(requireCSRF(http.HandlerFunc(dashboardHandler.Put))))
	router.Handle("GET /api/v1/projects/{projectId}/analytics/events", requireSession(http.HandlerFunc(analyticsHandler.Get)))
	router.Handle("GET /api/v1/projects/{projectId}/analytics/events/samples", requireSession(http.HandlerFunc(analyticsHandler.Samples)))
	router.Handle("POST /api/v1/projects/{projectId}/analytics/funnels/query", requireSession(requireCSRF(http.HandlerFunc(funnelHandler.Query))))
	router.Handle("GET /api/v1/projects/{projectId}/analytics/paths", requireSession(http.HandlerFunc(journeyHandler.Paths)))
	router.Handle("GET /api/v1/projects/{projectId}/analytics/retention", requireSession(http.HandlerFunc(journeyHandler.Retention)))
	router.Handle("GET /api/v1/projects/{projectId}/performance", requireSession(http.HandlerFunc(performanceHandler.Get)))
	router.Handle("GET /api/v1/projects/{projectId}/logs", requireSession(http.HandlerFunc(logHandler.List)))
	router.Handle("GET /api/v1/projects/{projectId}/apis", requireSession(http.HandlerFunc(apiHandler.Get)))
	router.Handle("GET /api/v1/projects/{projectId}/usage", requireSession(http.HandlerFunc(usageHandler.Get)))
	router.Handle("GET /api/v1/projects/{projectId}/usage.csv", requireSession(http.HandlerFunc(usageHandler.CSV)))
	router.Handle("GET /api/v1/projects/{projectId}/issues", requireSession(http.HandlerFunc(issueHandler.List)))
	router.Handle("GET /api/v1/projects/{projectId}/issues/overview", requireSession(http.HandlerFunc(issueHandler.Overview)))
	router.Handle("GET /api/v1/projects/{projectId}/issues/{fingerprint}", requireSession(http.HandlerFunc(issueHandler.Get)))
	router.Handle("PATCH /api/v1/projects/{projectId}/issues/{fingerprint}", requireSession(requireCSRF(http.HandlerFunc(issueHandler.Patch))))
	router.Handle("GET /api/v1/projects/{projectId}/issues/{fingerprint}/events", requireSession(http.HandlerFunc(issueHandler.Events)))
	router.Handle("GET /api/v1/events/{eventId}", requireSession(http.HandlerFunc(eventHandler.Get)))
	router.Handle("GET /api/v1/projects/{projectId}/analytics/sessions", requireSession(http.HandlerFunc(sessionHandler.List)))
	router.Handle("GET /api/v1/projects/{projectId}/analytics/sessions/{sessionId}", requireSession(http.HandlerFunc(sessionHandler.Get)))
	router.Handle("POST /api/v1/projects/{projectId}/releases", requireSession(requireCSRF(http.HandlerFunc(releaseHandler.Create))))
	router.Handle("GET /api/v1/projects/{projectId}/releases", requireSession(http.HandlerFunc(releaseHandler.ListReleases)))
	router.Handle("POST /api/v1/projects/{projectId}/releases/{releaseId}/artifacts/presign", requireSession(requireCSRF(http.HandlerFunc(releaseHandler.Presign))))
	router.Handle("POST /api/v1/projects/{projectId}/releases/{releaseId}/artifacts/{artifactId}/complete", requireSession(requireCSRF(http.HandlerFunc(releaseHandler.Complete))))
	router.Handle("GET /api/v1/projects/{projectId}/releases/{releaseId}/artifacts", requireSession(http.HandlerFunc(releaseHandler.List)))
	router.Handle("DELETE /api/v1/projects/{projectId}/releases/{releaseId}/artifacts/{artifactId}", requireSession(requireCSRF(http.HandlerFunc(releaseHandler.Delete))))
	router.Handle("POST /api/v1/projects/{projectId}/sourcemaps/test", requireSession(requireCSRF(http.HandlerFunc(sourceMapMatchHandler.Test))))
	router.Handle("POST /api/v1/projects/{projectId}/test-event", requireSession(requireCSRF(http.HandlerFunc(testEventHandler.Create))))
	router.Handle("POST /api/v1/projects/{projectId}/keys", requireSession(requireCSRF(http.HandlerFunc(projectKeyHandler.Create))))
	router.Handle("POST /api/v1/projects/{projectId}/keys/{keyId}/rotate", requireSession(requireCSRF(http.HandlerFunc(projectKeyHandler.Rotate))))
	router.Handle("DELETE /api/v1/projects/{projectId}/keys/{keyId}", requireSession(requireCSRF(http.HandlerFunc(projectKeyHandler.Revoke))))
	router.Handle("GET /api/v1/projects/{projectId}/alerts", requireSession(http.HandlerFunc(alertHandler.List)))
	router.Handle("POST /api/v1/projects/{projectId}/alerts", requireSession(requireCSRF(http.HandlerFunc(alertHandler.Create))))
	router.Handle("GET /api/v1/organizations/{orgId}/channels", requireSession(http.HandlerFunc(channelHandler.List)))
	router.Handle("POST /api/v1/organizations/{orgId}/channels", requireSession(requireCSRF(http.HandlerFunc(channelHandler.Create))))
	// Registered only outside production, so the generator is absent rather
	// than merely refusing requests wherever it must not run.
	if devDataHandler != nil {
		router.Handle("GET /api/v1/projects/{projectId}/dev-data/presets", requireSession(http.HandlerFunc(devDataHandler.Presets)))
		router.Handle("POST /api/v1/projects/{projectId}/dev-data", requireSession(requireCSRF(http.HandlerFunc(devDataHandler.Create))))
	}
	return func() error {
		return errors.Join(database.Close(), clickHouse.Close(), redisClient.Close(), eventProducer.Close())
	}, nil
}

func loadBrowserSDKBundle() ([]byte, error) {
	paths := []string{
		"/app/sdk/index.iife.js",
		"packages/browser-sdk/dist/index.iife.js",
	}
	var failures []error
	for _, path := range paths {
		bundle, err := os.ReadFile(path)
		if err == nil {
			return bundle, nil
		}
		failures = append(failures, fmt.Errorf("%s: %w", path, err))
	}
	return nil, fmt.Errorf("load Browser SDK bundle (run pnpm --filter @openrum/browser build): %w", errors.Join(failures...))
}
