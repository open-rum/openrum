package handlers

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"openrum/internal/httpx"
	"openrum/internal/ingest"
	"openrum/internal/metadata"
	"openrum/internal/query"
)

type overviewProjects interface {
	GetForUser(context.Context, uuid.UUID, uuid.UUID) (metadata.ProjectAccess, error)
}

type overviewRepository interface {
	Get(context.Context, query.OverviewFilters) (query.Overview, error)
}

type overviewResultCache interface {
	Get(context.Context, query.OverviewFilters, time.Time) (query.Overview, bool, error)
	Set(context.Context, query.OverviewFilters, time.Time, query.Overview) error
}

type OverviewHandler struct {
	projects overviewProjects
	queries  overviewRepository
	cache    overviewResultCache
	status   ingest.ConnectionStatusReader
	budget   query.OverviewBudget
	logger   zerolog.Logger
}

func NewOverviewHandler(projects overviewProjects, queries overviewRepository, cache overviewResultCache, status ingest.ConnectionStatusReader, logger zerolog.Logger) *OverviewHandler {
	return &OverviewHandler{projects: projects, queries: queries, cache: cache, status: status, budget: query.DefaultOverviewBudget(), logger: logger}
}

func (handler *OverviewHandler) Get(writer http.ResponseWriter, request *http.Request) {
	started := time.Now()
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
	filters, err := parseOverviewFilters(request, projectID)
	if err != nil {
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "A valid UTC from/to range and bounded filters are required.")
		return
	}
	if err := handler.budget.Check(filters); err != nil {
		if errors.Is(err, query.ErrQueryTooExpensive) {
			httpx.WriteError(writer, request, http.StatusUnprocessableEntity, "QUERY_TOO_EXPENSIVE", "Shorten the time range or add an environment, release, or route filter.")
			return
		}
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "Query filters are invalid.")
		return
	}

	version := handler.queryableVersion(request.Context(), projectID)
	if handler.cache != nil {
		if cached, hit, cacheErr := handler.cache.Get(request.Context(), filters, version); cacheErr == nil && hit {
			writeOverviewHeaders(writer, cached, started, "HIT")
			writeJSON(writer, http.StatusOK, cached)
			return
		} else if cacheErr != nil {
			handler.logger.Warn().Err(cacheErr).Str("project_id", projectID.String()).Msg("overview cache read failed")
		}
	}

	queryCtx, cancel := context.WithTimeout(request.Context(), query.OverviewQueryTimeout())
	defer cancel()
	result, err := handler.queries.Get(queryCtx, filters)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(queryCtx.Err(), context.DeadlineExceeded) {
			httpx.WriteError(writer, request, http.StatusUnprocessableEntity, "QUERY_TOO_EXPENSIVE", "The query exceeded its 10 second execution budget. Shorten the range or add a filter.")
			return
		}
		handler.logger.Error().Err(err).Str("project_id", projectID.String()).Str("request_id", httpx.RequestIDFromContext(request.Context())).Msg("overview query failed")
		httpx.WriteError(writer, request, http.StatusServiceUnavailable, "QUERY_UNAVAILABLE", "Overview data is temporarily unavailable.")
		return
	}
	if handler.cache != nil {
		if err := handler.cache.Set(request.Context(), filters, version, result); err != nil {
			handler.logger.Warn().Err(err).Str("project_id", projectID.String()).Msg("overview cache write failed")
		}
	}
	writeOverviewHeaders(writer, result, started, "MISS")
	writeJSON(writer, http.StatusOK, result)
}

func (handler *OverviewHandler) queryableVersion(ctx context.Context, projectID uuid.UUID) time.Time {
	if handler.status == nil {
		return time.Time{}
	}
	current, err := handler.status.GetConnectionStatus(ctx, projectID)
	if err != nil {
		handler.logger.Warn().Err(err).Str("project_id", projectID.String()).Msg("overview cache version unavailable")
		return time.Time{}
	}
	if current.LastEventQueryableAt == nil {
		return time.Time{}
	}
	return current.LastEventQueryableAt.UTC()
}

func parseOverviewFilters(request *http.Request, projectID uuid.UUID) (query.OverviewFilters, error) {
	values := request.URL.Query()
	maxPoints, err := parseSeriesPointBudget(values.Get("maxPoints"))
	if err != nil {
		return query.OverviewFilters{}, err
	}
	from, err := time.Parse(time.RFC3339Nano, values.Get("from"))
	if err != nil {
		return query.OverviewFilters{}, err
	}
	to, err := time.Parse(time.RFC3339Nano, values.Get("to"))
	if err != nil {
		return query.OverviewFilters{}, err
	}
	return query.NormalizeOverviewFilters(query.OverviewFilters{
		ProjectID: projectID, From: from, To: to, MaxPoints: maxPoints,
		Environment: values.Get("environment"), Release: values.Get("release"), Route: values.Get("route"),
	})
}

func parseSeriesPointBudget(value string) (int, error) {
	if value == "" {
		return 0, nil
	}
	points, err := strconv.Atoi(value)
	if err != nil || points < 24 || points > 240 {
		return 0, query.ErrInvalidOverviewFilters
	}
	return points, nil
}

func writeOverviewHeaders(writer http.ResponseWriter, result query.Overview, started time.Time, cache string) {
	writer.Header().Set("X-OpenRUM-Cache", cache)
	writer.Header().Set("X-Query-Duration-Ms", strconv.FormatInt(time.Since(started).Milliseconds(), 10))
	if result.Freshness.AgeSeconds != nil {
		writer.Header().Set("X-Data-Freshness-Seconds", strconv.FormatFloat(*result.Freshness.AgeSeconds, 'f', 3, 64))
	}
}
