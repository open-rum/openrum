package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"openrum/internal/auth"
	"openrum/internal/httpx"
	"openrum/internal/metadata"
	"openrum/internal/query"
)

type fakeOverviewProjects struct {
	access metadata.ProjectAccess
	err    error
}

func (repository fakeOverviewProjects) GetForUser(context.Context, uuid.UUID, uuid.UUID) (metadata.ProjectAccess, error) {
	return repository.access, repository.err
}

type fakeOverviewRepository struct {
	result query.Overview
	err    error
	calls  int
}

func (repository *fakeOverviewRepository) Get(context.Context, query.OverviewFilters) (query.Overview, error) {
	repository.calls++
	return repository.result, repository.err
}

func TestOverviewHandlerRejectsExpensiveQueryBeforeClickHouse(t *testing.T) {
	userID, projectID := uuid.New(), uuid.New()
	repository := &fakeOverviewRepository{}
	handler := NewOverviewHandler(fakeOverviewProjects{}, repository, nil, nil, zerolog.Nop())
	router := overviewTestRouter(handler, userID)
	to := time.Date(2026, 9, 2, 12, 0, 0, 0, time.UTC)
	request := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/projects/"+projectID.String()+"/overview?from="+
		to.Add(-30*24*time.Hour).Format(time.RFC3339)+"&to="+to.Format(time.RFC3339), nil)
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "valid"})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusUnprocessableEntity || repository.calls != 0 {
		t.Fatalf("status=%d calls=%d body=%s", response.Code, repository.calls, response.Body.String())
	}
	var payload httpx.ErrorEnvelope
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil || payload.Error.Code != "QUERY_TOO_EXPENSIVE" {
		t.Fatalf("payload=%+v err=%v", payload, err)
	}
}

func TestOverviewHandlerReturnsUnavailableWithoutLeakingBackendError(t *testing.T) {
	userID, projectID := uuid.New(), uuid.New()
	repository := &fakeOverviewRepository{err: errors.New("dial tcp private-clickhouse: connection refused")}
	handler := NewOverviewHandler(fakeOverviewProjects{}, repository, nil, nil, zerolog.Nop())
	router := overviewTestRouter(handler, userID)
	to := time.Date(2026, 9, 2, 12, 0, 0, 0, time.UTC)
	request := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/projects/"+projectID.String()+"/overview?from="+
		to.Add(-time.Hour).Format(time.RFC3339)+"&to="+to.Format(time.RFC3339), nil)
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "valid"})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusServiceUnavailable || repository.calls != 1 ||
		contains(response.Body.String(), "private-clickhouse") {
		t.Fatalf("status=%d calls=%d body=%s", response.Code, repository.calls, response.Body.String())
	}
}

func overviewTestRouter(handler *OverviewHandler, userID uuid.UUID) http.Handler {
	router := httpx.NewRouter(zerolog.Nop())
	authenticated := httpx.RequireSession(connectionFixtureAuthenticator{principal: auth.Principal{UserID: userID}})
	router.Handle("GET /api/v1/projects/{projectId}/overview", authenticated(http.HandlerFunc(handler.Get)))
	return router
}

func contains(value, substring string) bool {
	for index := 0; index+len(substring) <= len(value); index++ {
		if value[index:index+len(substring)] == substring {
			return true
		}
	}
	return false
}
