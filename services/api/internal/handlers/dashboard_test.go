package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"openrum/internal/auth"
	"openrum/internal/httpx"
	"openrum/internal/metadata"
)

type fakeDashboards struct {
	current metadata.NamedDashboard
	err     error
	saved   bool
}

func (repository *fakeDashboards) Get(context.Context, uuid.UUID, uuid.UUID) (metadata.Dashboard, error) {
	return metadata.Dashboard{Config: repository.current.Config, Revision: repository.current.Revision}, repository.err
}
func (repository *fakeDashboards) Save(context.Context, uuid.UUID, uuid.UUID, json.RawMessage, int64) (metadata.Dashboard, error) {
	repository.saved = true
	return metadata.Dashboard{Revision: repository.current.Revision + 1}, repository.err
}
func (repository *fakeDashboards) List(context.Context, uuid.UUID, uuid.UUID) ([]metadata.DashboardSummary, error) {
	return []metadata.DashboardSummary{{ID: repository.current.ID, Name: repository.current.Name}}, repository.err
}
func (repository *fakeDashboards) GetByID(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) (metadata.NamedDashboard, error) {
	return repository.current, repository.err
}
func (repository *fakeDashboards) Create(_ context.Context, _, _ uuid.UUID, name string, config json.RawMessage) (metadata.NamedDashboard, error) {
	return metadata.NamedDashboard{ID: uuid.New(), Name: name, Config: config, Revision: 1}, repository.err
}
func (repository *fakeDashboards) Duplicate(_ context.Context, _, _, _ uuid.UUID, name string) (metadata.NamedDashboard, error) {
	return metadata.NamedDashboard{ID: uuid.New(), Name: name, Revision: 1}, repository.err
}
func (repository *fakeDashboards) SaveConfig(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, json.RawMessage, int64) (metadata.NamedDashboard, error) {
	repository.saved = true
	next := repository.current
	next.Revision++
	return next, repository.err
}
func (repository *fakeDashboards) Rename(_ context.Context, _, _, _ uuid.UUID, name string) (metadata.NamedDashboard, error) {
	next := repository.current
	next.Name = name
	return next, repository.err
}
func (repository *fakeDashboards) Reorder(context.Context, uuid.UUID, uuid.UUID, []uuid.UUID) ([]metadata.DashboardSummary, error) {
	return nil, repository.err
}
func (repository *fakeDashboards) Delete(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) error {
	return repository.err
}

func dashboardTestRouter(handler *DashboardHandler, userID uuid.UUID) http.Handler {
	router := httpx.NewRouter(zerolog.Nop())
	authenticated := httpx.RequireSession(connectionFixtureAuthenticator{principal: auth.Principal{UserID: userID}})
	base := "/api/v1/projects/{projectId}"
	router.Handle("GET "+base+"/overview/config", authenticated(http.HandlerFunc(handler.Get)))
	router.Handle("GET "+base+"/dashboards", authenticated(http.HandlerFunc(handler.List)))
	router.Handle("POST "+base+"/dashboards", authenticated(http.HandlerFunc(handler.Create)))
	router.Handle("PUT "+base+"/dashboards/order", authenticated(http.HandlerFunc(handler.Reorder)))
	router.Handle("PATCH "+base+"/dashboards/{dashboardId}", authenticated(http.HandlerFunc(handler.Rename)))
	router.Handle("DELETE "+base+"/dashboards/{dashboardId}", authenticated(http.HandlerFunc(handler.Delete)))
	router.Handle("PUT "+base+"/dashboards/{dashboardId}/config", authenticated(http.HandlerFunc(handler.PutConfig)))
	return router
}

func dashboardRequest(method, path, body string) *http.Request {
	request := httptest.NewRequestWithContext(context.Background(), method, path, strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "valid"})
	return request
}

func TestDashboardHandlerErrorCodes(t *testing.T) {
	userID, projectID, dashboardID := uuid.New(), uuid.New(), uuid.New()
	base := "/api/v1/projects/" + projectID.String() + "/dashboards"
	for name, current := range map[string]struct {
		err    error
		method string
		path   string
		body   string
		status int
		code   string
	}{
		"name taken":   {metadata.ErrDashboardNameTaken, http.MethodPatch, base + "/" + dashboardID.String(), `{"name":"API"}`, http.StatusConflict, "DASHBOARD_NAME_TAKEN"},
		"limit":        {metadata.ErrDashboardLimitReached, http.MethodPost, base, `{"name":"x","config":{"schemaVersion":1,"widgets":[]}}`, http.StatusConflict, "DASHBOARD_LIMIT_REACHED"},
		"stale order":  {metadata.ErrDashboardOrderStale, http.MethodPut, base + "/order", `{"ids":["` + dashboardID.String() + `"]}`, http.StatusConflict, "DASHBOARD_ORDER_STALE"},
		"bad name":     {metadata.ErrInvalidDashboardName, http.MethodPatch, base + "/" + dashboardID.String(), `{"name":" "}`, http.StatusBadRequest, "VALIDATION_ERROR"},
		"deleted":      {metadata.ErrNotFound, http.MethodDelete, base + "/" + dashboardID.String(), ``, http.StatusNotFound, "NOT_FOUND"},
		"invalid json": {nil, http.MethodPost, base, `{"name":"x","config":{"schemaVersion":2,"widgets":[]}}`, http.StatusBadRequest, "VALIDATION_ERROR"},
	} {
		repository := &fakeDashboards{err: current.err}
		router := dashboardTestRouter(NewDashboardHandler(fakeOverviewProjects{}, repository, zerolog.Nop()), userID)
		response := httptest.NewRecorder()
		router.ServeHTTP(response, dashboardRequest(current.method, current.path, current.body))
		var payload httpx.ErrorEnvelope
		_ = json.Unmarshal(response.Body.Bytes(), &payload)
		if response.Code != current.status || payload.Error.Code != current.code {
			t.Errorf("%s: status=%d code=%q body=%s", name, response.Code, payload.Error.Code, response.Body.String())
		}
	}
}

func TestDashboardConfigSaveChecksRevisionBeforeValidating(t *testing.T) {
	userID, projectID, dashboardID := uuid.New(), uuid.New(), uuid.New()
	repository := &fakeDashboards{current: metadata.NamedDashboard{ID: dashboardID, Revision: 4, Config: json.RawMessage(`{"schemaVersion":1,"widgets":[]}`), UpdatedAt: time.Now()}}
	router := dashboardTestRouter(NewDashboardHandler(fakeOverviewProjects{}, repository, zerolog.Nop()), userID)
	path := "/api/v1/projects/" + projectID.String() + "/dashboards/" + dashboardID.String() + "/config"
	response := httptest.NewRecorder()
	router.ServeHTTP(response, dashboardRequest(http.MethodPut, path, `{"config":{"schemaVersion":1,"widgets":[]},"revision":3}`))
	if response.Code != http.StatusConflict || repository.saved {
		t.Fatalf("a stale revision is refused before anything is written: status=%d saved=%v", response.Code, repository.saved)
	}
	response = httptest.NewRecorder()
	router.ServeHTTP(response, dashboardRequest(http.MethodPut, path, `{"config":{"schemaVersion":1,"widgets":[]},"revision":4}`))
	if response.Code != http.StatusOK || !repository.saved {
		t.Fatalf("the current revision saves: status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestDashboardDeleteReturnsNoContent(t *testing.T) {
	userID, projectID, dashboardID := uuid.New(), uuid.New(), uuid.New()
	router := dashboardTestRouter(NewDashboardHandler(fakeOverviewProjects{}, &fakeDashboards{}, zerolog.Nop()), userID)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, dashboardRequest(http.MethodDelete, "/api/v1/projects/"+projectID.String()+"/dashboards/"+dashboardID.String(), ""))
	if response.Code != http.StatusNoContent {
		t.Fatalf("status=%d", response.Code)
	}
}

func TestLegacyDashboardEndpointAnnouncesItsSuccessor(t *testing.T) {
	userID, projectID := uuid.New(), uuid.New()
	router := dashboardTestRouter(NewDashboardHandler(fakeOverviewProjects{}, &fakeDashboards{}, zerolog.Nop()), userID)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, dashboardRequest(http.MethodGet, "/api/v1/projects/"+projectID.String()+"/overview/config", ""))
	if response.Code != http.StatusOK || response.Header().Get("Deprecation") != "true" ||
		!strings.Contains(response.Header().Get("Link"), "/dashboards>; rel=\"successor-version\"") {
		t.Fatalf("status=%d headers=%v", response.Code, response.Header())
	}
}
