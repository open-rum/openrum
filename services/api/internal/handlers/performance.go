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

type performanceQueries interface {
	Get(context.Context, query.PerformanceFilters) (query.PerformanceResult, error)
}

type PerformanceHandler struct {
	projects overviewProjects
	queries  performanceQueries
	logger   zerolog.Logger
}

func NewPerformanceHandler(projects overviewProjects, queries performanceQueries, logger zerolog.Logger) *PerformanceHandler {
	return &PerformanceHandler{projects: projects, queries: queries, logger: logger}
}

func (handler *PerformanceHandler) Get(writer http.ResponseWriter, request *http.Request) {
	principal, ok := httpx.PrincipalFromContext(request.Context())
	if !ok {
		httpx.WriteError(writer, request, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication is required.")
		return
	}
	projectID, ok := parsePathUUID(writer, request, "projectId")
	if !ok {
		return
	}
	if _, err := handler.projects.GetForUser(request.Context(), principal.UserID, projectID); err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	filters, err := parsePerformanceFilters(request, projectID)
	if err != nil {
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "A valid UTC range up to 30 days, metric, and bounded filters are required.")
		return
	}
	ctx, cancel := context.WithTimeout(request.Context(), 10*time.Second)
	defer cancel()
	result, err := handler.queries.Get(ctx, filters)
	if err != nil {
		if errors.Is(err, query.ErrInvalidPerformanceFilters) {
			httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "Performance filters are invalid.")
			return
		}
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			httpx.WriteError(writer, request, http.StatusUnprocessableEntity, "QUERY_TOO_EXPENSIVE", "The performance query exceeded its time budget.")
			return
		}
		handler.logger.Error().Err(err).Str("project_id", projectID.String()).Msg("performance query failed")
		httpx.WriteError(writer, request, http.StatusServiceUnavailable, "QUERY_UNAVAILABLE", "Performance data is temporarily unavailable.")
		return
	}
	writeJSON(writer, http.StatusOK, result)
}

func parsePerformanceFilters(request *http.Request, projectID uuid.UUID) (query.PerformanceFilters, error) {
	values := request.URL.Query()
	from, err := time.Parse(time.RFC3339Nano, values.Get("from"))
	if err != nil {
		return query.PerformanceFilters{}, err
	}
	to, err := time.Parse(time.RFC3339Nano, values.Get("to"))
	if err != nil {
		return query.PerformanceFilters{}, err
	}
	return query.NormalizePerformanceFilters(query.PerformanceFilters{
		ProjectID: projectID, From: from, To: to, Environment: values.Get("environment"),
		Release: values.Get("release"), Route: values.Get("route"), Metric: values.Get("metric"),
		Percentile: values.Get("percentile"), Browser: values.Get("browser"), DeviceType: values.Get("deviceType"), Country: values.Get("country"),
	})
}
