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

type pathQueries interface {
	Query(context.Context, query.PathQuery) (query.PathResult, error)
}

type retentionQueries interface {
	Query(context.Context, query.RetentionQuery) (query.RetentionResult, error)
}

type JourneyHandler struct {
	projects  overviewProjects
	paths     pathQueries
	retention retentionQueries
	logger    zerolog.Logger
}

func NewJourneyHandler(projects overviewProjects, paths pathQueries, retention retentionQueries, logger zerolog.Logger) *JourneyHandler {
	return &JourneyHandler{projects: projects, paths: paths, retention: retention, logger: logger}
}

func (handler *JourneyHandler) Paths(writer http.ResponseWriter, request *http.Request) {
	projectID, ok := handler.authorize(writer, request)
	if !ok {
		return
	}
	input, err := parsePathQuery(request, projectID)
	if err != nil {
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "Use a range up to 7 days, depth 2–5, and Top 5, 10, or 20.")
		return
	}
	if err := query.CheckPathBudget(input); err != nil {
		httpx.WriteError(writer, request, http.StatusUnprocessableEntity, "QUERY_TOO_EXPENSIVE", "Shorten the path range or depth.")
		return
	}
	ctx, cancel := context.WithTimeout(request.Context(), 10*time.Second)
	defer cancel()
	result, err := handler.paths.Query(ctx, input)
	if err != nil {
		handler.writeQueryError(writer, request, projectID, "path", err, ctx)
		return
	}
	writeJSON(writer, http.StatusOK, result)
}

func (handler *JourneyHandler) Retention(writer http.ResponseWriter, request *http.Request) {
	projectID, ok := handler.authorize(writer, request)
	if !ok {
		return
	}
	input, err := parseRetentionQuery(request, projectID)
	if err != nil {
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "Retention supports a fixed 4–12 week range.")
		return
	}
	if err := query.CheckRetentionBudget(input); err != nil {
		httpx.WriteError(writer, request, http.StatusUnprocessableEntity, "QUERY_TOO_EXPENSIVE", "Shorten the retention range.")
		return
	}
	ctx, cancel := context.WithTimeout(request.Context(), 10*time.Second)
	defer cancel()
	result, err := handler.retention.Query(ctx, input)
	if err != nil {
		handler.writeQueryError(writer, request, projectID, "retention", err, ctx)
		return
	}
	writeJSON(writer, http.StatusOK, result)
}

func (handler *JourneyHandler) authorize(writer http.ResponseWriter, request *http.Request) (uuid.UUID, bool) {
	principal, ok := httpx.PrincipalFromContext(request.Context())
	if !ok {
		httpx.WriteError(writer, request, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication is required.")
		return uuid.Nil, false
	}
	projectID, ok := parsePathUUID(writer, request, "projectId")
	if !ok {
		return uuid.Nil, false
	}
	if _, err := handler.projects.GetForUser(request.Context(), principal.UserID, projectID); err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return uuid.Nil, false
	}
	return projectID, true
}

func (handler *JourneyHandler) writeQueryError(writer http.ResponseWriter, request *http.Request, projectID uuid.UUID, family string, err error, ctx context.Context) {
	if errors.Is(err, query.ErrPathQueryTooExpensive) || errors.Is(err, query.ErrRetentionQueryTooExpensive) || errors.Is(ctx.Err(), context.DeadlineExceeded) {
		httpx.WriteError(writer, request, http.StatusUnprocessableEntity, "QUERY_TOO_EXPENSIVE", "The query exceeded its scan or execution budget.")
		return
	}
	if errors.Is(err, query.ErrInvalidPathQuery) || errors.Is(err, query.ErrInvalidRetentionQuery) {
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "The query definition is invalid.")
		return
	}
	handler.logger.Error().Err(err).Str("project_id", projectID.String()).Str("query_family", family).Msg("journey query failed")
	httpx.WriteError(writer, request, http.StatusServiceUnavailable, "QUERY_UNAVAILABLE", "Journey data is temporarily unavailable.")
}

func parsePathQuery(request *http.Request, projectID uuid.UUID) (query.PathQuery, error) {
	from, to, err := parseJourneyRange(request)
	if err != nil {
		return query.PathQuery{}, err
	}
	depth, err := parseOptionalInt(request.URL.Query().Get("depth"), 5)
	if err != nil {
		return query.PathQuery{}, err
	}
	topN, err := parseOptionalInt(request.URL.Query().Get("topN"), 20)
	if err != nil {
		return query.PathQuery{}, err
	}
	return query.NormalizePathQuery(query.PathQuery{ProjectID: projectID, From: from, To: to, Environment: request.URL.Query().Get("environment"), Depth: depth, TopN: topN})
}

func parseRetentionQuery(request *http.Request, projectID uuid.UUID) (query.RetentionQuery, error) {
	from, to, err := parseJourneyRange(request)
	if err != nil {
		return query.RetentionQuery{}, err
	}
	weeks, err := parseOptionalInt(request.URL.Query().Get("weeks"), 8)
	if err != nil {
		return query.RetentionQuery{}, err
	}
	return query.NormalizeRetentionQuery(query.RetentionQuery{ProjectID: projectID, From: from, To: to, Environment: request.URL.Query().Get("environment"), Weeks: weeks})
}

func parseJourneyRange(request *http.Request) (time.Time, time.Time, error) {
	from, err := time.Parse(time.RFC3339Nano, request.URL.Query().Get("from"))
	if err != nil {
		return time.Time{}, time.Time{}, err
	}
	to, err := time.Parse(time.RFC3339Nano, request.URL.Query().Get("to"))
	return from, to, err
}

func parseOptionalInt(value string, fallback int) (int, error) {
	if value == "" {
		return fallback, nil
	}
	return strconv.Atoi(value)
}
