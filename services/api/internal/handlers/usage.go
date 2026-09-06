package handlers

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"openrum/internal/httpx"
	"openrum/internal/query"
)

type usageQueries interface {
	Get(context.Context, query.UsageFilters) (query.UsageResult, error)
}

type UsageHandler struct {
	projects overviewProjects
	queries  usageQueries
	logger   zerolog.Logger
}

func NewUsageHandler(projects overviewProjects, queries usageQueries, logger zerolog.Logger) *UsageHandler {
	return &UsageHandler{projects: projects, queries: queries, logger: logger}
}

func (handler *UsageHandler) Get(writer http.ResponseWriter, request *http.Request) {
	result, ok := handler.read(writer, request)
	if ok {
		writeJSON(writer, http.StatusOK, result)
	}
}

func (handler *UsageHandler) read(writer http.ResponseWriter, request *http.Request) (query.UsageResult, bool) {
	principal, ok := httpx.PrincipalFromContext(request.Context())
	if !ok {
		httpx.WriteError(writer, request, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication is required.")
		return query.UsageResult{}, false
	}
	projectID, ok := parsePathUUID(writer, request, "projectId")
	if !ok {
		return query.UsageResult{}, false
	}
	if _, err := handler.projects.GetForUser(request.Context(), principal.UserID, projectID); err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return query.UsageResult{}, false
	}
	filters, err := parseUsageFilters(request, projectID)
	if err != nil {
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "A valid UTC range up to 90 days is required.")
		return query.UsageResult{}, false
	}
	ctx, cancel := context.WithTimeout(request.Context(), 10*time.Second)
	defer cancel()
	result, err := handler.queries.Get(ctx, filters)
	if err != nil {
		if errors.Is(err, query.ErrInvalidUsageFilters) {
			httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "Usage filters are invalid.")
			return query.UsageResult{}, false
		}
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			httpx.WriteError(writer, request, http.StatusUnprocessableEntity, "QUERY_TOO_EXPENSIVE", "The usage query exceeded its time budget.")
			return query.UsageResult{}, false
		}
		handler.logger.Error().Err(err).Str("project_id", projectID.String()).Msg("usage query failed")
		httpx.WriteError(writer, request, http.StatusServiceUnavailable, "QUERY_UNAVAILABLE", "Usage data is temporarily unavailable.")
		return query.UsageResult{}, false
	}
	return result, true
}

func parseUsageFilters(request *http.Request, projectID uuid.UUID) (query.UsageFilters, error) {
	values := request.URL.Query()
	from, err := time.Parse(time.RFC3339Nano, values.Get("from"))
	if err != nil {
		return query.UsageFilters{}, err
	}
	to, err := time.Parse(time.RFC3339Nano, values.Get("to"))
	if err != nil {
		return query.UsageFilters{}, err
	}
	return query.NormalizeUsageFilters(query.UsageFilters{ProjectID: projectID, From: from, To: to, EventType: values.Get("eventType")})
}
