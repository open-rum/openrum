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

type fakePerformanceQueries struct {
	filters query.PerformanceFilters
}

func (fake *fakePerformanceQueries) Get(_ context.Context, filters query.PerformanceFilters) (query.PerformanceResult, error) {
	fake.filters = filters
	return query.PerformanceResult{From: filters.From, To: filters.To, Routes: []query.RoutePerformance{}, Trend: []query.PerformanceTrendPoint{}}, nil
}

func TestPerformanceHandlerValidatesAndReturnsBoundedResult(t *testing.T) {
	userID, projectID := uuid.New(), uuid.New()
	queries := &fakePerformanceQueries{}
	handler := NewPerformanceHandler(fakeOverviewProjects{access: metadata.ProjectAccess{Role: metadata.RoleViewer}}, queries, zerolog.Nop())
	router := httpx.NewRouter(zerolog.Nop())
	authenticated := httpx.RequireSession(connectionFixtureAuthenticator{principal: auth.Principal{UserID: userID}})
	router.Handle("GET /api/v1/projects/{projectId}/performance", authenticated(http.HandlerFunc(handler.Get)))
	from := time.Date(2026, 9, 3, 0, 0, 0, 0, time.UTC)
	url := "/api/v1/projects/" + projectID.String() + "/performance?from=" + from.Format(time.RFC3339Nano) + "&to=" + from.Add(time.Hour).Format(time.RFC3339Nano) + "&metric=inp&route=%2Fcheckout&percentile=p99&country=cn&deviceType=mobile&browser=Safari"
	request := httptest.NewRequestWithContext(context.Background(), http.MethodGet, url, nil)
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "valid"})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK || queries.filters.Metric != "INP" || queries.filters.Route != "/checkout" {
		t.Fatalf("status=%d filters=%+v body=%s", response.Code, queries.filters, response.Body.String())
	}
	if queries.filters.Country != "CN" || queries.filters.DeviceType != "mobile" || queries.filters.Browser != "Safari" || queries.filters.Percentile != "p99" {
		t.Fatalf("dimensions not forwarded: %+v", queries.filters)
	}

	request = httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/projects/"+projectID.String()+"/performance?from=bad&to=bad", nil)
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "valid"})
	response = httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("invalid status=%d body=%s", response.Code, response.Body.String())
	}
}
