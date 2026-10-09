package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"openrum/internal/httpx"
	"openrum/internal/metadata"

	"github.com/google/uuid"
	"github.com/rs/zerolog"
)

type dashboardRepository interface {
	Get(context.Context, uuid.UUID, uuid.UUID) (metadata.Dashboard, error)
	Save(context.Context, uuid.UUID, uuid.UUID, json.RawMessage, int64) (metadata.Dashboard, error)
	List(context.Context, uuid.UUID, uuid.UUID) ([]metadata.DashboardSummary, error)
	GetByID(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) (metadata.NamedDashboard, error)
	Create(context.Context, uuid.UUID, uuid.UUID, string, json.RawMessage) (metadata.NamedDashboard, error)
	Duplicate(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, string) (metadata.NamedDashboard, error)
	SaveConfig(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, json.RawMessage, int64) (metadata.NamedDashboard, error)
	Rename(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, string) (metadata.NamedDashboard, error)
	Reorder(context.Context, uuid.UUID, uuid.UUID, []uuid.UUID) ([]metadata.DashboardSummary, error)
	Delete(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) error
}

type DashboardHandler struct {
	projects   overviewProjects
	dashboards dashboardRepository
	logger     zerolog.Logger
}

func NewDashboardHandler(projects overviewProjects, dashboards dashboardRepository, logger zerolog.Logger) *DashboardHandler {
	return &DashboardHandler{projects: projects, dashboards: dashboards, logger: logger}
}

const dashboardBodyLimit = 72 << 10

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

func (handler *DashboardHandler) dashboardIdentity(writer http.ResponseWriter, request *http.Request) (uuid.UUID, uuid.UUID, uuid.UUID, bool) {
	userID, projectID, ok := handler.identity(writer, request)
	if !ok {
		return uuid.Nil, uuid.Nil, uuid.Nil, false
	}
	dashboardID, ok := parsePathUUID(writer, request, "dashboardId")
	if !ok {
		return uuid.Nil, uuid.Nil, uuid.Nil, false
	}
	return userID, projectID, dashboardID, true
}

func (handler *DashboardHandler) List(writer http.ResponseWriter, request *http.Request) {
	userID, projectID, ok := handler.identity(writer, request)
	if !ok {
		return
	}
	dashboards, err := handler.dashboards.List(request.Context(), userID, projectID)
	if err != nil {
		handler.fail(writer, request, err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"dashboards": dashboards})
}

func (handler *DashboardHandler) Create(writer http.ResponseWriter, request *http.Request) {
	userID, projectID, ok := handler.identity(writer, request)
	if !ok {
		return
	}
	var payload struct {
		Name   string          `json:"name"`
		Config json.RawMessage `json:"config"`
	}
	if !decodeJSONBodyWithLimit(writer, request, &payload, dashboardBodyLimit) {
		return
	}
	if err := metadata.ValidateDashboardConfig(payload.Config, nil); err != nil {
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
		return
	}
	created, err := handler.dashboards.Create(request.Context(), userID, projectID, payload.Name, payload.Config)
	if err != nil {
		handler.fail(writer, request, err)
		return
	}
	writeJSON(writer, http.StatusCreated, created)
}

func (handler *DashboardHandler) GetByID(writer http.ResponseWriter, request *http.Request) {
	userID, projectID, dashboardID, ok := handler.dashboardIdentity(writer, request)
	if !ok {
		return
	}
	dashboard, err := handler.dashboards.GetByID(request.Context(), userID, projectID, dashboardID)
	if err != nil {
		handler.fail(writer, request, err)
		return
	}
	writeJSON(writer, http.StatusOK, dashboard)
}

func (handler *DashboardHandler) PutConfig(writer http.ResponseWriter, request *http.Request) {
	userID, projectID, dashboardID, ok := handler.dashboardIdentity(writer, request)
	if !ok {
		return
	}
	var payload struct {
		Config   json.RawMessage `json:"config"`
		Revision *int64          `json:"revision"`
	}
	if !decodeJSONBodyWithLimit(writer, request, &payload, dashboardBodyLimit) {
		return
	}
	if payload.Revision == nil || *payload.Revision < 1 {
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "A positive revision is required.")
		return
	}
	current, err := handler.dashboards.GetByID(request.Context(), userID, projectID, dashboardID)
	if err != nil {
		handler.fail(writer, request, err)
		return
	}
	if current.Revision != *payload.Revision {
		handler.conflict(writer, request)
		return
	}
	// The previous configuration is what lets a module from a newer deployment be kept.
	if err := metadata.ValidateDashboardConfig(payload.Config, current.Config); err != nil {
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
		return
	}
	saved, err := handler.dashboards.SaveConfig(request.Context(), userID, projectID, dashboardID, payload.Config, *payload.Revision)
	if err != nil {
		handler.fail(writer, request, err)
		return
	}
	writeJSON(writer, http.StatusOK, saved)
}

func (handler *DashboardHandler) Rename(writer http.ResponseWriter, request *http.Request) {
	userID, projectID, dashboardID, ok := handler.dashboardIdentity(writer, request)
	if !ok {
		return
	}
	var payload struct {
		Name string `json:"name"`
	}
	if !decodeJSONBodyWithLimit(writer, request, &payload, 4<<10) {
		return
	}
	renamed, err := handler.dashboards.Rename(request.Context(), userID, projectID, dashboardID, payload.Name)
	if err != nil {
		handler.fail(writer, request, err)
		return
	}
	writeJSON(writer, http.StatusOK, renamed)
}

func (handler *DashboardHandler) Duplicate(writer http.ResponseWriter, request *http.Request) {
	userID, projectID, dashboardID, ok := handler.dashboardIdentity(writer, request)
	if !ok {
		return
	}
	var payload struct {
		Name string `json:"name"`
	}
	if !decodeJSONBodyWithLimit(writer, request, &payload, 4<<10) {
		return
	}
	created, err := handler.dashboards.Duplicate(request.Context(), userID, projectID, dashboardID, payload.Name)
	if err != nil {
		handler.fail(writer, request, err)
		return
	}
	writeJSON(writer, http.StatusCreated, created)
}

func (handler *DashboardHandler) Reorder(writer http.ResponseWriter, request *http.Request) {
	userID, projectID, ok := handler.identity(writer, request)
	if !ok {
		return
	}
	var payload struct {
		IDs []uuid.UUID `json:"ids"`
	}
	if !decodeJSONBodyWithLimit(writer, request, &payload, 8<<10) {
		return
	}
	if len(payload.IDs) == 0 || len(payload.IDs) > metadata.MaxDashboards {
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "The complete dashboard order is required.")
		return
	}
	dashboards, err := handler.dashboards.Reorder(request.Context(), userID, projectID, payload.IDs)
	if err != nil {
		handler.fail(writer, request, err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"dashboards": dashboards})
}

func (handler *DashboardHandler) Delete(writer http.ResponseWriter, request *http.Request) {
	userID, projectID, dashboardID, ok := handler.dashboardIdentity(writer, request)
	if !ok {
		return
	}
	if err := handler.dashboards.Delete(request.Context(), userID, projectID, dashboardID); err != nil {
		handler.fail(writer, request, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

// Get and Put serve the single-dashboard endpoint the Console used before named
// dashboards. They map to the user's first dashboard and are kept for one release.
func (handler *DashboardHandler) Get(writer http.ResponseWriter, request *http.Request) {
	userID, projectID, ok := handler.identity(writer, request)
	if !ok {
		return
	}
	handler.deprecated(writer, projectID)
	result, err := handler.dashboards.Get(request.Context(), userID, projectID)
	if err != nil {
		handler.fail(writer, request, err)
		return
	}
	writeJSON(writer, http.StatusOK, result)
}

func (handler *DashboardHandler) Put(writer http.ResponseWriter, request *http.Request) {
	userID, projectID, ok := handler.identity(writer, request)
	if !ok {
		return
	}
	handler.deprecated(writer, projectID)
	var payload struct {
		Config   json.RawMessage `json:"config"`
		Revision *int64          `json:"revision"`
	}
	if !decodeJSONBodyWithLimit(writer, request, &payload, dashboardBodyLimit) {
		return
	}
	if payload.Revision == nil || *payload.Revision < 0 {
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "A non-negative revision is required.")
		return
	}
	current, err := handler.dashboards.Get(request.Context(), userID, projectID)
	if err != nil {
		handler.fail(writer, request, err)
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
	if err != nil {
		handler.fail(writer, request, err)
		return
	}
	writeJSON(writer, http.StatusOK, result)
}

func (handler *DashboardHandler) deprecated(writer http.ResponseWriter, projectID uuid.UUID) {
	writer.Header().Set("Deprecation", "true")
	writer.Header().Set("Link", "</api/v1/projects/"+projectID.String()+"/dashboards>; rel=\"successor-version\"")
}

func (handler *DashboardHandler) fail(writer http.ResponseWriter, request *http.Request, err error) {
	switch {
	case errors.Is(err, metadata.ErrConfigVersionConflict):
		handler.conflict(writer, request)
	case errors.Is(err, metadata.ErrDashboardNameTaken):
		httpx.WriteError(writer, request, http.StatusConflict, "DASHBOARD_NAME_TAKEN", "Another dashboard already uses this name.")
	case errors.Is(err, metadata.ErrDashboardLimitReached):
		httpx.WriteError(writer, request, http.StatusConflict, "DASHBOARD_LIMIT_REACHED", "A project can hold at most 20 dashboards per person.")
	case errors.Is(err, metadata.ErrDashboardOrderStale):
		httpx.WriteError(writer, request, http.StatusConflict, "DASHBOARD_ORDER_STALE", "The dashboard list changed. Reload before reordering.")
	case errors.Is(err, metadata.ErrInvalidDashboardName):
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "A dashboard name needs 1 to 80 characters.")
	default:
		writeControlPlaneError(writer, request, handler.logger, err)
	}
}

func (handler *DashboardHandler) conflict(writer http.ResponseWriter, request *http.Request) {
	httpx.WriteError(writer, request, http.StatusConflict, "CONFIG_VERSION_CONFLICT", "The dashboard changed on another device. Reload before saving.")
}
