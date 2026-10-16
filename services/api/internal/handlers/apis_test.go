package handlers

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"openrum/internal/auth"
	"openrum/internal/httpx"
	"openrum/internal/query"
)

type fakeAPIQueries struct {
	filters query.APIFilters
	samples query.APISamples
	err     error
	calls   int
}

func (queries *fakeAPIQueries) Get(context.Context, query.APIFilters) (query.APIResult, error) {
	return query.APIResult{}, queries.err
}

func (queries *fakeAPIQueries) Samples(_ context.Context, filters query.APIFilters) (query.APISamples, error) {
	queries.calls++
	queries.filters = filters
	return queries.samples, queries.err
}

func apiSamplesRouter(queries *fakeAPIQueries, userID uuid.UUID) http.Handler {
	handler := NewAPIHandler(fakeOverviewProjects{}, queries, zerolog.Nop())
	router := httpx.NewRouter(zerolog.Nop())
	authenticated := httpx.RequireSession(connectionFixtureAuthenticator{principal: auth.Principal{UserID: userID}})
	router.Handle("GET /api/v1/projects/{projectId}/apis/samples", authenticated(http.HandlerFunc(handler.Samples)))
	return router
}

func apiSamplesRequest(projectID uuid.UUID, extra url.Values) *http.Request {
	to := time.Date(2026, 10, 12, 12, 0, 0, 0, time.UTC)
	values := url.Values{"from": {to.Add(-time.Hour).Format(time.RFC3339)}, "to": {to.Format(time.RFC3339)}}
	for key, list := range extra {
		values[key] = list
	}
	request := httptest.NewRequestWithContext(context.Background(), http.MethodGet,
		"/api/v1/projects/"+projectID.String()+"/apis/samples?"+values.Encode(), nil)
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "valid"})
	return request
}

func TestAPISamplesPassesTheEndpointAndUserSearchToTheQuery(t *testing.T) {
	queries := &fakeAPIQueries{samples: query.APISamples{Samples: []query.APISample{{Method: "GET"}}}}
	projectID := uuid.New()
	response := httptest.NewRecorder()
	apiSamplesRouter(queries, uuid.New()).ServeHTTP(response, apiSamplesRequest(projectID, url.Values{
		"method": {"GET"}, "url": {"https://shop.example.com/api/feed"}, "user": {" uid_abc "},
	}))
	if response.Code != http.StatusOK || queries.calls != 1 {
		t.Fatalf("status=%d calls=%d body=%s", response.Code, queries.calls, response.Body.String())
	}
	if queries.filters.User != "uid_abc" || queries.filters.Method != "GET" || queries.filters.ProjectID != projectID {
		t.Fatalf("filters=%+v, want the trimmed user, the endpoint and the project from the path", queries.filters)
	}
}

func TestAPISamplesRejectsAnOverlongUserBeforeQuerying(t *testing.T) {
	queries := &fakeAPIQueries{}
	response := httptest.NewRecorder()
	apiSamplesRouter(queries, uuid.New()).ServeHTTP(response, apiSamplesRequest(uuid.New(), url.Values{
		"method": {"GET"}, "url": {"https://shop.example.com/api/feed"}, "user": {strings.Repeat("u", 129)},
	}))
	if response.Code != http.StatusBadRequest || queries.calls != 0 {
		t.Fatalf("status=%d calls=%d", response.Code, queries.calls)
	}
}

func TestAPISamplesMapsAMissingEndpointToAValidationError(t *testing.T) {
	queries := &fakeAPIQueries{err: query.ErrInvalidAPIFilters}
	response := httptest.NewRecorder()
	apiSamplesRouter(queries, uuid.New()).ServeHTTP(response, apiSamplesRequest(uuid.New(), nil))
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "VALIDATION_ERROR") {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestAPISamplesDoesNotLeakABackendFailure(t *testing.T) {
	queries := &fakeAPIQueries{err: errors.New("dial tcp private-clickhouse: connection refused")}
	response := httptest.NewRecorder()
	apiSamplesRouter(queries, uuid.New()).ServeHTTP(response, apiSamplesRequest(uuid.New(), url.Values{
		"method": {"GET"}, "url": {"https://shop.example.com/api/feed"},
	}))
	if response.Code != http.StatusServiceUnavailable || strings.Contains(response.Body.String(), "private-clickhouse") {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}
