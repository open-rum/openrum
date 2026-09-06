package handlers

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/rs/zerolog"

	"openrum/internal/httpx"
	"openrum/internal/query"
)

type funnelQueries interface {
	Query(context.Context, query.FunnelQuery) (query.FunnelResult, error)
}

type FunnelHandler struct {
	projects overviewProjects
	queries  funnelQueries
	logger   zerolog.Logger
}

func NewFunnelHandler(projects overviewProjects, queries funnelQueries, logger zerolog.Logger) *FunnelHandler {
	return &FunnelHandler{projects: projects, queries: queries, logger: logger}
}

func (handler *FunnelHandler) Query(writer http.ResponseWriter, request *http.Request) {
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
	var input query.FunnelQuery
	if !decodeJSONBody(writer, request, &input) {
		return
	}
	input.ProjectID = projectID
	if err := query.CheckFunnelBudget(input); err != nil {
		if errors.Is(err, query.ErrFunnelQueryTooExpensive) {
			httpx.WriteError(writer, request, http.StatusUnprocessableEntity, "QUERY_TOO_EXPENSIVE", "Shorten the range, reduce the number of steps, or use a built-in dimension.")
			return
		}
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "Use 2–5 valid events, a supported window, and one governed dimension.")
		return
	}
	ctx, cancel := context.WithTimeout(request.Context(), 10*time.Second)
	defer cancel()
	result, err := handler.queries.Query(ctx, input)
	if err != nil {
		switch {
		case errors.Is(err, query.ErrFunnelQueryTooExpensive), errors.Is(err, query.ErrFunnelCardinality), errors.Is(ctx.Err(), context.DeadlineExceeded):
			httpx.WriteError(writer, request, http.StatusUnprocessableEntity, "QUERY_TOO_EXPENSIVE", "The funnel exceeded its scan, cardinality, or execution budget.")
		case errors.Is(err, query.ErrInvalidFunnelQuery):
			httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "The funnel definition is invalid.")
		default:
			handler.logger.Error().Err(err).Str("project_id", projectID.String()).Msg("funnel query failed")
			httpx.WriteError(writer, request, http.StatusServiceUnavailable, "QUERY_UNAVAILABLE", "Funnel data is temporarily unavailable.")
		}
		return
	}
	writer.Header().Set("X-Query-Duration-Ms", strconv.FormatInt(time.Since(started).Milliseconds(), 10))
	writeJSON(writer, http.StatusOK, result)
}
