package handlers

import (
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
	"openrum/internal/query"
)

type fakeBehaviorQueries struct {
	result  query.BehaviorAnalytics
	samples query.BehaviorSamplePage
	err     error
	calls   int
}

func (fake *fakeBehaviorQueries) Get(context.Context, query.BehaviorFilters) (query.BehaviorAnalytics, error) {
	fake.calls++
	return fake.result, fake.err
}

func (fake *fakeBehaviorQueries) ListSamples(context.Context, query.BehaviorFilters) (query.BehaviorSamplePage, error) {
	fake.calls++
	return fake.samples, fake.err
}

func TestAnalyticsHandlerRejectsExpensiveQueryBeforeClickHouse(t *testing.T) {
	userID, projectID := uuid.New(), uuid.New()
	queries := &fakeBehaviorQueries{}
	handler := NewAnalyticsHandler(fakeOverviewProjects{}, queries, zerolog.Nop())
	router := analyticsTestRouter(handler, userID)
	to := time.Date(2026, 9, 3, 12, 0, 0, 0, time.UTC)
	request := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/projects/"+projectID.String()+"/analytics/events?dimension=property:campaign&from="+
		to.Add(-30*24*time.Hour).Format(time.RFC3339)+"&to="+to.Format(time.RFC3339), nil)
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "valid"})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusUnprocessableEntity || queries.calls != 0 {
		t.Fatalf("status=%d calls=%d body=%s", response.Code, queries.calls, response.Body.String())
	}
	var payload httpx.ErrorEnvelope
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil || payload.Error.Code != "QUERY_TOO_EXPENSIVE" {
		t.Fatalf("payload=%+v err=%v", payload, err)
	}
}

func TestAnalyticsHandlerReturnsBoundedContract(t *testing.T) {
	userID, projectID := uuid.New(), uuid.New()
	queries := &fakeBehaviorQueries{result: query.BehaviorAnalytics{Dimension: "browser", Breakdown: []query.BehaviorBreakdown{}, Trend: []query.BehaviorTrendPoint{}, RowLimit: 100}}
	router := analyticsTestRouter(NewAnalyticsHandler(fakeOverviewProjects{}, queries, zerolog.Nop()), userID)
	to := time.Date(2026, 9, 3, 12, 0, 0, 0, time.UTC)
	request := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/projects/"+projectID.String()+"/analytics/events?dimension=browser&from="+
		to.Add(-time.Hour).Format(time.RFC3339)+"&to="+to.Format(time.RFC3339), nil)
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "valid"})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK || queries.calls != 1 || !contains(response.Body.String(), `"rowLimit":100`) {
		t.Fatalf("status=%d calls=%d body=%s", response.Code, queries.calls, response.Body.String())
	}
}

func analyticsTestRouter(handler *AnalyticsHandler, userID uuid.UUID) http.Handler {
	router := httpx.NewRouter(zerolog.Nop())
	authenticated := httpx.RequireSession(connectionFixtureAuthenticator{principal: auth.Principal{UserID: userID}})
	router.Handle("GET /api/v1/projects/{projectId}/analytics/events", authenticated(http.HandlerFunc(handler.Get)))
	router.Handle("GET /api/v1/projects/{projectId}/analytics/events/samples", authenticated(http.HandlerFunc(handler.Samples)))
	return router
}
