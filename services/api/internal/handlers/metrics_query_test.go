package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"openrum/internal/auth"
	"openrum/internal/catalog"
	"openrum/internal/httpx"
	"openrum/internal/metadata"
	"openrum/internal/query"
)

type fakeMetricsRepository struct {
	result  query.MetricsResult
	err     error
	calls   atomic.Int32
	release chan struct{}
	last    query.MetricsQuery
	mu      sync.Mutex
}

func (repository *fakeMetricsRepository) Run(_ context.Context, current query.MetricsQuery) (query.MetricsResult, error) {
	repository.calls.Add(1)
	repository.mu.Lock()
	repository.last = current
	repository.mu.Unlock()
	if repository.release != nil {
		<-repository.release
	}
	return repository.result, repository.err
}

func metricsRequest(projectID uuid.UUID, duration time.Duration, parameters url.Values) *http.Request {
	to := time.Date(2026, 9, 2, 12, 0, 0, 0, time.UTC)
	parameters.Set("from", to.Add(-duration).Format(time.RFC3339))
	parameters.Set("to", to.Format(time.RFC3339))
	request := httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+projectID.String()+"/metrics/query?"+parameters.Encode(), nil)
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "valid"})
	return request
}

func metricsTestRouter(handler *MetricsHandler, userID uuid.UUID) http.Handler {
	router := httpx.NewRouter(zerolog.Nop())
	authenticated := httpx.RequireSession(connectionFixtureAuthenticator{principal: auth.Principal{UserID: userID}})
	router.Handle("GET /api/v1/projects/{projectId}/metrics/query", authenticated(http.HandlerFunc(handler.Query)))
	router.Handle("GET /api/v1/projects/{projectId}/metrics/catalog", authenticated(http.HandlerFunc(handler.Catalog)))
	return router
}

func decodeError(t *testing.T, response *httptest.ResponseRecorder) httpx.ErrorEnvelope {
	t.Helper()
	var payload httpx.ErrorEnvelope
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("body=%s err=%v", response.Body.String(), err)
	}
	return payload
}

func TestMetricsQueryParsesEveryParameter(t *testing.T) {
	userID, projectID := uuid.New(), uuid.New()
	repository := &fakeMetricsRepository{result: query.MetricsResult{Shape: catalog.ShapeTable}}
	router := metricsTestRouter(NewMetricsHandler(fakeOverviewProjects{}, repository, nil, nil, zerolog.Nop()), userID)
	parameters := url.Values{
		"metric": {"traffic.errorRate", "traffic.pageViews"}, "shape": {"table"}, "dimension": {"browser"},
		"release": {"1.2.0"}, "country": {"CN"}, "compare": {"previous"}, "topN": {"15"},
		"sort": {"traffic.pageViews"}, "order": {"asc"}, "sparkline": {"true"}, "environment": {"production"},
		"maxPoints": {"30"},
	}
	response := httptest.NewRecorder()
	router.ServeHTTP(response, metricsRequest(projectID, 6*time.Hour, parameters))
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	spec := repository.last.Spec
	if len(spec.Metrics) != 2 || spec.Metrics[0] != "traffic.errorRate" || spec.Dimension != "browser" ||
		spec.Filters["release"] != "1.2.0" || spec.Filters["country"] != "CN" || !spec.Compare || spec.TopN != 15 ||
		spec.Sort != "traffic.pageViews" || spec.Order != "asc" || !spec.Sparkline ||
		repository.last.Environment != "production" || repository.last.MaxPoints != 30 {
		t.Fatalf("parameters were not all carried through: %+v env=%q", spec, repository.last.Environment)
	}
	if response.Header().Get("X-OpenRUM-Cache") != "MISS" {
		t.Fatal("a fresh answer is a cache miss")
	}
}

func TestMetricsQueryCarriesPinnedGroupsInOrder(t *testing.T) {
	userID, projectID := uuid.New(), uuid.New()
	repository := &fakeMetricsRepository{result: query.MetricsResult{Shape: catalog.ShapeSeriesByDimension}}
	router := metricsTestRouter(NewMetricsHandler(fakeOverviewProjects{}, repository, nil, nil, zerolog.Nop()), userID)
	parameters := url.Values{
		"metric": {"behavior.events"}, "shape": {"seriesByDimension"}, "dimension": {"eventName"},
		"group": {"pay_start", "pay_success", "pay_failed"}, "eventKind": {"custom"},
	}
	response := httptest.NewRecorder()
	router.ServeHTTP(response, metricsRequest(projectID, 6*time.Hour, parameters))
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	spec := repository.last.Spec
	if strings.Join(spec.Groups, ",") != "pay_start,pay_success,pay_failed" || spec.Filters["eventKind"] != "custom" || spec.TopN != 3 {
		t.Fatalf("pinned groups were not carried through: %+v", spec)
	}
}

func TestMetricsQueryReturnsTheCatalogReason(t *testing.T) {
	userID, projectID := uuid.New(), uuid.New()
	repository := &fakeMetricsRepository{}
	router := metricsTestRouter(NewMetricsHandler(fakeOverviewProjects{}, repository, nil, nil, zerolog.Nop()), userID)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, metricsRequest(projectID, time.Hour, url.Values{
		"metric": {"traffic.pageViews", "traffic.errorRate"}, "shape": {"series"},
	}))
	payload := decodeError(t, response)
	if response.Code != http.StatusBadRequest || payload.Error.Code != "VALIDATION_ERROR" ||
		payload.Error.Message != "metrics drawn together must share a unit" || repository.calls.Load() != 0 {
		t.Fatalf("status=%d payload=%+v calls=%d", response.Code, payload, repository.calls.Load())
	}
}

func TestMetricsQueryRejectsExpensiveQueryBeforeClickHouse(t *testing.T) {
	userID, projectID := uuid.New(), uuid.New()
	repository := &fakeMetricsRepository{}
	router := metricsTestRouter(NewMetricsHandler(fakeOverviewProjects{}, repository, nil, nil, zerolog.Nop()), userID)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, metricsRequest(projectID, 30*24*time.Hour, url.Values{
		"metric": {"traffic.pageViews", "traffic.sessions", "traffic.errors", "traffic.apiRequests"},
		"shape":  {"table"}, "dimension": {"route"}, "compare": {"previous"}, "sparkline": {"true"},
	}))
	if payload := decodeError(t, response); response.Code != http.StatusUnprocessableEntity ||
		payload.Error.Code != "QUERY_TOO_EXPENSIVE" || repository.calls.Load() != 0 {
		t.Fatalf("status=%d payload=%+v calls=%d", response.Code, payload, repository.calls.Load())
	}
}

func TestMetricsQueryDoesNotLeakBackendErrors(t *testing.T) {
	userID, projectID := uuid.New(), uuid.New()
	repository := &fakeMetricsRepository{err: errors.New("dial tcp private-clickhouse: connection refused")}
	router := metricsTestRouter(NewMetricsHandler(fakeOverviewProjects{}, repository, nil, nil, zerolog.Nop()), userID)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, metricsRequest(projectID, time.Hour, url.Values{"metric": {"traffic.pageViews"}, "shape": {"total"}}))
	if response.Code != http.StatusServiceUnavailable || contains(response.Body.String(), "private-clickhouse") {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestMetricsQueryMapsDeadlineToTooExpensive(t *testing.T) {
	userID, projectID := uuid.New(), uuid.New()
	repository := &fakeMetricsRepository{err: context.DeadlineExceeded}
	router := metricsTestRouter(NewMetricsHandler(fakeOverviewProjects{}, repository, nil, nil, zerolog.Nop()), userID)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, metricsRequest(projectID, time.Hour, url.Values{"metric": {"traffic.pageViews"}, "shape": {"total"}}))
	if payload := decodeError(t, response); response.Code != http.StatusUnprocessableEntity || payload.Error.Code != "QUERY_TOO_EXPENSIVE" {
		t.Fatalf("status=%d payload=%+v", response.Code, payload)
	}
}

// Two modules asking the same question at the same moment must cost one query.
func TestIdenticalConcurrentQueriesShareOneRun(t *testing.T) {
	userID, projectID := uuid.New(), uuid.New()
	repository := &fakeMetricsRepository{release: make(chan struct{}), result: query.MetricsResult{Shape: catalog.ShapeTotal}}
	router := metricsTestRouter(NewMetricsHandler(fakeOverviewProjects{}, repository, nil, nil, zerolog.Nop()), userID)
	var wait sync.WaitGroup
	codes := make([]int, 3)
	for index := range codes {
		wait.Add(1)
		go func() {
			defer wait.Done()
			response := httptest.NewRecorder()
			// Each request builds its own parameters: url.Values is not safe to share.
			parameters := url.Values{"metric": {"traffic.pageViews"}, "shape": {"total"}}
			router.ServeHTTP(response, metricsRequest(projectID, time.Hour, parameters))
			codes[index] = response.Code
		}()
	}
	// Let every request reach the shared call before the first one finishes.
	deadline := time.Now().Add(2 * time.Second)
	for repository.calls.Load() == 0 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	time.Sleep(50 * time.Millisecond)
	close(repository.release)
	wait.Wait()
	for _, code := range codes {
		if code != http.StatusOK {
			t.Fatalf("codes=%v", codes)
		}
	}
	if calls := repository.calls.Load(); calls != 1 {
		t.Fatalf("identical in-flight queries ran %d times", calls)
	}
}

func TestMetricsCatalogIsServedToProjectMembers(t *testing.T) {
	userID, projectID := uuid.New(), uuid.New()
	router := metricsTestRouter(NewMetricsHandler(fakeOverviewProjects{}, &fakeMetricsRepository{}, nil, nil, zerolog.Nop()), userID)
	request := httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+projectID.String()+"/metrics/catalog", nil)
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "valid"})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	var document catalog.Document
	if response.Code != http.StatusOK || json.Unmarshal(response.Body.Bytes(), &document) != nil || len(document.Metrics) == 0 {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	forbidden := metricsTestRouter(NewMetricsHandler(fakeOverviewProjects{err: metadata.ErrNotFound}, &fakeMetricsRepository{}, nil, nil, zerolog.Nop()), userID)
	response = httptest.NewRecorder()
	forbidden.ServeHTTP(response, request)
	if response.Code != http.StatusNotFound {
		t.Fatalf("the catalog is only served to project members: status=%d", response.Code)
	}
}
