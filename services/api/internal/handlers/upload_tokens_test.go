package handlers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"openrum/internal/auth"
	"openrum/internal/httpx"
	"openrum/internal/metadata"
)

type fakeUploadTokenStore struct {
	created []string
	revoked []uuid.UUID
}

func (store *fakeUploadTokenStore) List(context.Context, uuid.UUID) ([]metadata.UploadToken, error) {
	name := "Owner"
	return []metadata.UploadToken{{ID: uuid.New(), Name: "CI", TokenPrefix: "orut_abcdefg", CreatedByName: &name}}, nil
}
func (store *fakeUploadTokenStore) Create(_ context.Context, _, _ uuid.UUID, name string) (metadata.UploadTokenCredential, error) {
	store.created = append(store.created, name)
	return metadata.UploadTokenCredential{Token: metadata.UploadToken{ID: uuid.New(), Name: name, TokenPrefix: "orut_abcdefg"}, Secret: "orut_secret"}, nil
}
func (store *fakeUploadTokenStore) Revoke(_ context.Context, _, _, tokenID uuid.UUID) error {
	store.revoked = append(store.revoked, tokenID)
	return nil
}

func uploadTokenRouter(role metadata.OrganizationRole, store *fakeUploadTokenStore) http.Handler {
	handler := NewUploadTokenHandler(fakeOverviewProjects{access: metadata.ProjectAccess{Role: role}}, store, zerolog.Nop())
	session := httpx.RequireSession(connectionFixtureAuthenticator{principal: auth.Principal{UserID: uuid.New()}})
	baseURL, _ := url.Parse("http://openrum.test")
	csrf := httpx.RequireCSRF(baseURL)
	router := httpx.NewRouter(zerolog.Nop())
	router.Handle("GET /api/v1/projects/{projectId}/upload-tokens", session(http.HandlerFunc(handler.List)))
	router.Handle("POST /api/v1/projects/{projectId}/upload-tokens", session(csrf(http.HandlerFunc(handler.Create))))
	router.Handle("DELETE /api/v1/projects/{projectId}/upload-tokens/{tokenId}", session(csrf(http.HandlerFunc(handler.Revoke))))
	return router
}

func performUploadTokenRequest(router http.Handler, method, target, body string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, target, strings.NewReader(body))
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "valid"})
	request.AddCookie(&http.Cookie{Name: auth.CSRFCookieName, Value: "csrf"})
	request.Header.Set(httpx.CSRFHeader, "csrf")
	request.Header.Set("Origin", "http://openrum.test")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	return response
}

func TestUploadTokensListForMembersManageForAdmins(t *testing.T) {
	store := &fakeUploadTokenStore{}
	target := "/api/v1/projects/" + uuid.NewString() + "/upload-tokens"
	member := uploadTokenRouter(metadata.RoleMember, store)
	response := performUploadTokenRequest(member, http.MethodGet, target, "")
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"canManage":false`) || !strings.Contains(response.Body.String(), `"createdByName":"Owner"`) {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	if response := performUploadTokenRequest(member, http.MethodPost, target, `{"name":"CI"}`); response.Code != http.StatusForbidden || len(store.created) != 0 {
		t.Fatalf("member create status=%d", response.Code)
	}
	if response := performUploadTokenRequest(member, http.MethodDelete, target+"/"+uuid.NewString(), ""); response.Code != http.StatusForbidden || len(store.revoked) != 0 {
		t.Fatalf("member revoke status=%d", response.Code)
	}

	admin := uploadTokenRouter(metadata.RoleAdmin, store)
	response = performUploadTokenRequest(admin, http.MethodGet, target, "")
	if !strings.Contains(response.Body.String(), `"canManage":true`) {
		t.Fatalf("admin list body=%s", response.Body.String())
	}
	response = performUploadTokenRequest(admin, http.MethodPost, target, `{"name":"  CI deploy  "}`)
	if response.Code != http.StatusCreated || !strings.Contains(response.Body.String(), `"secret":"orut_secret"`) || store.created[0] != "CI deploy" {
		t.Fatalf("admin create status=%d created=%v body=%s", response.Code, store.created, response.Body.String())
	}
	if response := performUploadTokenRequest(admin, http.MethodPost, target, `{"name":"`+strings.Repeat("x", 121)+`"}`); response.Code != http.StatusBadRequest {
		t.Fatalf("long name status=%d", response.Code)
	}
	if response := performUploadTokenRequest(admin, http.MethodDelete, target+"/"+uuid.NewString(), ""); response.Code != http.StatusNoContent || len(store.revoked) != 1 {
		t.Fatalf("admin revoke status=%d", response.Code)
	}
}
