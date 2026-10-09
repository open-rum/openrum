package handlers

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"
	"golang.org/x/sync/singleflight"

	"openrum/internal/catalog"
	"openrum/internal/httpx"
	"openrum/internal/ingest"
	"openrum/internal/query"
)

type metricsRepository interface {
	Run(context.Context, query.MetricsQuery) (query.MetricsResult, error)
}

type metricsResultCache interface {
	Get(context.Context, query.MetricsQuery, time.Time) (query.MetricsResult, bool, error)
	Set(context.Context, query.MetricsQuery, time.Time, query.MetricsResult) error
}

// MetricsHandler serves the dashboard metric catalog and answers catalog questions.
type MetricsHandler struct {
	projects overviewProjects
	queries  metricsRepository
	cache    metricsResultCache
	status   ingest.ConnectionStatusReader
	budget   query.MetricsBudget
	flight   singleflight.Group
	now      func() time.Time
	logger   zerolog.Logger
}

func NewMetricsHandler(projects overviewProjects, queries metricsRepository, cache metricsResultCache, status ingest.ConnectionStatusReader, logger zerolog.Logger) *MetricsHandler {
	return &MetricsHandler{
		projects: projects, queries: queries, cache: cache, status: status,
		budget: query.DefaultMetricsBudget(), now: time.Now, logger: logger,
	}
}

// Catalog returns the metric catalog. It is the same for every project and changes only
// with a release; the Console caches it for a few minutes itself, so the response keeps the
// API's no-store policy like every other endpoint.
func (handler *MetricsHandler) Catalog(writer http.ResponseWriter, request *http.Request) {
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
	writeJSON(writer, http.StatusOK, catalog.Describe())
}

func (handler *MetricsHandler) Query(writer http.ResponseWriter, request *http.Request) {
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
	requested, err := parseMetricsQuery(request, projectID)
	if err != nil {
		writeMetricsValidationError(writer, request, err)
		return
	}
	metricsQuery, err := query.NormalizeMetricsQuery(requested)
	if err != nil {
		writeMetricsValidationError(writer, request, err)
		return
	}
	if err := handler.budget.Check(metricsQuery); err != nil {
		if errors.Is(err, query.ErrQueryTooExpensive) {
			httpx.WriteError(writer, request, http.StatusUnprocessableEntity, "QUERY_TOO_EXPENSIVE",
				"Shorten the time range or add an environment, release, or route filter.")
			return
		}
		writeMetricsValidationError(writer, request, err)
		return
	}

	lastQueryable := handler.lastQueryable(request.Context(), projectID)
	version := time.Time{}
	if lastQueryable != nil {
		version = *lastQueryable
	}
	if handler.cache != nil {
		if cached, hit, cacheErr := handler.cache.Get(request.Context(), metricsQuery, version); cacheErr == nil && hit {
			handler.writeResult(writer, cached, lastQueryable, started, "HIT")
			return
		} else if cacheErr != nil {
			handler.logger.Warn().Err(cacheErr).Str("project_id", projectID.String()).Msg("metrics cache read failed")
		}
	}

	key, err := query.MetricsCacheKey(metricsQuery, version)
	if err != nil {
		writeMetricsValidationError(writer, request, err)
		return
	}
	// Identical modules on one page, and identical pages in several tabs, share a single
	// ClickHouse query. The shared call must outlive any one caller's cancellation.
	//nolint:contextcheck // The shared call deliberately detaches from the caller (see above).
	shared, err, _ := handler.flight.Do(key, func() (any, error) {
		queryCtx, cancel := context.WithTimeout(context.WithoutCancel(request.Context()), query.OverviewQueryTimeout())
		defer cancel()
		result, runErr := handler.queries.Run(queryCtx, metricsQuery)
		if runErr != nil {
			if errors.Is(runErr, context.DeadlineExceeded) || errors.Is(queryCtx.Err(), context.DeadlineExceeded) {
				return nil, context.DeadlineExceeded
			}
			return nil, runErr
		}
		if handler.cache != nil {
			if cacheErr := handler.cache.Set(queryCtx, metricsQuery, version, result); cacheErr != nil {
				handler.logger.Warn().Err(cacheErr).Str("project_id", projectID.String()).Msg("metrics cache write failed")
			}
		}
		return result, nil
	})
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			httpx.WriteError(writer, request, http.StatusUnprocessableEntity, "QUERY_TOO_EXPENSIVE",
				"The query exceeded its 10 second execution budget. Shorten the range or add a filter.")
			return
		}
		handler.logger.Error().Err(err).Str("project_id", projectID.String()).
			Str("request_id", httpx.RequestIDFromContext(request.Context())).Msg("metrics query failed")
		httpx.WriteError(writer, request, http.StatusServiceUnavailable, "QUERY_UNAVAILABLE", "Metrics are temporarily unavailable.")
		return
	}
	handler.writeResult(writer, shared.(query.MetricsResult), lastQueryable, started, "MISS")
}

// Freshness comes from the connection status the cache key already reads, so answering it
// costs no ClickHouse scan. It is project-wide: an environment that stopped reporting while
// another still reports does not show as stale here.
func (handler *MetricsHandler) writeResult(writer http.ResponseWriter, result query.MetricsResult, lastQueryable *time.Time, started time.Time, cache string) {
	result.Freshness = query.OverviewFreshness{}
	if lastQueryable != nil {
		latest := lastQueryable.UTC()
		age := max(0, handler.now().UTC().Sub(latest).Seconds())
		result.Freshness = query.OverviewFreshness{LatestReceivedAt: &latest, AgeSeconds: &age, Stale: age > 60}
		writer.Header().Set("X-Data-Freshness-Seconds", strconv.FormatFloat(age, 'f', 3, 64))
	}
	writer.Header().Set("X-OpenRUM-Cache", cache)
	writer.Header().Set("X-Query-Duration-Ms", strconv.FormatInt(time.Since(started).Milliseconds(), 10))
	writeJSON(writer, http.StatusOK, result)
}

func (handler *MetricsHandler) lastQueryable(ctx context.Context, projectID uuid.UUID) *time.Time {
	if handler.status == nil {
		return nil
	}
	current, err := handler.status.GetConnectionStatus(ctx, projectID)
	if err != nil {
		handler.logger.Warn().Err(err).Str("project_id", projectID.String()).Msg("metrics freshness unavailable")
		return nil
	}
	if current.LastEventQueryableAt == nil {
		return nil
	}
	value := current.LastEventQueryableAt.UTC()
	return &value
}

var metricsFilterKeys = []string{"release", "route", "country", "browser", "device", "apiMethod", "apiUrl", "eventKind", "eventName"}

func parseMetricsQuery(request *http.Request, projectID uuid.UUID) (query.MetricsQuery, error) {
	values := request.URL.Query()
	from, err := time.Parse(time.RFC3339Nano, values.Get("from"))
	if err != nil {
		return query.MetricsQuery{}, query.ErrInvalidMetricsQuery
	}
	to, err := time.Parse(time.RFC3339Nano, values.Get("to"))
	if err != nil {
		return query.MetricsQuery{}, query.ErrInvalidMetricsQuery
	}
	maxPoints, err := parseSeriesPointBudget(values.Get("maxPoints"))
	if err != nil {
		return query.MetricsQuery{}, query.ErrInvalidMetricsQuery
	}
	topN := 0
	if raw := values.Get("topN"); raw != "" {
		topN, err = strconv.Atoi(raw)
		if err != nil {
			return query.MetricsQuery{}, query.ErrInvalidMetricsQuery
		}
	}
	compare := false
	switch values.Get("compare") {
	case "":
	case "previous":
		compare = true
	default:
		return query.MetricsQuery{}, query.ErrInvalidMetricsQuery
	}
	sparkline := false
	switch values.Get("sparkline") {
	case "", "false":
	case "true":
		sparkline = true
	default:
		return query.MetricsQuery{}, query.ErrInvalidMetricsQuery
	}
	filters := map[string]string{}
	for _, key := range metricsFilterKeys {
		if value := values.Get(key); value != "" {
			filters[key] = value
		}
	}
	return query.MetricsQuery{
		ProjectID: projectID, From: from, To: to, Environment: values.Get("environment"), MaxPoints: maxPoints,
		Spec: catalog.Spec{
			Metrics: values["metric"], Shape: catalog.Shape(values.Get("shape")),
			Dimension: values.Get("dimension"), Measurement: values.Get("measurement"), Filters: filters,
			Compare: compare, TopN: topN, Sort: values.Get("sort"), Order: values.Get("order"),
			Sparkline: sparkline, Stack: catalog.Stack(values.Get("stack")), Groups: values["group"],
		},
	}, nil
}

// A catalog rejection carries a fixed, user-safe reason, so it is worth returning; anything
// else is a malformed window or parameter and gets the generic message.
func writeMetricsValidationError(writer http.ResponseWriter, request *http.Request, err error) {
	message := "A valid UTC from/to range of at most 30 days and a valid metrics query are required."
	if errors.Is(err, catalog.ErrInvalidSpec) {
		message = strings.TrimPrefix(err.Error(), catalog.ErrInvalidSpec.Error()+": ")
	}
	httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", message)
}
