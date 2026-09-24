package handlers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"openrum/internal/auth"
	"openrum/internal/httpx"
	"openrum/internal/metadata"
	"openrum/internal/query"
)

type fakeIssueQueries struct {
	page     query.IssuePage
	trend    []query.IssueTrendPoint
	overview query.IssueOverview
	calls    int
	last     query.IssueFilters
}

func (queries *fakeIssueQueries) List(_ context.Context, filters query.IssueFilters) (query.IssuePage, error) {
	queries.calls++
	queries.last = filters
	return queries.page, nil
}
func (queries *fakeIssueQueries) Trend(context.Context, query.IssueFilters, string) ([]query.IssueTrendPoint, error) {
	return queries.trend, nil
}
func (queries *fakeIssueQueries) Overview(context.Context, query.IssueFilters) (query.IssueOverview, error) {
	return queries.overview, nil
}

type fakeIssueEvents struct{ page query.EventPage }

func (events fakeIssueEvents) ListIssueEvents(context.Context, uuid.UUID, string, time.Time, time.Time, int, string) (query.EventPage, error) {
	return events.page, nil
}

type fakeIssueStates struct{ state metadata.IssueState }

func (states fakeIssueStates) MutateIssueState(context.Context, uuid.UUID, metadata.IssueState) (metadata.IssueState, error) {
	return states.state, nil
}

func TestIssueHandlerListsPermissionSafeAggregates(t *testing.T) {
	userID, projectID := uuid.New(), uuid.New()
	queries := &fakeIssueQueries{page: query.IssuePage{Issues: []query.IssueSummary{{Fingerprint: "v1:abc", Status: metadata.IssueStatusUnresolved}}}}
	handler := NewIssueHandler(fakeOverviewProjects{access: metadata.ProjectAccess{Role: metadata.RoleViewer}}, queries, fakeIssueEvents{}, fakeIssueStates{}, zerolog.Nop())
	router := issueTestRouter(handler, userID)
	request := httptest.NewRequest(http.MethodGet, issueURL(projectID, "/issues"), nil)
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "valid"})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK || queries.calls != 1 || !strings.Contains(response.Body.String(), "v1:abc") {
		t.Fatalf("status=%d calls=%d body=%s", response.Code, queries.calls, response.Body.String())
	}
}

func TestIssueHandlerParsesIssueSpecificFilters(t *testing.T) {
	userID, projectID := uuid.New(), uuid.New()
	queries := &fakeIssueQueries{page: query.IssuePage{Issues: []query.IssueSummary{}}}
	handler := NewIssueHandler(fakeOverviewProjects{access: metadata.ProjectAccess{Role: metadata.RoleViewer}}, queries, fakeIssueEvents{}, fakeIssueStates{}, zerolog.Nop())
	router := issueTestRouter(handler, userID)
	request := httptest.NewRequest(http.MethodGet, issueURL(projectID, "/issues")+"&title=checkout&errorType=TypeError&fingerprint=v1%3Acheckout&userId=customer-1", nil)
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "valid"})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK || queries.last.Title != "checkout" || queries.last.ErrorType != "TypeError" || queries.last.Fingerprint != "v1:checkout" || queries.last.UserID != "customer-1" {
		t.Fatalf("status=%d filters=%+v body=%s", response.Code, queries.last, response.Body.String())
	}
}

func TestIssueHandlerReturnsOverviewAggregates(t *testing.T) {
	userID, projectID := uuid.New(), uuid.New()
	queries := &fakeIssueQueries{overview: query.IssueOverview{Trend: []query.IssueOverviewPoint{{Events: 12, AnonymousUsers: 8, IdentifiedUsers: 5}}}}
	handler := NewIssueHandler(fakeOverviewProjects{access: metadata.ProjectAccess{Role: metadata.RoleViewer}}, queries, fakeIssueEvents{}, fakeIssueStates{}, zerolog.Nop())
	router := issueTestRouter(handler, userID)
	request := httptest.NewRequest(http.MethodGet, issueURL(projectID, "/issues/overview"), nil)
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "valid"})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"anonymousUsers":8`) || !strings.Contains(response.Body.String(), `"identifiedUsers":5`) {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestIssueMutationRejectsViewerBeforeQuery(t *testing.T) {
	userID, projectID := uuid.New(), uuid.New()
	queries := &fakeIssueQueries{}
	handler := NewIssueHandler(fakeOverviewProjects{access: metadata.ProjectAccess{Role: metadata.RoleViewer}}, queries, fakeIssueEvents{}, fakeIssueStates{}, zerolog.Nop())
	router := issueTestRouter(handler, userID)
	request := httptest.NewRequest(http.MethodPatch, issueURL(projectID, "/issues/v1:abc"), strings.NewReader(`{"status":"resolved"}`))
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "valid"})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusForbidden || queries.calls != 0 {
		t.Fatalf("status=%d calls=%d body=%s", response.Code, queries.calls, response.Body.String())
	}
}

type fakeEventQueries struct {
	event query.EventDetail
	err   error
}

func (events fakeEventQueries) Get(context.Context, uuid.UUID) (query.EventDetail, error) {
	return events.event, events.err
}

func TestEventHandlerHidesCrossProjectLookup(t *testing.T) {
	userID, eventID := uuid.New(), uuid.New()
	handler := NewEventHandler(fakeOverviewProjects{err: metadata.ErrNotFound}, fakeEventQueries{event: query.EventDetail{ProjectID: uuid.New(), EventID: eventID}}, zerolog.Nop())
	router := httpx.NewRouter(zerolog.Nop())
	authenticated := httpx.RequireSession(connectionFixtureAuthenticator{principal: auth.Principal{UserID: userID}})
	router.Handle("GET /api/v1/events/{eventId}", authenticated(http.HandlerFunc(handler.Get)))
	request := httptest.NewRequest(http.MethodGet, "/api/v1/events/"+eventID.String(), nil)
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "valid"})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusNotFound {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}

func issueTestRouter(handler *IssueHandler, userID uuid.UUID) http.Handler {
	router := httpx.NewRouter(zerolog.Nop())
	authenticated := httpx.RequireSession(connectionFixtureAuthenticator{principal: auth.Principal{UserID: userID}})
	router.Handle("GET /api/v1/projects/{projectId}/issues", authenticated(http.HandlerFunc(handler.List)))
	router.Handle("GET /api/v1/projects/{projectId}/issues/overview", authenticated(http.HandlerFunc(handler.Overview)))
	router.Handle("PATCH /api/v1/projects/{projectId}/issues/{fingerprint}", authenticated(http.HandlerFunc(handler.Patch)))
	return router
}

func issueURL(projectID uuid.UUID, suffix string) string {
	to := time.Date(2026, 9, 3, 1, 0, 0, 0, time.UTC)
	return "/api/v1/projects/" + projectID.String() + suffix + "?from=" + to.Add(-time.Hour).Format(time.RFC3339) + "&to=" + to.Format(time.RFC3339)
}
