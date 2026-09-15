package handlers

import (
	"context"
	"github.com/google/uuid"
	"github.com/rs/zerolog"
	"net/http"
	"net/http/httptest"
	"openrum/internal/auth"
	"openrum/internal/httpx"
	"openrum/internal/metadata"
	"openrum/internal/query"
	"testing"
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
			request := httptest.NewRequest("GET", "/api/v1/projects/"+projectID.String()+"/logs?"+tc.query, nil)
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
