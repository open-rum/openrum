package handlers

import (
	"context"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"openrum/internal/httpx"
	"openrum/internal/metadata"
	"openrum/internal/query"
)

type environmentQueries interface {
	Reported(context.Context, uuid.UUID) ([]query.ReportedEnvironment, error)
}

// EnvironmentHandler serves the environments a project has reported under. Every
// project accepts the four fixed environments; the Console lists only those with data.
type EnvironmentHandler struct {
	projects overviewProjects
	queries  environmentQueries
	logger   zerolog.Logger
}

func NewEnvironmentHandler(projects overviewProjects, queries environmentQueries, logger zerolog.Logger) *EnvironmentHandler {
	return &EnvironmentHandler{projects: projects, queries: queries, logger: logger}
}

func (handler *EnvironmentHandler) List(writer http.ResponseWriter, request *http.Request) {
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
	ctx, cancel := context.WithTimeout(request.Context(), 5*time.Second)
	defer cancel()
	reported, err := handler.queries.Reported(ctx, projectID)
	if err != nil {
		handler.logger.Error().Err(err).Str("project_id", projectID.String()).Msg("reported environment query failed")
		httpx.WriteError(writer, request, http.StatusServiceUnavailable, "QUERY_UNAVAILABLE", "Environments are temporarily unavailable.")
		return
	}
	// Data stored under a name from before the fixed set stays queryable elsewhere, but
	// the switcher offers only the four environments a project can report under today.
	environments := make([]query.ReportedEnvironment, 0, len(reported))
	for _, environment := range reported {
		if metadata.IsFixedEnvironment(environment.Name) {
			environments = append(environments, environment)
		}
	}
	writeJSON(writer, http.StatusOK, map[string]any{"environments": environments})
}
