package service

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/rs/zerolog"

	"openrum/internal/config"
	"openrum/internal/health"
	"openrum/internal/httpx"
	"openrum/internal/observability"
)

type Hooks struct {
	Start    func(context.Context, config.Config) error
	Shutdown func(context.Context) error
	Errors   <-chan error
}

type RouteRegistrar func(context.Context, *httpx.Router, config.Config, zerolog.Logger) (func() error, error)

func Main(service config.Service) error {
	return MainWithRoutes(service, nil)
}

func MainWithRoutes(service config.Service, register RouteRegistrar) error {
	configuration, err := config.Load(service)
	if err != nil {
		return fmt.Errorf("load %s configuration: %w", service, err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	logger := observability.NewLogger(os.Stdout, string(configuration.Service), configuration.AppEnv)
	checks, err := health.ChecksForConfig(configuration)
	if err != nil {
		return err
	}
	healthManager := health.NewManager(checks, 2*time.Second)
	router := httpx.NewRouter(logger)
	router.Handle("GET /health/live", healthManager.LiveHandler())
	router.Handle("GET /health/ready", healthManager.ReadyHandler())
	router.Handle("GET /metrics", observability.NewMetricsHandler(string(configuration.Service), configuration.AppEnv))
	var cleanup func() error
	if register != nil {
		cleanup, err = register(ctx, router, configuration, logger)
		if err != nil {
			return fmt.Errorf("register %s routes: %w", configuration.Service, err)
		}
	}

	server := &http.Server{
		Addr:              configuration.ListenAddress,
		Handler:           router,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}
	serverErrors := make(chan error, 1)
	hooks := Hooks{
		Start: func(context.Context, config.Config) error {
			go func() {
				if listenErr := server.ListenAndServe(); listenErr != nil && !errors.Is(listenErr, http.ErrServerClosed) {
					serverErrors <- listenErr
				}
			}()
			return nil
		},
		Shutdown: func(shutdownCtx context.Context) error {
			shutdownErr := server.Shutdown(shutdownCtx)
			if cleanup != nil {
				shutdownErr = errors.Join(shutdownErr, cleanup())
			}
			return shutdownErr
		},
		Errors: serverErrors,
	}
	return Run(ctx, configuration, hooks)
}

func Run(ctx context.Context, configuration config.Config, hooks Hooks) error {
	logger := observability.NewLogger(os.Stdout, string(configuration.Service), configuration.AppEnv)

	if hooks.Start != nil {
		if err := hooks.Start(ctx, configuration); err != nil {
			return fmt.Errorf("start %s: %w", configuration.Service, err)
		}
	}

	logger.Info().Str("listen_address", configuration.ListenAddress).Msg("service started")
	var runErr error
	select {
	case <-ctx.Done():
		logger.Info().Msg("shutdown requested")
	case err := <-hooks.Errors:
		if err != nil {
			runErr = fmt.Errorf("run %s: %w", configuration.Service, err)
			logger.Error().Err(err).Msg("service runtime failed")
		}
	}

	shutdownCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), configuration.ShutdownTimeout)
	defer cancel()
	if hooks.Shutdown != nil {
		if err := hooks.Shutdown(shutdownCtx); err != nil {
			return errors.Join(runErr, fmt.Errorf("shutdown %s: %w", configuration.Service, err))
		}
	}

	logger.Info().Msg("service stopped")
	return runErr
}
