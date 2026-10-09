package handlers

import (
	"context"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"openrum/internal/auth"
	"openrum/internal/httpx"
	"openrum/internal/metadata"
	"openrum/internal/sourcemap"
)

type sourceMapMatcher interface {
	MapStack(context.Context, uuid.UUID, string, string, string) (sourcemap.MappedStack, error)
}

type SourceMapMatchHandler struct {
	projects overviewProjects
	mapper   sourceMapMatcher
	storage  storageStateReporter
	logger   zerolog.Logger
}

// UseStorageState lets a failed match distinguish missing configuration from a
// temporarily failing backend.
func (handler *SourceMapMatchHandler) UseStorageState(storage storageStateReporter) {
	handler.storage = storage
}

func NewSourceMapMatchHandler(projects overviewProjects, mapper sourceMapMatcher, logger zerolog.Logger) *SourceMapMatchHandler {
	return &SourceMapMatchHandler{projects: projects, mapper: mapper, logger: logger}
}

type sourceMapMatchRequest struct {
	Release string `json:"release"`
	Dist    string `json:"dist"`
	Stack   string `json:"stack"`
}

func (handler *SourceMapMatchHandler) Test(writer http.ResponseWriter, request *http.Request) {
	principal, ok := httpx.PrincipalFromContext(request.Context())
	if !ok {
		httpx.WriteError(writer, request, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication is required.")
		return
	}
	projectID, ok := parsePathUUID(writer, request, "projectId")
	if !ok {
		return
	}
	access, err := handler.projects.GetForUser(request.Context(), principal.UserID, projectID)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	if err := auth.Authorize(access.Role, auth.ActionReadProject); err != nil {
		writeControlPlaneError(writer, request, handler.logger, metadata.ErrForbidden)
		return
	}
	var payload sourceMapMatchRequest
	if !decodeJSONBody(writer, request, &payload) {
		return
	}
	payload.Release, payload.Dist = strings.TrimSpace(payload.Release), strings.TrimSpace(payload.Dist)
	if len(payload.Release) > 128 || len(payload.Dist) > 64 || len(payload.Stack) == 0 || len(payload.Stack) > sourcemap.MaxStackBytes {
		writeReleaseValidationError(writer, request)
		return
	}
	if handler.mapper == nil {
		httpx.WriteError(writer, request, http.StatusServiceUnavailable, "OBJECT_STORAGE_NOT_CONFIGURED", "Source map storage is not configured.")
		return
	}
	mapped, err := handler.mapper.MapStack(request.Context(), projectID, payload.Release, payload.Dist, payload.Stack)
	if err != nil {
		// A transient storage or catalog failure says nothing about the map;
		// report it instead of showing a misleading per-frame failure.
		if handler.storage != nil && handler.storage.State() == sourcemap.StorageNotConfigured {
			httpx.WriteError(writer, request, http.StatusServiceUnavailable, "OBJECT_STORAGE_NOT_CONFIGURED", "Source map storage is not configured.")
			return
		}
		handler.logger.Warn().Err(err).Str("request_id", httpx.RequestIDFromContext(request.Context())).Msg("source map match test unavailable")
		httpx.WriteError(writer, request, http.StatusServiceUnavailable, "OBJECT_STORAGE_UNAVAILABLE", "Source map storage is temporarily unavailable.")
		return
	}
	writeJSON(writer, http.StatusOK, mapped)
}
