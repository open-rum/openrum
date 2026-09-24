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
	"openrum/internal/query"
)

type behaviorQueries interface {
	Get(context.Context, query.BehaviorFilters) (query.BehaviorAnalytics, error)
	ListSamples(context.Context, query.BehaviorFilters) (query.BehaviorSamplePage, error)
}

func (handler *AnalyticsHandler) Samples(writer http.ResponseWriter, request *http.Request) {
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
	filters, err := parseBehaviorFilters(request, projectID)
	if err != nil {
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "Samples require one event and a UTC range no longer than 24 hours.")
		return
	}
	ctx, cancel := context.WithTimeout(request.Context(), 5*time.Second)
	defer cancel()
	result, err := handler.queries.ListSamples(ctx, filters)
	if err != nil {
		if errors.Is(err, query.ErrInvalidBehaviorFilters) {
			httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "Samples require one event and a UTC range no longer than 24 hours.")
		} else if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			httpx.WriteError(writer, request, http.StatusUnprocessableEntity, "QUERY_TOO_EXPENSIVE", "The sample query exceeded its execution budget.")
		} else {
			handler.logger.Error().Err(err).Str("project_id", projectID.String()).Msg("behavior sample query failed")
			httpx.WriteError(writer, request, http.StatusServiceUnavailable, "QUERY_UNAVAILABLE", "Behavior samples are temporarily unavailable.")
		}
		return
	}
	writeJSON(writer, http.StatusOK, result)
}

type AnalyticsHandler struct {
	projects overviewProjects
	queries  behaviorQueries
	logger   zerolog.Logger
}

func NewAnalyticsHandler(projects overviewProjects, queries behaviorQueries, logger zerolog.Logger) *AnalyticsHandler {
	return &AnalyticsHandler{projects: projects, queries: queries, logger: logger}
}

func (handler *AnalyticsHandler) Get(writer http.ResponseWriter, request *http.Request) {
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
	filters, err := parseBehaviorFilters(request, projectID)
	if err != nil {
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "A valid UTC range and one supported behavior dimension are required.")
		return
	}
	if err := query.CheckBehaviorBudget(filters); err != nil {
		if errors.Is(err, query.ErrBehaviorQueryTooExpensive) {
			httpx.WriteError(writer, request, http.StatusUnprocessableEntity, "QUERY_TOO_EXPENSIVE", "Shorten the time range, use a built-in dimension, or add an event/environment filter.")
			return
		}
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "Behavior filters are invalid.")
		return
	}
	ctx, cancel := context.WithTimeout(request.Context(), 10*time.Second)
	defer cancel()
	result, err := handler.queries.Get(ctx, filters)
	if err != nil {
		switch {
		case errors.Is(err, query.ErrBehaviorQueryTooExpensive), errors.Is(err, query.ErrBehaviorCardinalityExceeded), errors.Is(ctx.Err(), context.DeadlineExceeded):
			httpx.WriteError(writer, request, http.StatusUnprocessableEntity, "QUERY_TOO_EXPENSIVE", "The behavior query exceeded its scan, cardinality, or execution budget.")
		case errors.Is(err, query.ErrInvalidBehaviorFilters):
			httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "Behavior filters are invalid.")
		default:
			handler.logger.Error().Err(err).Str("project_id", projectID.String()).Msg("behavior analytics query failed")
			httpx.WriteError(writer, request, http.StatusServiceUnavailable, "QUERY_UNAVAILABLE", "Behavior analytics data is temporarily unavailable.")
		}
		return
	}
	writer.Header().Set("X-Query-Duration-Ms", strconv.FormatInt(time.Since(started).Milliseconds(), 10))
	if result.Freshness.AgeSeconds != nil {
		writer.Header().Set("X-Data-Freshness-Seconds", strconv.FormatFloat(*result.Freshness.AgeSeconds, 'f', 3, 64))
	}
	writeJSON(writer, http.StatusOK, result)
}

func parseBehaviorFilters(request *http.Request, projectID uuid.UUID) (query.BehaviorFilters, error) {
	values := request.URL.Query()
	maxPoints, err := parseSeriesPointBudget(values.Get("maxPoints"))
	if err != nil {
		return query.BehaviorFilters{}, query.ErrInvalidBehaviorFilters
	}
	from, err := time.Parse(time.RFC3339Nano, values.Get("from"))
	if err != nil {
		return query.BehaviorFilters{}, err
	}
	to, err := time.Parse(time.RFC3339Nano, values.Get("to"))
	if err != nil {
		return query.BehaviorFilters{}, err
	}
	return query.NormalizeBehaviorFilters(query.BehaviorFilters{
		ProjectID: projectID, From: from, To: to, Environment: values.Get("environment"),
		EventKind: values.Get("eventKind"), EventName: values.Get("eventName"), Dimension: values.Get("dimension"),
		Measurement: values.Get("measurement"), MaxPoints: maxPoints,
	})
}
