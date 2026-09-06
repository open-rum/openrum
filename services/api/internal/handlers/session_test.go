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

type fakeSessionQueries struct{ calls int }

func (fake *fakeSessionQueries) List(context.Context, query.SessionFilters) (query.SessionPage, error) {
	fake.calls++
	return query.SessionPage{Sessions: []query.SessionSummary{}, Page: 1, Limit: 50}, nil
}

func (fake *fakeSessionQueries) ListSession(context.Context, uuid.UUID, uuid.UUID, time.Time, time.Time) (query.SessionTimeline, error) {
	fake.calls++
	return query.SessionTimeline{Events: []query.SessionTimelineEvent{}}, nil
}

func TestSessionListHandlerChecksProjectBeforeQuery(t *testing.T) {
	events := &fakeSessionQueries{}
	handler := NewSessionHandler(fakeOverviewProjects{err: metadata.ErrNotFound}, events, zerolog.Nop())
	router := httpx.NewRouter(zerolog.Nop())
	authenticated := httpx.RequireSession(connectionFixtureAuthenticator{principal: auth.Principal{UserID: uuid.New()}})
	router.Handle("GET /api/v1/projects/{projectId}/analytics/sessions", authenticated(http.HandlerFunc(handler.List)))
	request := httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+uuid.NewString()+"/analytics/sessions?from=2026-09-03T00:00:00Z&to=2026-09-03T01:00:00Z", nil)
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "valid"})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusNotFound || events.calls != 0 {
		t.Fatalf("status=%d calls=%d body=%s", response.Code, events.calls, response.Body.String())
	}
}

func TestSessionHandlerChecksProjectBeforeTimelineQuery(t *testing.T) {
	events := &fakeSessionQueries{}
	handler := NewSessionHandler(fakeOverviewProjects{err: metadata.ErrNotFound}, events, zerolog.Nop())
	router := httpx.NewRouter(zerolog.Nop())
	authenticated := httpx.RequireSession(connectionFixtureAuthenticator{principal: auth.Principal{UserID: uuid.New()}})
	router.Handle("GET /api/v1/projects/{projectId}/analytics/sessions/{sessionId}", authenticated(http.HandlerFunc(handler.Get)))
	request := httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+uuid.NewString()+"/analytics/sessions/"+uuid.NewString()+"?from=2026-09-03T00:00:00Z&to=2026-09-03T01:00:00Z", nil)
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "valid"})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusNotFound || events.calls != 0 {
		t.Fatalf("status=%d calls=%d body=%s", response.Code, events.calls, response.Body.String())
	}
}
