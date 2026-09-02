package handlers

import (
	"net/http/httptest"
	"testing"
	"time"

	"github.com/rs/zerolog"

	"openrum/internal/auth"
)

func TestAuthenticationCookiesAreSecureInProduction(t *testing.T) {
	handler := NewAuthHandler(nil, nil, zerolog.Nop(), true)
	response := httptest.NewRecorder()
	handler.setCookies(response, auth.SessionCredentials{
		Token: "session-token", CSRFToken: "csrf-token", ExpiresAt: time.Now().Add(auth.SessionAbsoluteTTL),
	})
	result := response.Result()
	defer func() { _ = result.Body.Close() }()
	cookies := result.Cookies()
	if len(cookies) != 2 {
		t.Fatalf("cookie count=%d", len(cookies))
	}
	for _, cookie := range cookies {
		if !cookie.Secure || cookie.Path != "/" || cookie.SameSite == 0 {
			t.Fatalf("cookie is missing security attributes: %+v", cookie)
		}
	}
	if !cookies[0].HttpOnly || cookies[1].HttpOnly {
		t.Fatalf("HttpOnly flags: session=%v csrf=%v", cookies[0].HttpOnly, cookies[1].HttpOnly)
	}
}
