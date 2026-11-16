package handlers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"openrum/internal/auth"
	"openrum/internal/httpx"
	"openrum/internal/metadata"
	"openrum/internal/query"
	"testing"

	"github.com/google/uuid"
	"github.com/rs/zerolog"
)

type fakeLogQueries struct {
	calls   int
	filters query.LogFilters
}

func (fake *fakeLogQueries) List(_ context.Context, f query.LogFilters) (query.LogPage, error) {
	fake.calls++
	fake.filters = f
	return query.LogPage{Items: []query.LogEntry{}, Trend: []query.LogBucket{}, IntervalSeconds: 60}, nil
}
func TestLogsEnforceMembershipAndValidateBeforeQuery(t *testing.T) {
	for _, tc := range []struct {
		name                  string
		authenticated, denied bool
		query                 string
		status                int
	}{
		{"anonymous", false, false, "", 401}, {"other project", true, true, "", 403},
		{"invalid time", true, false, "from=bad", 400},
		{"valid", true, false, "from=2026-09-12T00:00:00Z&to=2026-09-13T00:00:00Z&level=warn&country=cn&q=logger:checkout", 200},
		{"bad limit", true, false, "from=2026-09-12T00:00:00Z&to=2026-09-13T00:00:00Z&limit=101", 400},
	} {
		t.Run(tc.name, func(t *testing.T) {
			queries := &fakeLogQueries{}
			projects := fakeOverviewProjects{}
			if tc.denied {
				projects.err = metadata.ErrForbidden
			}
			handler := NewLogHandler(projects, queries, zerolog.Nop())
			router := httpx.NewRouter(zerolog.Nop())
			var route http.Handler = http.HandlerFunc(handler.List)
			if tc.authenticated {
				route = httpx.RequireSession(connectionFixtureAuthenticator{principal: auth.Principal{UserID: uuid.New()}})(route)
			}
			router.Handle("GET /api/v1/projects/{projectId}/logs", route)
			projectID := uuid.New()
			request := httptest.NewRequestWithContext(context.Background(), "GET", "/api/v1/projects/"+projectID.String()+"/logs?"+tc.query, nil)
			request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "valid"})
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			if response.Code != tc.status {
				t.Fatalf("%d %s", response.Code, response.Body.String())
			}
			if tc.status != 200 && queries.calls != 0 {
				t.Fatal("queried without valid authorized filters")
			}
			if tc.status == 200 && (queries.filters.ProjectID != projectID || queries.filters.Country != "CN" || queries.filters.Level != "warn") {
				t.Fatalf("filters=%+v", queries.filters)
			}
		})
	}
}

func TestLogsPointBudgetIsValidatedAndPassedToQuery(t *testing.T) {
	for _, tc := range []struct {
		value  string
		status int
		budget int
	}{
		{"", 200, 0}, {"&maxPoints=30", 200, 30}, {"&maxPoints=0", 400, 0}, {"&maxPoints=23", 400, 0}, {"&maxPoints=241", 400, 0}, {"&maxPoints=bad", 400, 0},
	} {
		t.Run(tc.value, func(t *testing.T) {
			queries := &fakeLogQueries{}
			handler := NewLogHandler(fakeOverviewProjects{}, queries, zerolog.Nop())
			router := httpx.NewRouter(zerolog.Nop())
			router.Handle("GET /api/v1/projects/{projectId}/logs", httpx.RequireSession(connectionFixtureAuthenticator{principal: auth.Principal{UserID: uuid.New()}})(http.HandlerFunc(handler.List)))
			request := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/projects/"+uuid.New().String()+"/logs?from=2026-11-11T00:00:00Z&to=2026-11-12T00:00:00Z"+tc.value, nil)
			request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "valid"})
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			if response.Code != tc.status {
				t.Fatalf("%d %s", response.Code, response.Body.String())
			}
			if tc.status == 200 && queries.filters.MaxPoints != tc.budget {
				t.Fatalf("budget %d", queries.filters.MaxPoints)
			}
			if tc.status != 200 && queries.calls != 0 {
				t.Fatal("queried invalid budget")
			}
		})
	}
}

func TestLogsContextParametersValidatedAndForwarded(t *testing.T) {
	anchor := uuid.NewString()
	for _, tc := range []struct {
		extra  string
		status int
	}{
		{"&anchor=" + anchor + "&anchorAt=2026-11-11T13:21:31.184Z", 200},
		{"&anchor=bad&anchorAt=2026-11-11T13:21:31.184Z", 400},
		{"&anchor=" + anchor, 400},
		{"&anchorAt=2026-11-11T13:21:31.184Z", 400},
		{"&direction=before", 400},
	} {
		queries := &fakeLogQueries{}
		handler := NewLogHandler(fakeOverviewProjects{}, queries, zerolog.Nop())
		router := httpx.NewRouter(zerolog.Nop())
		router.Handle("GET /api/v1/projects/{projectId}/logs", httpx.RequireSession(connectionFixtureAuthenticator{principal: auth.Principal{UserID: uuid.New()}})(http.HandlerFunc(handler.List)))
		request := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/projects/"+uuid.NewString()+"/logs?from=2026-11-11T00:00:00Z&to=2026-11-12T00:00:00Z"+tc.extra, nil)
		request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "valid"})
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Code != tc.status {
			t.Fatalf("%s: %d %s", tc.extra, response.Code, response.Body.String())
		}
		if tc.status == 200 && (queries.filters.Anchor != anchor || queries.filters.AnchorAt != "2026-11-11T13:21:31.184Z") {
			t.Fatalf("lost context %+v", queries.filters)
		}
		if tc.status != 200 && queries.calls != 0 {
			t.Fatal("queried invalid context")
		}
	}
}
