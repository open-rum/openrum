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

type apiQueries interface {
	Get(context.Context, query.APIFilters) (query.APIResult, error)
}

type APIHandler struct {
	projects overviewProjects
	queries  apiQueries
	logger   zerolog.Logger
}

func NewAPIHandler(projects overviewProjects, queries apiQueries, logger zerolog.Logger) *APIHandler {
	return &APIHandler{projects: projects, queries: queries, logger: logger}
}

func (handler *APIHandler) Get(writer http.ResponseWriter, request *http.Request) {
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
	filters, err := parseAPIFilters(request, projectID)
	if err != nil {
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "A valid UTC range up to 30 days and bounded API filters are required.")
		return
	}
	ctx, cancel := context.WithTimeout(request.Context(), 10*time.Second)
	defer cancel()
	result, err := handler.queries.Get(ctx, filters)
	if err != nil {
		if errors.Is(err, query.ErrInvalidAPIFilters) {
			httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "API filters are invalid.")
			return
		}
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			httpx.WriteError(writer, request, http.StatusUnprocessableEntity, "QUERY_TOO_EXPENSIVE", "The API query exceeded its time budget.")
			return
		}
		handler.logger.Error().Err(err).Str("project_id", projectID.String()).Msg("API monitoring query failed")
		httpx.WriteError(writer, request, http.StatusServiceUnavailable, "QUERY_UNAVAILABLE", "API monitoring data is temporarily unavailable.")
		return
	}
	writeJSON(writer, http.StatusOK, result)
}

func parseAPIFilters(request *http.Request, projectID uuid.UUID) (query.APIFilters, error) {
	values := request.URL.Query()
	from, err := time.Parse(time.RFC3339Nano, values.Get("from"))
	if err != nil {
		return query.APIFilters{}, err
	}
	to, err := time.Parse(time.RFC3339Nano, values.Get("to"))
	if err != nil {
		return query.APIFilters{}, err
	}
	return query.NormalizeAPIFilters(query.APIFilters{
		ProjectID: projectID, From: from, To: to, Environment: values.Get("environment"),
		Release: values.Get("release"), Route: values.Get("route"), Methods: values["methods"],
		Method: values.Get("method"), URL: values.Get("url"), Search: values.Get("search"),
		Sort: values.Get("sort"), Compare: values.Get("compare") == "previous",
	})
}
