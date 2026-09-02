package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"

	"openrum/internal/auth"
	"openrum/internal/config"
	"openrum/internal/httpx"
	"openrum/internal/metadata"
	"openrum/internal/service"
	"openrum/services/api/internal/handlers"
)

func main() {
	if err := service.MainWithRoutes(config.ServiceAPI, registerRoutes); err != nil {
		log.Fatal(err)
	}
}

func registerRoutes(ctx context.Context, router *httpx.Router, configuration config.Config, logger zerolog.Logger) (func() error, error) {
	connectCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	database, err := metadata.OpenPostgres(connectCtx, configuration.PostgresDSN)
	if err != nil {
		return nil, err
	}
	secureCookie := configuration.PublicBaseURL.Scheme == "https"
	setupHandler := handlers.NewSetupHandler(auth.NewBootstrapper(database, configuration.BootstrapToken), logger, secureCookie)
	redisClient := redis.NewClient(&redis.Options{Addr: configuration.RedisAddress})
	loginManager, err := auth.NewLoginManager(database, auth.NewRedisFailureLimiter(redisClient))
	if err != nil {
		_ = database.Close()
		_ = redisClient.Close()
		return nil, err
	}
	sessionManager := auth.NewSessionManager(database)
	authHandler := handlers.NewAuthHandler(loginManager, sessionManager, logger, secureCookie)
	organizationRepository := metadata.NewOrganizationRepository(database)
	projectRepository := metadata.NewProjectRepository(database)
	projectKeyRepository := metadata.NewProjectKeyRepository(database)
	organizationHandler := handlers.NewOrganizationHandler(organizationRepository, logger)
	memberHandler := handlers.NewMemberHandler(organizationRepository, logger)
	projectHandler := handlers.NewProjectHandler(organizationRepository, projectRepository, logger)
	projectKeyHandler := handlers.NewProjectKeyHandler(projectKeyRepository, logger)
	router.HandleFunc("GET /api/v1/setup/status", setupHandler.Status)
	router.HandleFunc("POST /api/v1/setup/bootstrap", setupHandler.Bootstrap)
	router.HandleFunc("POST /api/v1/auth/login", authHandler.Login)
	requireSession := httpx.RequireSession(sessionManager)
	requireCSRF := httpx.RequireCSRF(configuration.PublicBaseURL)
	router.Handle("GET /api/v1/auth/me", requireSession(http.HandlerFunc(authHandler.Me)))
	router.Handle("POST /api/v1/auth/logout", requireSession(requireCSRF(http.HandlerFunc(authHandler.Logout))))
	router.Handle("POST /api/v1/auth/password", requireSession(requireCSRF(http.HandlerFunc(authHandler.ChangePassword))))
	router.Handle("GET /api/v1/organizations", requireSession(http.HandlerFunc(organizationHandler.List)))
	router.Handle("POST /api/v1/organizations", requireSession(requireCSRF(http.HandlerFunc(organizationHandler.Create))))
	router.Handle("GET /api/v1/organizations/{orgId}/members", requireSession(http.HandlerFunc(memberHandler.List)))
	router.Handle("POST /api/v1/organizations/{orgId}/members", requireSession(requireCSRF(http.HandlerFunc(memberHandler.Add))))
	router.Handle("PATCH /api/v1/organizations/{orgId}/members/{userId}", requireSession(requireCSRF(http.HandlerFunc(memberHandler.Update))))
	router.Handle("DELETE /api/v1/organizations/{orgId}/members/{userId}", requireSession(requireCSRF(http.HandlerFunc(memberHandler.Remove))))
	router.Handle("GET /api/v1/organizations/{orgId}/projects", requireSession(http.HandlerFunc(projectHandler.List)))
	router.Handle("POST /api/v1/organizations/{orgId}/projects", requireSession(requireCSRF(http.HandlerFunc(projectHandler.Create))))
	router.Handle("GET /api/v1/projects/{projectId}", requireSession(http.HandlerFunc(projectHandler.Get)))
	router.Handle("PATCH /api/v1/projects/{projectId}", requireSession(requireCSRF(http.HandlerFunc(projectHandler.Update))))
	router.Handle("GET /api/v1/projects/{projectId}/keys", requireSession(http.HandlerFunc(projectKeyHandler.List)))
	router.Handle("POST /api/v1/projects/{projectId}/keys", requireSession(requireCSRF(http.HandlerFunc(projectKeyHandler.Create))))
	router.Handle("POST /api/v1/projects/{projectId}/keys/{keyId}/rotate", requireSession(requireCSRF(http.HandlerFunc(projectKeyHandler.Rotate))))
	router.Handle("DELETE /api/v1/projects/{projectId}/keys/{keyId}", requireSession(requireCSRF(http.HandlerFunc(projectKeyHandler.Revoke))))
	return func() error {
		return errors.Join(database.Close(), redisClient.Close())
	}, nil
}
