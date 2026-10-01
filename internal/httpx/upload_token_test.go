package httpx

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/google/uuid"

	"openrum/internal/auth"
	"openrum/internal/metadata"
)

type stubUploadTokens struct {
	access metadata.UploadTokenAccess
	err    error
	calls  int
}

func (stub *stubUploadTokens) Authenticate(_ context.Context, secret string) (metadata.UploadTokenAccess, error) {
	stub.calls++
	if stub.err != nil {
		return metadata.UploadTokenAccess{}, stub.err
	}
	if secret != "orut_good" {
		return metadata.UploadTokenAccess{}, metadata.ErrInvalidUploadToken
	}
	return stub.access, nil
}

func TestRequireSessionOrUploadTokenAcceptsBearerWithoutCSRF(t *testing.T) {
	baseURL, _ := url.Parse("https://openrum.example")
	tokens := &stubUploadTokens{access: metadata.UploadTokenAccess{TokenID: uuid.New(), ProjectID: uuid.New()}}
	guard := RequireSessionOrUploadToken(stubAuthenticator{err: auth.ErrUnauthenticated}, tokens, baseURL)
	handler := guard(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		access, ok := UploadTokenFromContext(request.Context())
		if _, session := PrincipalFromContext(request.Context()); !ok || session || access != tokens.access {
			t.Fatalf("access=%+v ok=%v session=%v", access, ok, session)
		}
		writer.WriteHeader(http.StatusNoContent)
	}))
	perform := func(authorization string) *httptest.ResponseRecorder {
		request := httptest.NewRequest(http.MethodPost, "/api/v1/projects/x/releases", nil)
		if authorization != "" {
			request.Header.Set("Authorization", authorization)
		}
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		return response
	}
	if response := perform("Bearer orut_good"); response.Code != http.StatusNoContent {
		t.Fatalf("valid token status=%d body=%s", response.Code, response.Body.String())
	}
	if response := perform("bearer orut_revoked"); response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), "INVALID_UPLOAD_TOKEN") {
		t.Fatalf("invalid token status=%d body=%s", response.Code, response.Body.String())
	}
	// Without a bearer token the request falls through to the session guard.
	if response := perform("Basic abc"); response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), "UNAUTHENTICATED") {
		t.Fatalf("basic auth status=%d body=%s", response.Code, response.Body.String())
	}
	tokens.err = errors.New("database down")
	if response := perform("Bearer orut_good"); response.Code != http.StatusInternalServerError {
		t.Fatalf("lookup failure status=%d", response.Code)
	}
}

func TestRequireSessionOrUploadTokenKeepsCSRFForSessions(t *testing.T) {
	baseURL, _ := url.Parse("https://openrum.example")
	guard := RequireSessionOrUploadToken(stubAuthenticator{principal: auth.Principal{UserID: uuid.New()}}, &stubUploadTokens{}, baseURL)
	handler := guard(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) { writer.WriteHeader(http.StatusNoContent) }))
	request := httptest.NewRequest(http.MethodPost, "/api/v1/projects/x/releases", nil)
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "session"})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	request = httptest.NewRequest(http.MethodPost, "/api/v1/projects/x/releases", nil)
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "session"})
	request.AddCookie(&http.Cookie{Name: auth.CSRFCookieName, Value: "csrf"})
	request.Header.Set(CSRFHeader, "csrf")
	request.Header.Set("Origin", "https://openrum.example")
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusNoContent {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}
