package httpx

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/google/uuid"

	"openrum/internal/auth"
)

type stubAuthenticator struct {
	principal auth.Principal
	err       error
}

func (stub stubAuthenticator) Authenticate(context.Context, string) (auth.Principal, error) {
	return stub.principal, stub.err
}

func TestRequireSessionLoadsPrincipal(t *testing.T) {
	want := auth.Principal{UserID: uuid.New(), SessionID: uuid.New()}
	handler := RequireSession(stubAuthenticator{principal: want})(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		principal, ok := PrincipalFromContext(request.Context())
		if !ok || principal != want {
			t.Fatalf("principal=%+v ok=%v", principal, ok)
		}
		writer.WriteHeader(http.StatusNoContent)
	}))
	request := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/auth/me", nil)
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "token"})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusNoContent {
		t.Fatalf("status=%d", response.Code)
	}
}

func TestRequireSessionRejectsInvalidSession(t *testing.T) {
	handler := RequireSession(stubAuthenticator{err: auth.ErrUnauthenticated})(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Fatal("protected handler was called")
	}))
	request := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/private", nil)
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "invalid"})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d", response.Code)
	}

	handler = RequireSession(stubAuthenticator{err: errors.New("database unavailable")})(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusInternalServerError {
		t.Fatalf("internal status=%d", response.Code)
	}
}

func TestRequireSessionLimitsPendingAccountsToStatusAndLogout(t *testing.T) {
	handler := RequireSession(stubAuthenticator{principal: auth.Principal{UserID: uuid.New(), AccessStatus: "pending"}})(
		http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) { writer.WriteHeader(http.StatusNoContent) }),
	)
	for _, scenario := range []struct {
		path string
		want int
	}{
		{"/api/v1/auth/me", http.StatusNoContent},
		{"/api/v1/auth/logout", http.StatusNoContent},
		{"/api/v1/auth/password/set", http.StatusForbidden},
		{"/api/v1/organizations", http.StatusForbidden},
		{"/api/v1/admin/authentication", http.StatusForbidden},
	} {
		request := httptest.NewRequest(http.MethodGet, scenario.path, nil)
		request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "token"})
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != scenario.want {
			t.Fatalf("path=%s status=%d want=%d", scenario.path, response.Code, scenario.want)
		}
	}
}

func TestRequireCSRFValidatesOriginCookieAndHeader(t *testing.T) {
	baseURL, err := url.Parse("https://rum.example.com")
	if err != nil {
		t.Fatal(err)
	}
	called := false
	handler := RequireCSRF(baseURL)(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		called = true
		writer.WriteHeader(http.StatusNoContent)
	}))

	request := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/mutation", nil)
	request.Header.Set("Origin", "https://evil.example.com")
	request.Header.Set(CSRFHeader, "csrf-token")
	request.AddCookie(&http.Cookie{Name: auth.CSRFCookieName, Value: "csrf-token"})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusForbidden || called {
		t.Fatalf("cross-origin status=%d called=%v", response.Code, called)
	}

	request = httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/mutation", nil)
	request.Header.Set("Origin", "https://rum.example.com")
	request.Header.Set(CSRFHeader, "wrong-token")
	request.AddCookie(&http.Cookie{Name: auth.CSRFCookieName, Value: "csrf-token"})
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusForbidden || called {
		t.Fatalf("mismatch status=%d called=%v", response.Code, called)
	}

	request.Header.Set(CSRFHeader, "csrf-token")
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusNoContent || !called {
		t.Fatalf("valid status=%d called=%v", response.Code, called)
	}
}
