package handlers

import (
	"bytes"
	"context"
	"encoding/json"
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

type fakeFunnelQueries struct {
	result query.FunnelResult
	calls  int
}

func (fake *fakeFunnelQueries) Query(context.Context, query.FunnelQuery) (query.FunnelResult, error) {
	fake.calls++
	return fake.result, nil
}

func TestFunnelHandlerRejectsExpensiveQueryBeforeClickHouse(t *testing.T) {
	queries := &fakeFunnelQueries{}
	router := funnelTestRouter(NewFunnelHandler(fakeOverviewProjects{}, queries, zerolog.Nop()), uuid.New())
	to := time.Date(2026, 9, 3, 12, 0, 0, 0, time.UTC)
	body, _ := json.Marshal(query.FunnelQuery{From: to.Add(-15 * 24 * time.Hour), To: to, WindowSeconds: 3600,
		Steps: []query.FunnelStep{{Kind: "page_view"}, {Kind: "click"}, {Kind: "custom", Name: "signup"}}})
	request := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/v1/projects/"+uuid.NewString()+"/analytics/funnels/query", bytes.NewReader(body))
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "valid"})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusUnprocessableEntity || queries.calls != 0 {
		t.Fatalf("status=%d calls=%d body=%s", response.Code, queries.calls, response.Body.String())
	}
}

func TestFunnelHandlerChecksProjectAccess(t *testing.T) {
	queries := &fakeFunnelQueries{}
	router := funnelTestRouter(NewFunnelHandler(fakeOverviewProjects{err: metadata.ErrNotFound}, queries, zerolog.Nop()), uuid.New())
	request := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/v1/projects/"+uuid.NewString()+"/analytics/funnels/query", bytes.NewBufferString(`{}`))
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "valid"})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusNotFound || queries.calls != 0 {
		t.Fatalf("status=%d calls=%d body=%s", response.Code, queries.calls, response.Body.String())
	}
}

func TestFunnelHandlerReturnsBoundedContract(t *testing.T) {
	queries := &fakeFunnelQueries{result: query.FunnelResult{Identity: "session_id", Approximate: true, Steps: []query.FunnelStepResult{}, Breakdown: []query.FunnelBreakdown{}, Samples: []query.FunnelSessionSample{}}}
	router := funnelTestRouter(NewFunnelHandler(fakeOverviewProjects{}, queries, zerolog.Nop()), uuid.New())
	to := time.Date(2026, 9, 3, 12, 0, 0, 0, time.UTC)
	body, _ := json.Marshal(query.FunnelQuery{From: to.Add(-time.Hour), To: to, Dimension: "country", WindowSeconds: 3600,
		Steps: []query.FunnelStep{{Kind: "page_view"}, {Kind: "click"}}})
	request := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/v1/projects/"+uuid.NewString()+"/analytics/funnels/query", bytes.NewReader(body))
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "valid"})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK || queries.calls != 1 || !contains(response.Body.String(), `"identity":"session_id"`) {
		t.Fatalf("status=%d calls=%d body=%s", response.Code, queries.calls, response.Body.String())
	}
}

func funnelTestRouter(handler *FunnelHandler, userID uuid.UUID) http.Handler {
	router := httpx.NewRouter(zerolog.Nop())
	authenticated := httpx.RequireSession(connectionFixtureAuthenticator{principal: auth.Principal{UserID: userID}})
	router.Handle("POST /api/v1/projects/{projectId}/analytics/funnels/query", authenticated(http.HandlerFunc(handler.Query)))
	return router
}
