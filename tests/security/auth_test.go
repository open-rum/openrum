package security_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"openrum/internal/auth"
	"openrum/internal/httpx"
	"openrum/internal/metadata"
)

func TestStateChangingRequestRequiresSameOriginCSRFToken(t *testing.T) {
	baseURL, _ := url.Parse("https://rum.example.com")
	called := false
	handler := httpx.RequireCSRF(baseURL)(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { called = true }))

	request := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "https://rum.example.com/api/v1/projects", nil)
	request.Header.Set("Origin", "https://evil.example")
	request.Header.Set(httpx.CSRFHeader, "token")
	request.AddCookie(&http.Cookie{Name: auth.CSRFCookieName, Value: "token"})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusForbidden || called {
		t.Fatalf("cross-origin response=%d called=%v", response.Code, called)
	}
}

func TestRoleMatrixDefaultsToDeny(t *testing.T) {
	for _, test := range []struct {
		role   metadata.OrganizationRole
		action auth.Action
		allow  bool
	}{
		{metadata.RoleViewer, auth.ActionReadProject, true},
		{metadata.RoleViewer, auth.ActionManageKeys, false},
		{metadata.RoleMember, auth.ActionManageMembers, false},
		{metadata.RoleAdmin, auth.ActionManageKeys, true},
		{metadata.RoleAdmin, auth.ActionDeleteOrg, false},
		{metadata.RoleOwner, auth.ActionDeleteOrg, true},
		{metadata.RoleOwner, auth.Action("unknown"), false},
	} {
		if got := auth.Can(test.role, test.action); got != test.allow {
			t.Errorf("Can(%q,%q)=%v want %v", test.role, test.action, got, test.allow)
		}
	}
}
