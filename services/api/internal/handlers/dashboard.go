package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/google/uuid"
	"github.com/rs/zerolog"
	"openrum/internal/httpx"
	"openrum/internal/metadata"
)

type dashboardRepository interface {
	Get(context.Context, uuid.UUID, uuid.UUID) (metadata.Dashboard, error)
	Save(context.Context, uuid.UUID, uuid.UUID, json.RawMessage, int64) (metadata.Dashboard, error)
}

type DashboardHandler struct {
	projects   overviewProjects
	dashboards dashboardRepository
	logger     zerolog.Logger
}

func NewDashboardHandler(projects overviewProjects, dashboards dashboardRepository, logger zerolog.Logger) *DashboardHandler {
	return &DashboardHandler{projects: projects, dashboards: dashboards, logger: logger}
}

func (handler *DashboardHandler) identity(writer http.ResponseWriter, request *http.Request) (uuid.UUID, uuid.UUID, bool) {
	writer.Header().Set("Cache-Control", "private, no-store")
	principal, ok := httpx.PrincipalFromContext(request.Context())
	if !ok {
		httpx.WriteError(writer, request, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication is required.")
		return uuid.Nil, uuid.Nil, false
	}
	projectID, ok := parsePathUUID(writer, request, "projectId")
	if !ok {
		return uuid.Nil, uuid.Nil, false
	}
	if _, err := handler.projects.GetForUser(request.Context(), principal.UserID, projectID); err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return uuid.Nil, uuid.Nil, false
	}
	return principal.UserID, projectID, true
}

func (handler *DashboardHandler) Get(writer http.ResponseWriter, request *http.Request) {
	userID, projectID, ok := handler.identity(writer, request)
	if !ok {
		return
	}
	result, err := handler.dashboards.Get(request.Context(), userID, projectID)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	writeJSON(writer, http.StatusOK, result)
}

func (handler *DashboardHandler) Put(writer http.ResponseWriter, request *http.Request) {
	userID, projectID, ok := handler.identity(writer, request)
	if !ok {
		return
	}
	var payload struct {
		Config   json.RawMessage `json:"config"`
		Revision *int64          `json:"revision"`
	}
	if !decodeJSONBodyWithLimit(writer, request, &payload, 72<<10) {
		return
	}
	if payload.Revision == nil || *payload.Revision < 0 {
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "A non-negative revision is required.")
		return
	}
	current, err := handler.dashboards.Get(request.Context(), userID, projectID)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	if current.Revision != *payload.Revision {
		handler.conflict(writer, request)
		return
	}
	if err := metadata.ValidateDashboardConfig(payload.Config, current.Config); err != nil {
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
		return
	}
	result, err := handler.dashboards.Save(request.Context(), userID, projectID, payload.Config, *payload.Revision)
	if errors.Is(err, metadata.ErrConfigVersionConflict) {
		handler.conflict(writer, request)
		return
	}
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	writeJSON(writer, http.StatusOK, result)
}

func (handler *DashboardHandler) conflict(writer http.ResponseWriter, request *http.Request) {
	httpx.WriteError(writer, request, http.StatusConflict, "CONFIG_VERSION_CONFLICT", "The dashboard changed on another device. Reload before saving.")
}
