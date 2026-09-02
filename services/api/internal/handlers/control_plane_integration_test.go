//go:build integration

package handlers

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/rs/zerolog"

	"openrum/internal/auth"
	"openrum/internal/httpx"
	"openrum/internal/metadata"
	"openrum/internal/migrate"
	"openrum/migrations"
)

func TestBootstrapCreatesAuthenticatedSession(t *testing.T) {
	database := openControlPlaneTestDatabase(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := migrate.PostgresUp(ctx, database, migrations.Files); err != nil {
		t.Fatal(err)
	}
	if _, err := database.ExecContext(ctx, "TRUNCATE audit_logs, sessions, project_keys, projects, organization_members, organizations, users CASCADE"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = database.ExecContext(context.Background(), "TRUNCATE audit_logs, sessions, project_keys, projects, organization_members, organizations, users CASCADE")
	})

	logger := zerolog.Nop()
	bootstrapper := auth.NewBootstrapper(database, "bootstrap-secret")
	sessions := auth.NewSessionManager(database)
	setupHandler := NewSetupHandler(bootstrapper, logger, false)
	authHandler := NewAuthHandler(nil, sessions, logger, false)
	router := httpx.NewRouter(logger)
	router.HandleFunc("POST /api/v1/setup/bootstrap", setupHandler.Bootstrap)
	router.Handle("GET /api/v1/auth/me", httpx.RequireSession(sessions)(http.HandlerFunc(authHandler.Me)))

	request := httptest.NewRequest(http.MethodPost, "/api/v1/setup/bootstrap", strings.NewReader(
		`{"email":"bootstrap@example.com","displayName":"Bootstrap Owner","password":"a-production-password","organizationName":"Bootstrap Team"}`,
	))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-OpenRUM-Bootstrap-Token", "bootstrap-secret")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	assertStatus(t, response, http.StatusCreated)
	result := response.Result()
	defer func() { _ = result.Body.Close() }()
	cookies := result.Cookies()
	if len(cookies) != 2 || cookies[0].Value == "" || cookies[1].Value == "" {
		t.Fatalf("bootstrap cookies=%+v", cookies)
	}

	meRequest := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
	for _, cookie := range cookies {
		meRequest.AddCookie(cookie)
	}
	meResponse := httptest.NewRecorder()
	router.ServeHTTP(meResponse, meRequest)
	assertStatus(t, meResponse, http.StatusOK)
	var sessionsCount int
	if err := database.QueryRowContext(ctx, "SELECT count(*) FROM sessions WHERE revoked_at IS NULL").Scan(&sessionsCount); err != nil {
		t.Fatal(err)
	}
	if sessionsCount != 1 {
		t.Fatalf("active bootstrap sessions=%d", sessionsCount)
	}
}

func TestControlPlaneCRUDAndRBAC(t *testing.T) {
	database := openControlPlaneTestDatabase(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := migrate.PostgresUp(ctx, database, migrations.Files); err != nil {
		t.Fatal(err)
	}
	if _, err := database.ExecContext(ctx, "TRUNCATE audit_logs, sessions, project_keys, projects, organization_members, organizations, users CASCADE"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = database.ExecContext(context.Background(), "TRUNCATE audit_logs, sessions, project_keys, projects, organization_members, organizations, users CASCADE")
	})

	ownerA, ownerB, admin, member, viewer := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	for _, user := range []struct {
		id    uuid.UUID
		email string
	}{{ownerA, "owner-a@example.com"}, {ownerB, "owner-b@example.com"}, {admin, "admin@example.com"},
		{member, "member@example.com"}, {viewer, "viewer@example.com"}} {
		if _, err := database.ExecContext(ctx,
			"INSERT INTO users (id,email,display_name,password_hash) VALUES ($1,$2,$3,'hash')",
			user.id, user.email, user.email); err != nil {
			t.Fatal(err)
		}
	}

	organizations := metadata.NewOrganizationRepository(database)
	projects := metadata.NewProjectRepository(database)
	keys := metadata.NewProjectKeyRepository(database)
	organizationB, err := organizations.Create(ctx, ownerB, "Organization B", "organization-b")
	if err != nil {
		t.Fatal(err)
	}
	principals := map[string]auth.Principal{
		"owner-a": {UserID: ownerA, Email: "owner-a@example.com", DisplayName: "Owner A"},
		"owner-b": {UserID: ownerB, Email: "owner-b@example.com", DisplayName: "Owner B"},
		"admin":   {UserID: admin, Email: "admin@example.com", DisplayName: "Admin"},
		"member":  {UserID: member, Email: "member@example.com", DisplayName: "Member"},
		"viewer":  {UserID: viewer, Email: "viewer@example.com", DisplayName: "Viewer"},
	}
	router := controlPlaneTestRouter(organizations, projects, keys, principals)

	response := performControlPlaneRequest(t, router, "owner-a", http.MethodPost, "/api/v1/organizations",
		`{"name":"Organization A","slug":"organization-a"}`, true)
	assertStatus(t, response, http.StatusCreated)
	var organizationA organizationResponse
	decodeResponse(t, response, &organizationA)
	response = performControlPlaneRequest(t, router, "owner-a", http.MethodGet, "/api/v1/organizations", "", false)
	assertStatus(t, response, http.StatusOK)

	response = performControlPlaneRequest(t, router, "owner-a", http.MethodPost, "/api/v1/organizations",
		`{"name":"Duplicate","slug":"organization-a"}`, true)
	assertStatus(t, response, http.StatusConflict)

	memberPath := "/api/v1/organizations/" + organizationA.ID + "/members"
	response = performControlPlaneRequest(t, router, "owner-a", http.MethodPost, memberPath,
		`{"email":"viewer@example.com","role":"viewer"}`, true)
	assertStatus(t, response, http.StatusCreated)

	projectPath := "/api/v1/organizations/" + organizationA.ID + "/projects"
	response = performControlPlaneRequest(t, router, "viewer", http.MethodPost, projectPath,
		`{"name":"Denied","slug":"denied"}`, true)
	assertStatus(t, response, http.StatusForbidden)
	response = performControlPlaneRequest(t, router, "owner-a", http.MethodPost, projectPath,
		`{"name":"Invalid","slug":"invalid","allowedOrigins":["https://example.com/path"]}`, true)
	assertStatus(t, response, http.StatusBadRequest)
	response = performControlPlaneRequest(t, router, "owner-a", http.MethodPost, projectPath,
		`{"name":"Web App","slug":"web-app","allowedOrigins":["https://EXAMPLE.com","http://localhost:3000"],"eventSampleRate":0.5}`, true)
	assertStatus(t, response, http.StatusCreated)
	var projectA projectResponse
	decodeResponse(t, response, &projectA)
	if got := strings.Join(projectA.AllowedOrigins, ","); got != "https://example.com,http://localhost:3000" {
		t.Fatalf("normalized origins=%q", got)
	}
	if !strings.HasPrefix(projectA.WriteKey, "orr_pk_") {
		t.Fatalf("initial write key=%q", projectA.WriteKey)
	}
	initialWriteKey := projectA.WriteKey
	validated, err := keys.Validate(ctx, initialWriteKey)
	if err != nil || validated.Project.ID.String() != projectA.ID {
		t.Fatalf("validate initial key project=%s err=%v", validated.Project.ID, err)
	}
	var initialKeyID uuid.UUID
	var storedPrefix string
	var hashLength int
	if err := database.QueryRowContext(ctx,
		"SELECT id, key_prefix, octet_length(key_hash) FROM project_keys WHERE project_id=$1", uuid.MustParse(projectA.ID),
	).Scan(&initialKeyID, &storedPrefix, &hashLength); err != nil {
		t.Fatal(err)
	}
	if storedPrefix != initialWriteKey[:16] || hashLength != sha256.Size {
		t.Fatalf("stored key prefix=%q hashLength=%d", storedPrefix, hashLength)
	}
	keyPath := "/api/v1/projects/" + projectA.ID + "/keys"
	response = performControlPlaneRequest(t, router, "owner-a", http.MethodGet, keyPath, "", false)
	assertStatus(t, response, http.StatusOK)
	if strings.Contains(response.Body.String(), initialWriteKey) || strings.Contains(response.Body.String(), "writeKey") {
		t.Fatalf("key list exposed raw credential: %s", response.Body.String())
	}
	response = performControlPlaneRequest(t, router, "viewer", http.MethodGet, keyPath, "", false)
	assertStatus(t, response, http.StatusForbidden)
	response = performControlPlaneRequest(t, router, "owner-b", http.MethodGet, keyPath, "", false)
	assertStatus(t, response, http.StatusNotFound)
	response = performControlPlaneRequest(t, router, "owner-a", http.MethodPost, keyPath+"/"+initialKeyID.String()+"/rotate",
		`{"name":"Rotated browser key"}`, true)
	assertStatus(t, response, http.StatusCreated)
	var rotatedKey projectKeyResponse
	decodeResponse(t, response, &rotatedKey)
	if rotatedKey.WriteKey == "" || rotatedKey.WriteKey == initialWriteKey {
		t.Fatalf("rotated write key=%q", rotatedKey.WriteKey)
	}
	if _, err := keys.Validate(ctx, initialWriteKey); !errors.Is(err, metadata.ErrInvalidProjectKey) {
		t.Fatalf("old rotated key validation error=%v", err)
	}
	if _, err := keys.Validate(ctx, rotatedKey.WriteKey); err != nil {
		t.Fatalf("new rotated key validation error=%v", err)
	}
	response = performControlPlaneRequest(t, router, "owner-a", http.MethodDelete, keyPath+"/"+rotatedKey.ID, "", true)
	assertStatus(t, response, http.StatusNoContent)
	if _, err := keys.Validate(ctx, rotatedKey.WriteKey); !errors.Is(err, metadata.ErrInvalidProjectKey) {
		t.Fatalf("revoked key validation error=%v", err)
	}
	response = performControlPlaneRequest(t, router, "owner-a", http.MethodPost, keyPath,
		`{"name":"CI browser key"}`, true)
	assertStatus(t, response, http.StatusCreated)
	var createdKey projectKeyResponse
	decodeResponse(t, response, &createdKey)
	if _, err := keys.Validate(ctx, createdKey.WriteKey); err != nil {
		t.Fatalf("created key validation error=%v", err)
	}

	projectB, err := projects.Create(ctx, ownerB, metadata.CreateProjectInput{
		OrganizationID: organizationB.Organization.ID, Name: "Private B", Slug: "private-b", Environment: "production",
		RetentionDays: 14, EventSampleRate: 1, APISampleRate: 0.2,
	})
	if err != nil {
		t.Fatal(err)
	}
	response = performControlPlaneRequest(t, router, "owner-a", http.MethodGet, "/api/v1/projects/"+projectB.ID.String(), "", false)
	assertStatus(t, response, http.StatusNotFound)
	response = performControlPlaneRequest(t, router, "viewer", http.MethodGet, "/api/v1/projects/"+projectA.ID, "", false)
	assertStatus(t, response, http.StatusOK)
	response = performControlPlaneRequest(t, router, "viewer", http.MethodPatch, "/api/v1/projects/"+projectA.ID,
		`{"retentionDays":30}`, true)
	assertStatus(t, response, http.StatusForbidden)
	response = performControlPlaneRequest(t, router, "owner-a", http.MethodPatch, "/api/v1/projects/"+projectA.ID,
		`{"retentionDays":30,"status":"disabled"}`, true)
	assertStatus(t, response, http.StatusOK)
	decodeResponse(t, response, &projectA)
	if projectA.RetentionDays != 30 || projectA.Status != metadata.ProjectStatusDisabled {
		t.Fatalf("updated project=%+v", projectA)
	}

	response = performControlPlaneRequest(t, router, "owner-a", http.MethodPost, memberPath,
		`{"email":"admin@example.com","role":"admin"}`, true)
	assertStatus(t, response, http.StatusCreated)
	response = performControlPlaneRequest(t, router, "admin", http.MethodPost, memberPath,
		`{"email":"member@example.com","role":"member"}`, true)
	assertStatus(t, response, http.StatusCreated)
	response = performControlPlaneRequest(t, router, "admin", http.MethodPost, memberPath,
		`{"email":"owner-b@example.com","role":"owner"}`, true)
	assertStatus(t, response, http.StatusForbidden)
	response = performControlPlaneRequest(t, router, "admin", http.MethodDelete, memberPath+"/"+member.String(), "", true)
	assertStatus(t, response, http.StatusNoContent)
	response = performControlPlaneRequest(t, router, "admin", http.MethodPatch, memberPath+"/"+ownerA.String(),
		`{"role":"admin"}`, true)
	assertStatus(t, response, http.StatusForbidden)
	response = performControlPlaneRequest(t, router, "owner-a", http.MethodPatch, memberPath+"/"+ownerA.String(),
		`{"role":"admin"}`, true)
	assertStatus(t, response, http.StatusConflict)

	response = performControlPlaneRequest(t, router, "viewer", http.MethodGet, memberPath, "", false)
	assertStatus(t, response, http.StatusOK)
	response = performControlPlaneRequest(t, router, "owner-a", http.MethodGet, projectPath, "", false)
	assertStatus(t, response, http.StatusOK)
	response = performControlPlaneRequest(t, router, "owner-a", http.MethodPatch, "/api/v1/projects/"+projectA.ID,
		`{"retentionDays":7}`, false)
	assertStatus(t, response, http.StatusForbidden)

	organizationAID := uuid.MustParse(organizationA.ID)
	var audits int
	if err := database.QueryRowContext(ctx,
		"SELECT count(*) FROM audit_logs WHERE organization_id=$1 AND action IN ('organization.created','member.added','member.removed','project.created','project.updated')",
		organizationAID).Scan(&audits); err != nil {
		t.Fatal(err)
	}
	if audits < 5 {
		t.Fatalf("mutation audit count=%d", audits)
	}
}

type fixtureAuthenticator struct {
	principals map[string]auth.Principal
}

func (authenticator fixtureAuthenticator) Authenticate(_ context.Context, token string) (auth.Principal, error) {
	principal, ok := authenticator.principals[token]
	if !ok {
		return auth.Principal{}, auth.ErrUnauthenticated
	}
	return principal, nil
}

func controlPlaneTestRouter(organizations *metadata.OrganizationRepository, projects *metadata.ProjectRepository, keys *metadata.ProjectKeyRepository, principals map[string]auth.Principal) http.Handler {
	logger := zerolog.Nop()
	router := httpx.NewRouter(logger)
	organizationHandler := NewOrganizationHandler(organizations, logger)
	memberHandler := NewMemberHandler(organizations, logger)
	projectHandler := NewProjectHandler(organizations, projects, logger)
	projectKeyHandler := NewProjectKeyHandler(keys, logger)
	requireSession := httpx.RequireSession(fixtureAuthenticator{principals: principals})
	baseURL, _ := url.Parse("http://openrum.test")
	requireCSRF := httpx.RequireCSRF(baseURL)
	read := func(handler http.HandlerFunc) http.Handler { return requireSession(handler) }
	write := func(handler http.HandlerFunc) http.Handler { return requireSession(requireCSRF(handler)) }
	router.Handle("GET /api/v1/organizations", read(organizationHandler.List))
	router.Handle("POST /api/v1/organizations", write(organizationHandler.Create))
	router.Handle("GET /api/v1/organizations/{orgId}/members", read(memberHandler.List))
	router.Handle("POST /api/v1/organizations/{orgId}/members", write(memberHandler.Add))
	router.Handle("PATCH /api/v1/organizations/{orgId}/members/{userId}", write(memberHandler.Update))
	router.Handle("DELETE /api/v1/organizations/{orgId}/members/{userId}", write(memberHandler.Remove))
	router.Handle("GET /api/v1/organizations/{orgId}/projects", read(projectHandler.List))
	router.Handle("POST /api/v1/organizations/{orgId}/projects", write(projectHandler.Create))
	router.Handle("GET /api/v1/projects/{projectId}", read(projectHandler.Get))
	router.Handle("PATCH /api/v1/projects/{projectId}", write(projectHandler.Update))
	router.Handle("GET /api/v1/projects/{projectId}/keys", read(projectKeyHandler.List))
	router.Handle("POST /api/v1/projects/{projectId}/keys", write(projectKeyHandler.Create))
	router.Handle("POST /api/v1/projects/{projectId}/keys/{keyId}/rotate", write(projectKeyHandler.Rotate))
	router.Handle("DELETE /api/v1/projects/{projectId}/keys/{keyId}", write(projectKeyHandler.Revoke))
	return router
}

func performControlPlaneRequest(t *testing.T, handler http.Handler, token, method, path, body string, csrf bool) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(method, path, bytes.NewBufferString(body))
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

func assertStatus(t *testing.T, response *httptest.ResponseRecorder, expected int) {
	t.Helper()
	if response.Code != expected {
		t.Fatalf("status=%d want=%d body=%s", response.Code, expected, response.Body.String())
	}
}

func decodeResponse(t *testing.T, response *httptest.ResponseRecorder, destination any) {
	t.Helper()
	if err := json.Unmarshal(response.Body.Bytes(), destination); err != nil {
		t.Fatalf("decode response %q: %v", response.Body.String(), err)
	}
}

func openControlPlaneTestDatabase(t *testing.T) *sql.DB {
	t.Helper()
	dsn := os.Getenv("TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("TEST_POSTGRES_DSN is not set")
	}
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	databaseName := strings.TrimPrefix(parsed.Path, "/")
	if (parsed.Hostname() != "localhost" && parsed.Hostname() != "127.0.0.1" && parsed.Hostname() != "::1") ||
		!strings.HasSuffix(databaseName, "_test") || strings.Contains(databaseName, "/") {
		t.Fatalf("refusing destructive test against %s/%s", parsed.Hostname(), databaseName)
	}
	database, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	if err := database.Ping(); err != nil {
		_ = database.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	return database
}
