package handlers

import (
	"context"
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
	"openrum/internal/metadata"
)

type fakeInstanceMembers struct {
	roles       map[uuid.UUID]metadata.InstanceRole
	users       map[string]metadata.User
	members     map[uuid.UUID]metadata.InstanceMemberView
	mutation    string
	mutationErr error
}

type adminAuthenticator struct {
	principals map[string]auth.Principal
}

func (authenticator adminAuthenticator) Authenticate(_ context.Context, token string) (auth.Principal, error) {
	principal, ok := authenticator.principals[token]
	if !ok {
		return auth.Principal{}, auth.ErrUnauthenticated
	}
	return principal, nil
}

func (fake *fakeInstanceMembers) RoleForUser(_ context.Context, userID uuid.UUID) (metadata.InstanceRole, error) {
	role, ok := fake.roles[userID]
	if !ok {
		return "", metadata.ErrForbidden
	}
	return role, nil
}

func (fake *fakeInstanceMembers) List(context.Context) ([]metadata.InstanceMemberView, error) {
	result := make([]metadata.InstanceMemberView, 0, len(fake.members))
	for _, member := range fake.members {
		result = append(result, member)
	}
	return result, nil
}

func (fake *fakeInstanceMembers) Get(_ context.Context, userID uuid.UUID) (metadata.InstanceMemberView, error) {
	member, ok := fake.members[userID]
	if !ok {
		return metadata.InstanceMemberView{}, metadata.ErrNotFound
	}
	return member, nil
}

func (fake *fakeInstanceMembers) FindActiveUserByEmail(_ context.Context, email string) (metadata.User, error) {
	user, ok := fake.users[email]
	if !ok {
		return metadata.User{}, metadata.ErrNotFound
	}
	return user, nil
}

func (fake *fakeInstanceMembers) Add(_ context.Context, actorID, userID uuid.UUID, role metadata.InstanceRole) error {
	fake.mutation = "add:" + actorID.String() + ":" + userID.String() + ":" + string(role)
	if fake.mutationErr != nil {
		return fake.mutationErr
	}
	user := fake.users["new-admin@example.com"]
	fake.members[userID] = instanceMemberFixture(user, role)
	return nil
}

func (fake *fakeInstanceMembers) UpdateRole(_ context.Context, actorID, userID uuid.UUID, role metadata.InstanceRole) error {
	fake.mutation = "update:" + actorID.String() + ":" + userID.String() + ":" + string(role)
	return fake.mutationErr
}

func (fake *fakeInstanceMembers) Remove(_ context.Context, actorID, userID uuid.UUID) error {
	fake.mutation = "remove:" + actorID.String() + ":" + userID.String()
	return fake.mutationErr
}

func TestAdminMemberAccessIsIndependentFromOrganizationRoles(t *testing.T) {
	ownerID, adminID, organizationOwnerID := uuid.New(), uuid.New(), uuid.New()
	fake := newFakeInstanceMembers(ownerID, adminID)
	router := adminMemberTestRouter(fake, map[string]auth.Principal{
		"instance-owner": {UserID: ownerID}, "instance-admin": {UserID: adminID},
		"organization-owner": {UserID: organizationOwnerID},
	})

	for token, expected := range map[string]int{
		"instance-owner": http.StatusOK, "instance-admin": http.StatusOK,
		"organization-owner": http.StatusForbidden,
	} {
		response := performAdminRequest(router, token, http.MethodGet, "/api/v1/admin/members", "", false)
		if response.Code != expected {
			t.Errorf("GET token=%s status=%d want=%d body=%s", token, response.Code, expected, response.Body.String())
		}
	}

	response := performAdminRequest(router, "instance-admin", http.MethodPost, "/api/v1/admin/members",
		`{"email":"new-admin@example.com","role":"instance_admin"}`, true)
	if response.Code != http.StatusForbidden || fake.mutation != "" {
		t.Fatalf("admin mutation status=%d mutation=%q body=%s", response.Code, fake.mutation, response.Body.String())
	}
	response = performAdminRequest(router, "instance-owner", http.MethodPost, "/api/v1/admin/members",
		`{"email":"new-admin@example.com","role":"instance_admin"}`, true)
	if response.Code != http.StatusCreated || fake.mutation == "" {
		t.Fatalf("owner mutation status=%d mutation=%q body=%s", response.Code, fake.mutation, response.Body.String())
	}
}

func TestAdminMemberLastOwnerConflictIsExplicit(t *testing.T) {
	ownerID := uuid.New()
	fake := newFakeInstanceMembers(ownerID, uuid.New())
	fake.mutationErr = metadata.ErrLastInstanceOwner
	router := adminMemberTestRouter(fake, map[string]auth.Principal{"instance-owner": {UserID: ownerID}})
	response := performAdminRequest(router, "instance-owner", http.MethodDelete,
		"/api/v1/admin/members/"+ownerID.String(), "", true)
	if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), "LAST_INSTANCE_OWNER_REQUIRED") {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestAdminMemberMutationRejectsExpiredElevation(t *testing.T) {
	ownerID := uuid.New()
	fake := newFakeInstanceMembers(ownerID, uuid.New())
	router := adminMemberTestRouterWithElevation(fake, map[string]auth.Principal{
		"instance-owner": {UserID: ownerID},
	}, retentionReauthFixture{err: auth.ErrReauthenticationRequired})
	response := performAdminRequest(router, "instance-owner", http.MethodPost, "/api/v1/admin/members",
		`{"email":"new-admin@example.com","role":"instance_admin"}`, true)
	if response.Code != http.StatusUnauthorized || fake.mutation != "" || !strings.Contains(response.Body.String(), "REAUTHENTICATION_REQUIRED") {
		t.Fatalf("status=%d mutation=%q body=%s", response.Code, fake.mutation, response.Body.String())
	}
}

func newFakeInstanceMembers(ownerID, adminID uuid.UUID) *fakeInstanceMembers {
	now := time.Now().UTC()
	newAdminID := uuid.New()
	passwordHash := "existing-local-password-hash"
	newAdmin := metadata.User{ID: newAdminID, Email: "new-admin@example.com", DisplayName: "New Admin", PasswordHash: &passwordHash}
	return &fakeInstanceMembers{
		roles: map[uuid.UUID]metadata.InstanceRole{ownerID: metadata.InstanceRoleOwner, adminID: metadata.InstanceRoleAdmin},
		users: map[string]metadata.User{newAdmin.Email: newAdmin},
		members: map[uuid.UUID]metadata.InstanceMemberView{
			ownerID: {UserID: ownerID, Email: "owner@example.com", DisplayName: "Owner", Role: metadata.InstanceRoleOwner, CreatedAt: now, UpdatedAt: now},
			adminID: {UserID: adminID, Email: "admin@example.com", DisplayName: "Admin", Role: metadata.InstanceRoleAdmin, CreatedAt: now, UpdatedAt: now},
		},
	}
}

func instanceMemberFixture(user metadata.User, role metadata.InstanceRole) metadata.InstanceMemberView {
	now := time.Now().UTC()
	return metadata.InstanceMemberView{UserID: user.ID, Email: user.Email, DisplayName: user.DisplayName, Role: role, CreatedAt: now, UpdatedAt: now}
}

func adminMemberTestRouter(members instanceMembers, principals map[string]auth.Principal) http.Handler {
	return adminMemberTestRouterWithElevation(members, principals, retentionReauthFixture{})
}

func adminMemberTestRouterWithElevation(
	members instanceMembers,
	principals map[string]auth.Principal,
	reauth recentElevationChecker,
) http.Handler {
	router := httpx.NewRouter(zerolog.Nop())
	handler := NewAdminMemberHandler(members, reauth, zerolog.Nop())
	requireSession := httpx.RequireSession(adminAuthenticator{principals: principals})
	baseURL, _ := url.Parse("http://openrum.test")
	requireCSRF := httpx.RequireCSRF(baseURL)
	router.Handle("GET /api/v1/admin/members", requireSession(http.HandlerFunc(handler.List)))
	router.Handle("POST /api/v1/admin/members", requireSession(requireCSRF(http.HandlerFunc(handler.Add))))
	router.Handle("DELETE /api/v1/admin/members/{userId}", requireSession(requireCSRF(http.HandlerFunc(handler.Remove))))
	return router
}

func performAdminRequest(handler http.Handler, token, method, path, body string, csrf bool) *httptest.ResponseRecorder {
	request := httptest.NewRequestWithContext(context.Background(), method, path, strings.NewReader(body))
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: token})
	request.AddCookie(&http.Cookie{Name: auth.CSRFCookieName, Value: "test-csrf-token"})
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	if csrf {
		request.Header.Set("Origin", "http://openrum.test")
		request.Header.Set(httpx.CSRFHeader, "test-csrf-token")
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}
