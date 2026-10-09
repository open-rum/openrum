package handlers

import (
	"context"
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

type fakePathQueries struct{ calls int }

func (fake *fakePathQueries) Query(context.Context, query.PathQuery) (query.PathResult, error) {
	fake.calls++
	return query.PathResult{Identity: "session_id", Paths: []query.PathRow{}}, nil
}

type fakeRetentionQueries struct{ calls int }

func (fake *fakeRetentionQueries) Query(context.Context, query.RetentionQuery) (query.RetentionResult, error) {
	fake.calls++
	return query.RetentionResult{Identity: "anonymous_user_id", Cohorts: []query.RetentionCohort{}}, nil
}

func TestJourneyHandlerChecksProjectAccess(t *testing.T) {
	paths, retention := &fakePathQueries{}, &fakeRetentionQueries{}
	handler := NewJourneyHandler(fakeOverviewProjects{err: metadata.ErrNotFound}, paths, retention, zerolog.Nop())
	router := journeyTestRouter(handler, uuid.New())
	request := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/projects/"+uuid.NewString()+"/analytics/paths?from=2026-09-01T00:00:00Z&to=2026-09-02T00:00:00Z", nil)
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "valid"})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusNotFound || paths.calls != 0 {
		t.Fatalf("status=%d calls=%d body=%s", response.Code, paths.calls, response.Body.String())
	}
}

func TestJourneyHandlerRejectsUnboundedPathBeforeQuery(t *testing.T) {
	paths, retention := &fakePathQueries{}, &fakeRetentionQueries{}
	handler := NewJourneyHandler(fakeOverviewProjects{}, paths, retention, zerolog.Nop())
	router := journeyTestRouter(handler, uuid.New())
	to := time.Date(2026, 9, 3, 0, 0, 0, 0, time.UTC)
	request := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/projects/"+uuid.NewString()+"/analytics/paths?depth=5&topN=20&from="+to.Add(-8*24*time.Hour).Format(time.RFC3339)+"&to="+to.Format(time.RFC3339), nil)
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "valid"})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest || paths.calls != 0 {
		t.Fatalf("status=%d calls=%d body=%s", response.Code, paths.calls, response.Body.String())
	}
}

func journeyTestRouter(handler *JourneyHandler, userID uuid.UUID) http.Handler {
	router := httpx.NewRouter(zerolog.Nop())
	authenticated := httpx.RequireSession(connectionFixtureAuthenticator{principal: auth.Principal{UserID: userID}})
	router.Handle("GET /api/v1/projects/{projectId}/analytics/paths", authenticated(http.HandlerFunc(handler.Paths)))
	router.Handle("GET /api/v1/projects/{projectId}/analytics/retention", authenticated(http.HandlerFunc(handler.Retention)))
	return router
}
