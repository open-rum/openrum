//go:build integration

package handlers

import (
	"context"
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
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"

	"openrum/internal/auth"
	"openrum/internal/httpx"
	"openrum/internal/mailer"
	"openrum/internal/metadata"
	"openrum/internal/migrate"
	"openrum/migrations"
)

type fakeInvitationMail struct {
	configured bool
	failWith   error
	sent       []mailer.Message
}

func (mail *fakeInvitationMail) Configured(context.Context) (bool, error) {
	return mail.configured, nil
}

func (mail *fakeInvitationMail) Send(_ context.Context, message mailer.Message) error {
	if mail.failWith != nil {
		return mail.failWith
	}
	mail.sent = append(mail.sent, message)
	return nil
}

func TestInvitationsFlow(t *testing.T) {
	database := openControlPlaneTestDatabase(t)
	redisAddress := os.Getenv("TEST_REDIS_ADDR")
	if redisAddress == "" {
		t.Skip("TEST_REDIS_ADDR is not set")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	if err := migrate.PostgresUp(ctx, database, migrations.Files); err != nil {
		t.Fatal(err)
	}
	const truncate = "TRUNCATE audit_logs, sessions, organization_join_requests, organization_invitations, project_keys, projects, organization_members, organizations, users CASCADE"
	if _, err := database.ExecContext(ctx, truncate); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = database.ExecContext(context.Background(), truncate) })
	redisClient := redis.NewClient(&redis.Options{Addr: redisAddress})
	t.Cleanup(func() { _ = redisClient.Close() })
	if err := redisClient.Ping(ctx).Err(); err != nil {
		t.Skipf("redis unavailable: %v", err)
	}
	if err := clearRegistrationLimit(ctx, redisClient); err != nil {
		t.Fatal(err)
	}

	owner, admin, member, outsider := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	for _, user := range []struct {
		id    uuid.UUID
		email string
	}{{owner, "owner@example.com"}, {admin, "admin@example.com"}, {member, "member@example.com"}, {outsider, "outsider@example.com"}} {
		if _, err := database.ExecContext(ctx,
			"INSERT INTO users (id,email,display_name,password_hash) VALUES ($1,$2,$3,'hash')", user.id, user.email, user.email); err != nil {
			t.Fatal(err)
		}
	}
	organizations := metadata.NewOrganizationRepository(database)
	created, err := organizations.Create(ctx, owner, "Acme", "acme")
	if err != nil {
		t.Fatal(err)
	}
	organization := created.Organization
	if err := organizations.AddMember(ctx, owner, organization.ID, admin, metadata.RoleAdmin); err != nil {
		t.Fatal(err)
	}
	if err := organizations.AddMember(ctx, owner, organization.ID, member, metadata.RoleMember); err != nil {
		t.Fatal(err)
	}
	principals := map[string]auth.Principal{
		"owner":    {UserID: owner, Email: "owner@example.com", DisplayName: "Olivia Owner", AccessStatus: "approved"},
		"admin":    {UserID: admin, Email: "admin@example.com", DisplayName: "Adam Admin", AccessStatus: "approved"},
		"member":   {UserID: member, Email: "member@example.com", DisplayName: "Mia Member", AccessStatus: "approved"},
		"outsider": {UserID: outsider, Email: "outsider@example.com", DisplayName: "Otto Outsider", AccessStatus: "approved"},
	}
	mail := &fakeInvitationMail{}
	router := invitationTestRouter(database, organizations, mail, redisClient, principals)
	base := "/api/v1/organizations/" + organization.ID.String()

	t.Run("only owners and admins create invitations", func(t *testing.T) {
		assertStatus(t, performControlPlaneRequest(t, router, "member", http.MethodPost, base+"/invitations", `{"role":"member"}`, true), http.StatusForbidden)
		assertStatus(t, performControlPlaneRequest(t, router, "member", http.MethodGet, base+"/invitations", "", false), http.StatusForbidden)
		assertStatus(t, performControlPlaneRequest(t, router, "outsider", http.MethodGet, base+"/invitations", "", false), http.StatusNotFound)
		assertStatus(t, performControlPlaneRequest(t, router, "admin", http.MethodPost, base+"/invitations", `{"role":"owner"}`, true), http.StatusBadRequest)
		assertStatus(t, performControlPlaneRequest(t, router, "admin", http.MethodPost, base+"/invitations", `{"role":"member","email":"not-an-email"}`, true), http.StatusBadRequest)
	})

	t.Run("a copied link needs no mail server", func(t *testing.T) {
		created := createInvitation(t, router, "admin", base, `{"role":"member"}`)
		if !strings.Contains(created.Link, "/invite/ori_") || !strings.HasPrefix(created.Link, "http://openrum.test/") {
			t.Fatalf("link=%q", created.Link)
		}
		if created.Delivery != nil {
			t.Fatalf("delivery=%+v for a link without an address", created.Delivery)
		}
		var stored int
		if err := database.QueryRowContext(ctx,
			"SELECT count(*) FROM organization_invitations WHERE organization_id=$1 AND role='member' AND email IS NULL", organization.ID).Scan(&stored); err != nil || stored != 1 {
			t.Fatalf("stored=%d err=%v", stored, err)
		}
		// The secret itself is never stored, only its hash.
		secret := created.Link[strings.LastIndex(created.Link, "/")+1:]
		var leaked int
		if err := database.QueryRowContext(ctx, "SELECT count(*) FROM organization_invitations WHERE encode(token_hash,'escape') LIKE '%' || $1 || '%'", secret).Scan(&leaked); err != nil || leaked != 0 {
			t.Fatalf("token leaked=%d err=%v", leaked, err)
		}
	})

	t.Run("mailing needs a configured mail server and survives a failed send", func(t *testing.T) {
		response := performControlPlaneRequest(t, router, "admin", http.MethodPost, base+"/invitations", `{"role":"viewer","email":"new@example.com"}`, true)
		assertStatus(t, response, http.StatusConflict)
		if !strings.Contains(response.Body.String(), "EMAIL_NOT_CONFIGURED") {
			t.Fatalf("body=%s", response.Body.String())
		}
		var listed listInvitationsResponse
		decodeResponse(t, performControlPlaneRequest(t, router, "admin", http.MethodGet, base+"/invitations", "", false), &listed)
		if listed.EmailEnabled {
			t.Fatal("emailEnabled=true without a mail server")
		}
		var refused int
		if err := database.QueryRowContext(ctx, "SELECT count(*) FROM organization_invitations WHERE email IS NOT NULL").Scan(&refused); err != nil || refused != 0 {
			t.Fatalf("an invitation was stored although mail could not be sent: %d %v", refused, err)
		}

		mail.configured = true
		sent := createInvitation(t, router, "admin", base, `{"role":"viewer","email":"New@Example.com"}`)
		if sent.Delivery == nil || !sent.Delivery.Success || len(mail.sent) != 1 {
			t.Fatalf("delivery=%+v mails=%d", sent.Delivery, len(mail.sent))
		}
		if mail.sent[0].To[0] != "new@example.com" || !strings.Contains(mail.sent[0].Body, sent.Link) || !strings.Contains(mail.sent[0].Subject, "Acme") {
			t.Fatalf("message=%+v", mail.sent[0])
		}
		decodeResponse(t, performControlPlaneRequest(t, router, "admin", http.MethodGet, base+"/invitations", "", false), &listed)
		if !listed.EmailEnabled || len(listed.Invitations) != 2 {
			t.Fatalf("listed=%+v", listed)
		}

		mail.failWith = &mailer.Error{Stage: mailer.StageConnect, Message: "connection refused"}
		failed := createInvitation(t, router, "admin", base, `{"role":"member","email":"later@example.com"}`)
		if failed.Delivery == nil || failed.Delivery.Success || failed.Delivery.Stage != "connect" || failed.Link == "" {
			t.Fatalf("a failed send must still return the link: %+v", failed)
		}
		mail.failWith = nil
	})

	t.Run("a visitor sees only what the link is for", func(t *testing.T) {
		created := createInvitation(t, router, "owner", base, `{"role":"viewer"}`)
		token := created.Link[strings.LastIndex(created.Link, "/")+1:]
		var preview previewResponse
		response := performAnonymous(t, router, http.MethodGet, "/api/v1/invitations/"+token, "")
		assertStatus(t, response, http.StatusOK)
		decodeResponse(t, response, &preview)
		if preview.OrganizationName != "Acme" || preview.Role != "viewer" || preview.State != "valid" ||
			preview.InviterName == nil || *preview.InviterName != "owner@example.com" {
			t.Fatalf("preview=%+v", preview)
		}
		assertStatus(t, performAnonymous(t, router, http.MethodGet, "/api/v1/invitations/ori_does-not-exist", ""), http.StatusNotFound)
		assertStatus(t, performAnonymous(t, router, http.MethodGet, "/api/v1/invitations/not-a-token", ""), http.StatusNotFound)

		// Revoking is idempotent and the link stops working.
		assertStatus(t, performControlPlaneRequest(t, router, "admin", http.MethodDelete, base+"/invitations/"+created.Invitation.ID, "", true), http.StatusNoContent)
		assertStatus(t, performControlPlaneRequest(t, router, "admin", http.MethodDelete, base+"/invitations/"+created.Invitation.ID, "", true), http.StatusNoContent)
		assertStatus(t, performControlPlaneRequest(t, router, "admin", http.MethodDelete, base+"/invitations/"+uuid.NewString(), "", true), http.StatusNotFound)
		assertStatus(t, performControlPlaneRequest(t, router, "member", http.MethodDelete, base+"/invitations/"+created.Invitation.ID, "", true), http.StatusForbidden)
		decodeResponse(t, performAnonymous(t, router, http.MethodGet, "/api/v1/invitations/"+token, ""), &preview)
		if preview.State != "revoked" {
			t.Fatalf("state=%q after revoke", preview.State)
		}
		assertStatus(t, performControlPlaneRequest(t, router, "outsider", http.MethodPost, "/api/v1/invitations/"+token+"/join", "", true), http.StatusGone)
		assertStatus(t, performAnonymous(t, router, http.MethodPost, "/api/v1/invitations/"+token+"/register",
			`{"email":"late@example.com","displayName":"Late","password":"A-production-password"}`), http.StatusGone)
		var audits int
		if err := database.QueryRowContext(ctx, "SELECT count(*) FROM audit_logs WHERE action='member_invitation.revoked'").Scan(&audits); err != nil || audits != 1 {
			t.Fatalf("revoke audits=%d err=%v", audits, err)
		}
	})

	t.Run("an expired link cannot be used", func(t *testing.T) {
		created := createInvitation(t, router, "owner", base, `{"role":"member"}`)
		token := created.Link[strings.LastIndex(created.Link, "/")+1:]
		if _, err := database.ExecContext(ctx, "UPDATE organization_invitations SET expires_at=now() - interval '1 minute' WHERE id=$1", created.Invitation.ID); err != nil {
			t.Fatal(err)
		}
		var preview previewResponse
		decodeResponse(t, performAnonymous(t, router, http.MethodGet, "/api/v1/invitations/"+token, ""), &preview)
		if preview.State != "expired" {
			t.Fatalf("state=%q", preview.State)
		}
		assertStatus(t, performControlPlaneRequest(t, router, "outsider", http.MethodPost, "/api/v1/invitations/"+token+"/join", "", true), http.StatusGone)
		var listed listInvitationsResponse
		decodeResponse(t, performControlPlaneRequest(t, router, "admin", http.MethodGet, base+"/invitations", "", false), &listed)
		for _, invitation := range listed.Invitations {
			if invitation.ID == created.Invitation.ID {
				t.Fatal("an expired invitation is still listed")
			}
		}
	})

	live := createInvitation(t, router, "admin", base, `{"role":"member"}`)
	token := live.Link[strings.LastIndex(live.Link, "/")+1:]
	registerPath := "/api/v1/invitations/" + token + "/register"

	t.Run("a new person registers and waits", func(t *testing.T) {
		assertStatus(t, performAnonymous(t, router, http.MethodPost, registerPath,
			`{"email":"new-hire@example.com","displayName":"Nina New","password":"short"}`), http.StatusBadRequest)
		assertStatus(t, performAnonymous(t, router, http.MethodPost, registerPath,
			`{"email":"nope","displayName":"Nina New","password":"A-production-password"}`), http.StatusBadRequest)
		assertStatus(t, performAnonymous(t, router, http.MethodPost, registerPath,
			`{"email":"new-hire@example.com","displayName":"","password":"A-production-password"}`), http.StatusBadRequest)

		response := performAnonymous(t, router, http.MethodPost, registerPath,
			`{"email":"New-Hire@example.com","displayName":"Nina New","password":"A-production-password"}`)
		assertStatus(t, response, http.StatusCreated)
		result := response.Result()
		defer func() { _ = result.Body.Close() }()
		if cookies := result.Cookies(); len(cookies) != 2 || cookies[0].Value == "" {
			t.Fatalf("cookies=%+v", cookies)
		}
		var status string
		var hash string
		if err := database.QueryRowContext(ctx, "SELECT access_status, password_hash FROM users WHERE email='new-hire@example.com'").Scan(&status, &hash); err != nil {
			t.Fatal(err)
		}
		if status != "pending" || !strings.HasPrefix(hash, "$argon2id$") {
			t.Fatalf("status=%q hash=%q", status, hash)
		}
		var members int
		if err := database.QueryRowContext(ctx, "SELECT count(*) FROM organization_members m JOIN users u ON u.id=m.user_id WHERE u.email='new-hire@example.com'").Scan(&members); err != nil || members != 0 {
			t.Fatalf("registering must not grant membership: %d %v", members, err)
		}
		names, err := metadata.NewInvitationRepository(database).PendingOrganizations(ctx, uuid.MustParse(jsonField(t, response.Body.Bytes(), "userId")))
		if err != nil || len(names) != 1 || names[0] != "Acme" {
			t.Fatalf("pending organizations=%v err=%v", names, err)
		}
		// The same address cannot register twice, and a taken address is told to sign in.
		taken := performAnonymous(t, router, http.MethodPost, registerPath,
			`{"email":"outsider@example.com","displayName":"Other","password":"A-production-password"}`)
		assertStatus(t, taken, http.StatusConflict)
		if !strings.Contains(taken.Body.String(), "EMAIL_TAKEN") {
			t.Fatalf("body=%s", taken.Body.String())
		}
	})

	t.Run("a pending account may sign in and wait", func(t *testing.T) {
		manager, err := auth.NewLoginManager(database, auth.NewRedisFailureLimiter(redisClient))
		if err != nil {
			t.Fatal(err)
		}
		user, err := manager.Authenticate(ctx, "new-hire@example.com", "A-production-password", "203.0.113.9")
		if err != nil || user.AccessStatus != "pending" {
			t.Fatalf("user=%+v err=%v", user, err)
		}
		if _, err := manager.Authenticate(ctx, "new-hire@example.com", "wrong-password-here", "203.0.113.9"); !errors.Is(err, auth.ErrInvalidCredentials) {
			t.Fatalf("wrong password err=%v", err)
		}
	})

	t.Run("an existing user asks to join once", func(t *testing.T) {
		joinPath := "/api/v1/invitations/" + token + "/join"
		for _, expected := range []string{"requested", "already_requested"} {
			response := performControlPlaneRequest(t, router, "outsider", http.MethodPost, joinPath, "", true)
			assertStatus(t, response, http.StatusOK)
			if outcome := jsonField(t, response.Body.Bytes(), "outcome"); outcome != expected {
				t.Fatalf("outcome=%q want %q", outcome, expected)
			}
		}
		response := performControlPlaneRequest(t, router, "member", http.MethodPost, joinPath, "", true)
		assertStatus(t, response, http.StatusOK)
		if outcome := jsonField(t, response.Body.Bytes(), "outcome"); outcome != "already_member" {
			t.Fatalf("outcome=%q", outcome)
		}
		assertStatus(t, performControlPlaneRequest(t, router, "outsider", http.MethodPost, joinPath, "", false), http.StatusForbidden)
		assertStatus(t, performAnonymous(t, router, http.MethodPost, joinPath, ""), http.StatusUnauthorized)
	})

	t.Run("administrators decide requests", func(t *testing.T) {
		assertStatus(t, performControlPlaneRequest(t, router, "member", http.MethodGet, base+"/join-requests", "", false), http.StatusForbidden)
		var listed struct {
			Requests []joinRequestResponse `json:"requests"`
		}
		decodeResponse(t, performControlPlaneRequest(t, router, "admin", http.MethodGet, base+"/join-requests", "", false), &listed)
		if len(listed.Requests) != 2 {
			t.Fatalf("requests=%+v", listed.Requests)
		}
		var newcomer, existing joinRequestResponse
		for _, request := range listed.Requests {
			switch request.Email {
			case "new-hire@example.com":
				newcomer = request
			case "outsider@example.com":
				existing = request
			}
		}
		if newcomer.ID == "" || existing.ID == "" || newcomer.Role != metadata.RoleMember {
			t.Fatalf("requests=%+v", listed.Requests)
		}

		approve := base + "/join-requests/" + newcomer.ID + "/approve"
		assertStatus(t, performControlPlaneRequest(t, router, "member", http.MethodPost, approve, `{"role":"member"}`, true), http.StatusForbidden)
		assertStatus(t, performControlPlaneRequest(t, router, "admin", http.MethodPost, approve, `{"role":"owner"}`, true), http.StatusForbidden)
		assertStatus(t, performControlPlaneRequest(t, router, "admin", http.MethodPost, approve, `{"role":"nobody"}`, true), http.StatusBadRequest)
		assertStatus(t, performControlPlaneRequest(t, router, "admin", http.MethodPost, approve, `{"role":"viewer"}`, true), http.StatusNoContent)
		var role, access string
		if err := database.QueryRowContext(ctx,
			`SELECT m.role, u.access_status FROM organization_members m JOIN users u ON u.id=m.user_id
			 WHERE m.organization_id=$1 AND u.email='new-hire@example.com'`, organization.ID).Scan(&role, &access); err != nil {
			t.Fatal(err)
		}
		if role != "viewer" || access != "approved" {
			t.Fatalf("role=%q access=%q", role, access)
		}
		assertStatus(t, performControlPlaneRequest(t, router, "admin", http.MethodPost, approve, `{"role":"viewer"}`, true), http.StatusNotFound)

		reject := base + "/join-requests/" + existing.ID + "/reject"
		assertStatus(t, performControlPlaneRequest(t, router, "member", http.MethodPost, reject, "", true), http.StatusForbidden)
		assertStatus(t, performControlPlaneRequest(t, router, "admin", http.MethodPost, reject, "", true), http.StatusNoContent)
		var memberships int
		if err := database.QueryRowContext(ctx, "SELECT count(*) FROM organization_members WHERE organization_id=$1 AND user_id=$2", organization.ID, outsider).Scan(&memberships); err != nil || memberships != 0 {
			t.Fatalf("a rejected request must not add the user: %d %v", memberships, err)
		}
		decodeResponse(t, performControlPlaneRequest(t, router, "admin", http.MethodGet, base+"/join-requests", "", false), &listed)
		if len(listed.Requests) != 0 {
			t.Fatalf("decided requests are still listed: %+v", listed.Requests)
		}
		var audits int
		if err := database.QueryRowContext(ctx, "SELECT count(*) FROM audit_logs WHERE action IN ('join_request.created','join_request.approved','join_request.rejected')").Scan(&audits); err != nil || audits != 4 {
			t.Fatalf("join request audits=%d err=%v", audits, err)
		}
		// Having been rejected, the user may ask again with a link that still works.
		response := performControlPlaneRequest(t, router, "outsider", http.MethodPost, "/api/v1/invitations/"+token+"/join", "", true)
		assertStatus(t, response, http.StatusOK)
		if outcome := jsonField(t, response.Body.Bytes(), "outcome"); outcome != "requested" {
			t.Fatalf("outcome=%q", outcome)
		}
	})

	t.Run("an organization holds a bounded number of open invitations", func(t *testing.T) {
		if _, err := database.ExecContext(ctx,
			`INSERT INTO organization_invitations (organization_id, token_hash, role, created_by, expires_at)
			 SELECT $1, sha256(convert_to('filler-' || n::text, 'UTF8')), 'member', $2, now() + interval '1 day'
			 FROM generate_series(1, $3::int) AS n`, organization.ID, owner, metadata.MaxActiveInvitations); err != nil {
			t.Fatal(err)
		}
		response := performControlPlaneRequest(t, router, "admin", http.MethodPost, base+"/invitations", `{"role":"member"}`, true)
		assertStatus(t, response, http.StatusConflict)
		if !strings.Contains(response.Body.String(), "INVITATION_LIMIT") {
			t.Fatalf("body=%s", response.Body.String())
		}
	})

	t.Run("registration is rate limited per address", func(t *testing.T) {
		if err := clearRegistrationLimit(ctx, redisClient); err != nil {
			t.Fatal(err)
		}
		if _, err := database.ExecContext(ctx, "DELETE FROM organization_invitations WHERE token_hash IN (SELECT sha256(convert_to('filler-' || n::text, 'UTF8')) FROM generate_series(1, 200) n)"); err != nil {
			t.Fatal(err)
		}
		limited := 0
		for attempt := 0; attempt < invitationRegisterLimit+3; attempt++ {
			response := performAnonymous(t, router, http.MethodPost, registerPath,
				`{"email":"outsider@example.com","displayName":"Other","password":"A-production-password"}`)
			if response.Code == http.StatusTooManyRequests {
				limited++
			}
		}
		if limited != 3 {
			t.Fatalf("limited=%d, want 3 beyond the first %d", limited, invitationRegisterLimit)
		}
	})
}

type invitationBody struct {
	ID string `json:"id"`
}

type deliveryBody struct {
	Success bool   `json:"success"`
	Stage   string `json:"stage"`
}

type createdInvitation struct {
	Invitation invitationBody `json:"invitation"`
	Link       string         `json:"link"`
	Delivery   *deliveryBody  `json:"delivery"`
}

type listInvitationsResponse struct {
	Invitations  []invitationResponse `json:"invitations"`
	EmailEnabled bool                 `json:"emailEnabled"`
}

type previewResponse struct {
	OrganizationName string  `json:"organizationName"`
	InviterName      *string `json:"inviterName"`
	Role             string  `json:"role"`
	State            string  `json:"state"`
}

func createInvitation(t *testing.T, router http.Handler, token, base, body string) createdInvitation {
	t.Helper()
	response := performControlPlaneRequest(t, router, token, http.MethodPost, base+"/invitations", body, true)
	assertStatus(t, response, http.StatusCreated)
	var created createdInvitation
	decodeResponse(t, response, &created)
	return created
}

// performAnonymous sends a request with no session, as a visitor who has only a link would.
func performAnonymous(t *testing.T, handler http.Handler, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequestWithContext(context.Background(), method, path, strings.NewReader(body))
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	request.RemoteAddr = "198.51.100.7:4444"
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func jsonField(t *testing.T, body []byte, name string) string {
	t.Helper()
	var fields map[string]any
	if err := json.Unmarshal(body, &fields); err != nil {
		t.Fatal(err)
	}
	value, _ := fields[name].(string)
	return value
}

func clearRegistrationLimit(ctx context.Context, client redis.UniversalClient) error {
	keys, err := client.Keys(ctx, "openrum:invite:register:*").Result()
	if err != nil || len(keys) == 0 {
		return err
	}
	return client.Del(ctx, keys...).Err()
}

func invitationTestRouter(database *sql.DB, organizations *metadata.OrganizationRepository, mail invitationMailer, redisClient redis.UniversalClient, principals map[string]auth.Principal) http.Handler {
	logger := zerolog.Nop()
	router := httpx.NewRouter(logger)
	baseURL, _ := url.Parse("http://openrum.test")
	handler := NewInvitationHandler(metadata.NewInvitationRepository(database), organizations, auth.NewSessionManager(database),
		mail, redisClient, baseURL, false, logger)
	requireSession := httpx.RequireSession(fixtureAuthenticator{principals: principals})
	requireCSRF := httpx.RequireCSRF(baseURL)
	read := func(next http.HandlerFunc) http.Handler { return requireSession(next) }
	write := func(next http.HandlerFunc) http.Handler { return requireSession(requireCSRF(next)) }
	router.Handle("GET /api/v1/organizations/{orgId}/invitations", read(handler.List))
	router.Handle("POST /api/v1/organizations/{orgId}/invitations", write(handler.Create))
	router.Handle("DELETE /api/v1/organizations/{orgId}/invitations/{invitationId}", write(handler.Revoke))
	router.Handle("GET /api/v1/organizations/{orgId}/join-requests", read(handler.ListRequests))
	router.Handle("POST /api/v1/organizations/{orgId}/join-requests/{requestId}/approve", write(handler.Approve))
	router.Handle("POST /api/v1/organizations/{orgId}/join-requests/{requestId}/reject", write(handler.Reject))
	router.HandleFunc("GET /api/v1/invitations/{token}", handler.Preview)
	router.HandleFunc("POST /api/v1/invitations/{token}/register", handler.Register)
	router.Handle("POST /api/v1/invitations/{token}/join", write(handler.Join))
	return router
}
