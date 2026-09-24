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
	expiresAt := time.Now().UTC().Truncate(time.Second).Add(auth.SessionAbsoluteTTL)
	handler.setCookies(response, auth.SessionCredentials{
		Token: "session-token", CSRFToken: "csrf-token", ExpiresAt: expiresAt,
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
		if cookie.MaxAge != 30*24*60*60 || !cookie.Expires.Equal(expiresAt) {
			t.Fatalf("cookie expiry maxAge=%d expires=%s, want 30 days ending %s", cookie.MaxAge, cookie.Expires, expiresAt)
		}
	}
	if !cookies[0].HttpOnly || cookies[1].HttpOnly {
		t.Fatalf("HttpOnly flags: session=%v csrf=%v", cookies[0].HttpOnly, cookies[1].HttpOnly)
	}
}
