package handlers

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"openrum/internal/httpx"
	"openrum/internal/query"

	"github.com/rs/zerolog"
)

type logQueries interface {
	List(context.Context, query.LogFilters) (query.LogPage, error)
}
type LogHandler struct {
	projects overviewProjects
	queries  logQueries
	logger   zerolog.Logger
}

func NewLogHandler(projects overviewProjects, queries logQueries, logger zerolog.Logger) *LogHandler {
	return &LogHandler{projects: projects, queries: queries, logger: logger}
}

func (handler *LogHandler) List(writer http.ResponseWriter, request *http.Request) {
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
	values := request.URL.Query()
	from, fromErr := time.Parse(time.RFC3339Nano, values.Get("from"))
	to, toErr := time.Parse(time.RFC3339Nano, values.Get("to"))
	limit := 50
	var limitErr error
	if values.Has("limit") {
		limit, limitErr = strconv.Atoi(values.Get("limit"))
		if limit == 0 {
			limitErr = query.ErrInvalidLogFilters
		}
	}
	filters, err := query.NormalizeLogFilters(query.LogFilters{ProjectID: projectID, From: from, To: to, Limit: limit,
		Environment: values.Get("environment"), Release: values.Get("release"), Route: values.Get("route"), Browser: values.Get("browser"),
		DeviceType: values.Get("deviceType"), Country: values.Get("country"), Level: values.Get("level"), Query: values.Get("q"), Cursor: values.Get("cursor")})
	if fromErr != nil || toErr != nil || limitErr != nil || err != nil {
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "Use a range up to 30 days and words or field:value search terms. OR, comparisons, and unclosed quotes are not supported.")
		return
	}
	ctx, cancel := context.WithTimeout(request.Context(), 10*time.Second)
	defer cancel()
	result, err := handler.queries.List(ctx, filters)
	if err != nil {
		if errors.Is(err, query.ErrInvalidLogFilters) {
			httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "Log filters are invalid.")
			return
		}
		handler.logger.Error().Err(err).Str("project_id", projectID.String()).Msg("log query failed")
		httpx.WriteError(writer, request, http.StatusServiceUnavailable, "QUERY_UNAVAILABLE", "Logs could not be loaded. Narrow the time range or filters and retry.")
		return
	}
	writeJSON(writer, http.StatusOK, result)
}
