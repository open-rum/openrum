package handlers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"openrum/internal/auth"
	"openrum/internal/httpx"
	"openrum/internal/metadata"
	"openrum/internal/sourcemap"
)

type fakeSourceMapMatcher struct{ calls int }

func (matcher *fakeSourceMapMatcher) MapStack(context.Context, uuid.UUID, string, string, string) (sourcemap.MappedStack, error) {
	matcher.calls++
	return sourcemap.MappedStack{Status: "mapped", Frames: []sourcemap.StackFrame{}}, nil
}

func TestSourceMapMatchTesterAuthorizesAndBoundsInput(t *testing.T) {
	userID, projectID := uuid.New(), uuid.New()
	matcher := &fakeSourceMapMatcher{}
	handler := NewSourceMapMatchHandler(fakeOverviewProjects{access: metadata.ProjectAccess{Role: metadata.RoleViewer}}, matcher, zerolog.Nop())
	router := httpx.NewRouter(zerolog.Nop())
	authenticated := httpx.RequireSession(connectionFixtureAuthenticator{principal: auth.Principal{UserID: userID}})
	router.Handle("POST /api/v1/projects/{projectId}/sourcemaps/test", authenticated(http.HandlerFunc(handler.Test)))
	request := httptest.NewRequest(http.MethodPost, "/api/v1/projects/"+projectID.String()+"/sourcemaps/test", strings.NewReader(`{"release":"web@1","stack":"at run (https://cdn.example/app.js:1:0)"}`))
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "valid"})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK || matcher.calls != 1 || !strings.Contains(response.Body.String(), "mapped") {
		t.Fatalf("status=%d calls=%d body=%s", response.Code, matcher.calls, response.Body.String())
	}

	tooLarge := `{"release":"web@1","stack":"` + strings.Repeat("x", sourcemap.MaxStackBytes+1) + `"}`
	request = httptest.NewRequest(http.MethodPost, "/api/v1/projects/"+projectID.String()+"/sourcemaps/test", strings.NewReader(tooLarge))
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "valid"})
	response = httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest || matcher.calls != 1 {
		t.Fatalf("status=%d calls=%d", response.Code, matcher.calls)
	}
}

type unavailableMatcher struct{}

func (unavailableMatcher) MapStack(context.Context, uuid.UUID, string, string, string) (sourcemap.MappedStack, error) {
	return sourcemap.MappedStack{}, sourcemap.ErrRetryable
}

func TestSourceMapMatchTesterReportsStorageInsteadOfFrameFailures(t *testing.T) {
	userID, projectID := uuid.New(), uuid.New()
	switcher := sourcemap.NewSwitchableStorage(nil, nil)
	handler := NewSourceMapMatchHandler(fakeOverviewProjects{access: metadata.ProjectAccess{Role: metadata.RoleViewer}}, unavailableMatcher{}, zerolog.Nop())
	handler.UseStorageState(switcher)
	router := httpx.NewRouter(zerolog.Nop())
	authenticated := httpx.RequireSession(connectionFixtureAuthenticator{principal: auth.Principal{UserID: userID}})
	router.Handle("POST /api/v1/projects/{projectId}/sourcemaps/test", authenticated(http.HandlerFunc(handler.Test)))
	perform := func() *httptest.ResponseRecorder {
		request := httptest.NewRequest(http.MethodPost, "/api/v1/projects/"+projectID.String()+"/sourcemaps/test", strings.NewReader(`{"release":"web@1","stack":"at run (https://cdn.example/app.js:1:0)"}`))
		request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "valid"})
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		return response
	}
	if response := perform(); response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "OBJECT_STORAGE_NOT_CONFIGURED") {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	switcher.SetUnavailable()
	if response := perform(); response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "OBJECT_STORAGE_UNAVAILABLE") {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}
