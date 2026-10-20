//go:build integration

package handlers

import (
	"context"
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

type registrationRoles struct{ role metadata.InstanceRole }

func (roles registrationRoles) RoleForUser(context.Context, uuid.UUID) (metadata.InstanceRole, error) {
	return roles.role, nil
}

func TestRegistrationFlow(t *testing.T) {
	database := openControlPlaneTestDatabase(t)
	redisAddress := os.Getenv("TEST_REDIS_ADDR")
	if redisAddress == "" {
		t.Skip("TEST_REDIS_ADDR is not set")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	if err := migrate.PostgresUp(ctx, database, migrations.Files); err != nil {
		t.Fatal(err)
	}
	const truncate = "TRUNCATE audit_logs, sessions, email_verifications, organization_members, organizations, users CASCADE"
	reset := func() {
		if _, err := database.ExecContext(ctx, truncate); err != nil {
			t.Fatal(err)
		}
		if _, err := database.ExecContext(ctx, "DELETE FROM instance_settings WHERE namespace='auth' AND key='registration'"); err != nil {
			t.Fatal(err)
		}
	}
	reset()
	t.Cleanup(func() {
		_, _ = database.ExecContext(context.Background(), truncate)
		_, _ = database.ExecContext(context.Background(), "DELETE FROM instance_settings WHERE namespace='auth' AND key='registration'")
	})
	redisClient := redis.NewClient(&redis.Options{Addr: redisAddress})
	t.Cleanup(func() { _ = redisClient.Close() })
	if err := redisClient.Ping(ctx).Err(); err != nil {
		t.Skipf("redis unavailable: %v", err)
	}
	clearLimits := func() {
		keys, err := redisClient.Keys(ctx, "openrum:registration:*").Result()
		if err != nil {
			t.Fatal(err)
		}
		if len(keys) > 0 {
			if err := redisClient.Del(ctx, keys...).Err(); err != nil {
				t.Fatal(err)
			}
		}
	}
	clearLimits()

	owner := uuid.New()
	if _, err := database.ExecContext(ctx,
		"INSERT INTO users (id,email,display_name,password_hash) VALUES ($1,'owner@example.com','Owner','hash')", owner); err != nil {
		t.Fatal(err)
	}
	repository := metadata.NewRegistrationRepository(database)
	mail := &fakeInvitationMail{configured: true}
	logger := zerolog.Nop()
	baseURL, _ := url.Parse("http://openrum.test")
	sessions := auth.NewSessionManager(database)
	handler := NewRegistrationHandler(repository, sessions, mail, registrationRoles{role: metadata.InstanceRoleOwner}, redisClient, baseURL, false, logger)
	router := httpx.NewRouter(logger)
	principals := map[string]auth.Principal{"owner": {UserID: owner, Email: "owner@example.com", DisplayName: "Owner", AccessStatus: "approved"}}
	requireSession := httpx.RequireSession(fixtureAuthenticator{principals: principals})
	router.HandleFunc("GET /api/v1/auth/registration", handler.Status)
	router.HandleFunc("POST /api/v1/auth/register", handler.Register)
	router.HandleFunc("POST /api/v1/auth/register/resend", handler.Resend)
	router.HandleFunc("POST /api/v1/auth/register/verify", handler.Verify)
	router.Handle("GET /api/v1/admin/registration", requireSession(http.HandlerFunc(handler.AdminGet)))
	// Opening and closing needs a recent password check the test router cannot give, so the
	// policy store is exercised directly below.

	register := func(body string) *httptest.ResponseRecorder {
		return performAnonymous(t, router, http.MethodPost, "/api/v1/auth/register", body)
	}
	const goodBody = `{"email":"New.User@Example.com","displayName":"Nina New","password":"Str0ng-pass"}`
	linkOf := func(message mailer.Message) string {
		start := strings.Index(message.Body, "http://openrum.test/verify-email/")
		if start < 0 {
			t.Fatalf("no link in %q", message.Body)
		}
		rest := message.Body[start:]
		if end := strings.IndexAny(rest, "\n "); end >= 0 {
			rest = rest[:end]
		}
		return rest
	}
	tokenOf := func(link string) string { return link[strings.LastIndex(link, "/")+1:] }

	t.Run("registration is closed until an administrator opens it", func(t *testing.T) {
		var status registrationStatus
		decodeResponse(t, performAnonymous(t, router, http.MethodGet, "/api/v1/auth/registration", ""), &status)
		if status.Open || status.Email {
			t.Fatalf("status=%+v on a fresh instance", status)
		}
		response := register(goodBody)
		assertStatus(t, response, http.StatusForbidden)
		if !strings.Contains(response.Body.String(), "REGISTRATION_CLOSED") || len(mail.sent) != 0 {
			t.Fatalf("body=%s mails=%d", response.Body.String(), len(mail.sent))
		}
		if err := repository.SetOpen(ctx, owner, true); err != nil {
			t.Fatal(err)
		}
		decodeResponse(t, performAnonymous(t, router, http.MethodGet, "/api/v1/auth/registration", ""), &status)
		if !status.Open || !status.Email {
			t.Fatalf("status=%+v after opening", status)
		}
	})

	t.Run("the email form needs a mail server", func(t *testing.T) {
		mail.configured = false
		defer func() { mail.configured = true }()
		var status registrationStatus
		decodeResponse(t, performAnonymous(t, router, http.MethodGet, "/api/v1/auth/registration", ""), &status)
		if !status.Open || status.Email {
			t.Fatalf("status=%+v without a mail server", status)
		}
		assertStatus(t, register(goodBody), http.StatusServiceUnavailable)
		assertStatus(t, performAnonymous(t, router, http.MethodPost, "/api/v1/auth/register/resend", `{"email":"new.user@example.com"}`), http.StatusServiceUnavailable)
		var accounts int
		if err := database.QueryRowContext(ctx, "SELECT count(*) FROM users WHERE access_status='unverified'").Scan(&accounts); err != nil || accounts != 0 {
			t.Fatalf("accounts=%d err=%v", accounts, err)
		}
	})

	t.Run("sign-up checks the name, the address and the password rule", func(t *testing.T) {
		for _, body := range []string{
			`{"email":"nope","displayName":"A","password":"Str0ng-pass"}`,
			`{"email":"a@example.com","displayName":"","password":"Str0ng-pass"}`,
			`{"email":"a@example.com","displayName":"A","password":"Sh0rt-1"}`,
			`{"email":"a@example.com","displayName":"A","password":"alllowercase-1"}`,
			`{"email":"a@example.com","displayName":"A","password":"ALLUPPERCASE-1"}`,
			`{"email":"a@example.com","displayName":"A","password":"NoSymbols1234"}`,
		} {
			assertStatus(t, register(body), http.StatusBadRequest)
		}
		if len(mail.sent) != 0 {
			t.Fatalf("mails=%d for refused sign-ups", len(mail.sent))
		}
	})

	var link string
	t.Run("an account is created unverified and its link is mailed", func(t *testing.T) {
		response := register(goodBody)
		assertStatus(t, response, http.StatusAccepted)
		if len(mail.sent) != 1 || mail.sent[0].To[0] != "new.user@example.com" {
			t.Fatalf("mails=%+v", mail.sent)
		}
		link = linkOf(mail.sent[0])
		var status, hash string
		if err := database.QueryRowContext(ctx, "SELECT access_status, password_hash FROM users WHERE email='new.user@example.com'").Scan(&status, &hash); err != nil {
			t.Fatal(err)
		}
		if status != "unverified" || strings.Contains(hash, "Str0ng-pass") {
			t.Fatalf("status=%q hash=%q", status, hash)
		}
		// The secret itself is never stored, only its hash.
		var leaked int
		if err := database.QueryRowContext(ctx, "SELECT count(*) FROM email_verifications WHERE encode(token_hash,'escape') LIKE '%' || $1 || '%'", tokenOf(link)).Scan(&leaked); err != nil || leaked != 0 {
			t.Fatalf("token leaked=%d err=%v", leaked, err)
		}
	})

	t.Run("an unverified account cannot sign in, and says why only for the right password", func(t *testing.T) {
		limiter := auth.NewRedisFailureLimiter(redisClient)
		manager, err := auth.NewLoginManager(database, limiter)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := manager.Authenticate(ctx, "new.user@example.com", "Str0ng-pass", "203.0.113.9"); err != auth.ErrEmailNotVerified {
			t.Fatalf("right password err=%v", err)
		}
		if _, err := manager.Authenticate(ctx, "new.user@example.com", "Wr0ng-pass!", "203.0.113.9"); err != auth.ErrInvalidCredentials {
			t.Fatalf("wrong password err=%v", err)
		}
	})

	t.Run("registering the same address again sends nothing new and changes nothing", func(t *testing.T) {
		// A second attempt with another password, straight away: the link is not re-mailed
		// inside the resend interval and the stored password stays the first one.
		assertStatus(t, register(`{"email":"new.user@example.com","displayName":"Mallory","password":"Other-Pass1"}`), http.StatusAccepted)
		if len(mail.sent) != 1 {
			t.Fatalf("mails=%d, want the first only", len(mail.sent))
		}
		var name string
		if err := database.QueryRowContext(ctx, "SELECT display_name FROM users WHERE email='new.user@example.com'").Scan(&name); err != nil || name != "Nina New" {
			t.Fatalf("name=%q err=%v", name, err)
		}
		// An address that belongs to a confirmed account looks the same and sends nothing.
		assertStatus(t, register(`{"email":"owner@example.com","displayName":"Mallory","password":"Other-Pass1"}`), http.StatusAccepted)
		if len(mail.sent) != 1 {
			t.Fatalf("mails=%d after registering an existing address", len(mail.sent))
		}
	})

	t.Run("a resend replaces the link once the interval has passed", func(t *testing.T) {
		if _, err := database.ExecContext(ctx, "UPDATE email_verifications SET sent_at = now() - interval '2 minutes'"); err != nil {
			t.Fatal(err)
		}
		assertStatus(t, performAnonymous(t, router, http.MethodPost, "/api/v1/auth/register/resend", `{"email":"New.User@example.com"}`), http.StatusAccepted)
		if len(mail.sent) != 2 {
			t.Fatalf("mails=%d, want 2", len(mail.sent))
		}
		newer := linkOf(mail.sent[1])
		if newer == link {
			t.Fatal("resend reused the old link")
		}
		// The old link no longer works; the new one does.
		assertStatus(t, performAnonymous(t, router, http.MethodPost, "/api/v1/auth/register/verify", `{"token":"`+tokenOf(link)+`"}`), http.StatusGone)
		link = newer
		// Unknown and confirmed addresses get the same answer and no message.
		assertStatus(t, performAnonymous(t, router, http.MethodPost, "/api/v1/auth/register/resend", `{"email":"nobody@example.com"}`), http.StatusAccepted)
		assertStatus(t, performAnonymous(t, router, http.MethodPost, "/api/v1/auth/register/resend", `{"email":"owner@example.com"}`), http.StatusAccepted)
		if len(mail.sent) != 2 {
			t.Fatalf("mails=%d for addresses with nothing to verify", len(mail.sent))
		}
	})

	t.Run("a link works once, approves the account and signs it in", func(t *testing.T) {
		assertStatus(t, performAnonymous(t, router, http.MethodPost, "/api/v1/auth/register/verify", `{"token":"orev_not-a-real-secret"}`), http.StatusGone)
		assertStatus(t, performAnonymous(t, router, http.MethodPost, "/api/v1/auth/register/verify", `{"token":"garbage"}`), http.StatusGone)
		response := performAnonymous(t, router, http.MethodPost, "/api/v1/auth/register/verify", `{"token":"`+tokenOf(link)+`"}`)
		assertStatus(t, response, http.StatusOK)
		var cookies []string
		for _, cookie := range response.Result().Cookies() {
			cookies = append(cookies, cookie.Name)
		}
		if !strings.Contains(strings.Join(cookies, ","), auth.SessionCookieName) {
			t.Fatalf("cookies=%v", cookies)
		}
		var status string
		if err := database.QueryRowContext(ctx, "SELECT access_status FROM users WHERE email='new.user@example.com'").Scan(&status); err != nil || status != "approved" {
			t.Fatalf("status=%q err=%v", status, err)
		}
		assertStatus(t, performAnonymous(t, router, http.MethodPost, "/api/v1/auth/register/verify", `{"token":"`+tokenOf(link)+`"}`), http.StatusGone)
		manager, err := auth.NewLoginManager(database, auth.NewRedisFailureLimiter(redisClient))
		if err != nil {
			t.Fatal(err)
		}
		if user, err := manager.Authenticate(ctx, "new.user@example.com", "Str0ng-pass", "203.0.113.10"); err != nil || user.AccessStatus != "approved" {
			t.Fatalf("user=%+v err=%v", user, err)
		}
	})

	t.Run("a verified account can create its own organization", func(t *testing.T) {
		var userID uuid.UUID
		if err := database.QueryRowContext(ctx, "SELECT id FROM users WHERE email='new.user@example.com'").Scan(&userID); err != nil {
			t.Fatal(err)
		}
		organization, err := metadata.NewOrganizationRepository(database).Create(ctx, userID, "Nina's team", "ninas-team")
		if err != nil || organization.Role != metadata.RoleOwner {
			t.Fatalf("organization=%+v err=%v", organization, err)
		}
	})

	t.Run("an expired link is refused and unverified accounts are swept after a week", func(t *testing.T) {
		clearLimits()
		assertStatus(t, register(`{"email":"slow@example.com","displayName":"Sam Slow","password":"Str0ng-pass"}`), http.StatusAccepted)
		slowLink := linkOf(mail.sent[len(mail.sent)-1])
		if _, err := database.ExecContext(ctx, "UPDATE email_verifications SET expires_at = now() - interval '1 minute'"); err != nil {
			t.Fatal(err)
		}
		assertStatus(t, performAnonymous(t, router, http.MethodPost, "/api/v1/auth/register/verify", `{"token":"`+tokenOf(slowLink)+`"}`), http.StatusGone)
		if _, err := database.ExecContext(ctx, "UPDATE users SET created_at = now() - interval '8 days' WHERE email='slow@example.com'"); err != nil {
			t.Fatal(err)
		}
		// The next sign-up sweeps the stale account, so its address can register again.
		assertStatus(t, register(`{"email":"other@example.com","displayName":"Olga Other","password":"Str0ng-pass"}`), http.StatusAccepted)
		var left int
		if err := database.QueryRowContext(ctx, "SELECT count(*) FROM users WHERE email='slow@example.com'").Scan(&left); err != nil || left != 0 {
			t.Fatalf("left=%d err=%v", left, err)
		}
	})

	t.Run("a failed delivery is reported instead of pretending", func(t *testing.T) {
		clearLimits()
		mail.failWith = &mailer.Error{Stage: mailer.StageConnect, Message: "connection refused"}
		defer func() { mail.failWith = nil }()
		response := register(`{"email":"unlucky@example.com","displayName":"Una Unlucky","password":"Str0ng-pass"}`)
		assertStatus(t, response, http.StatusBadGateway)
		if !strings.Contains(response.Body.String(), "EMAIL_DELIVERY_FAILED") || strings.Contains(response.Body.String(), "connection refused") {
			t.Fatalf("body=%s", response.Body.String())
		}
	})

	t.Run("sign-ups from one address are limited", func(t *testing.T) {
		clearLimits()
		var last *httptest.ResponseRecorder
		for index := 0; index < registerLimit+1; index++ {
			last = register(`{"email":"flood` + uuid.NewString()[:8] + `@example.com","displayName":"F","password":"Str0ng-pass"}`)
		}
		assertStatus(t, last, http.StatusTooManyRequests)
		if last.Header().Get("Retry-After") == "" {
			t.Fatal("429 without Retry-After")
		}
	})

	t.Run("closing registration stops sign-ups but not people who already signed up", func(t *testing.T) {
		clearLimits()
		if err := repository.SetOpen(ctx, owner, false); err != nil {
			t.Fatal(err)
		}
		assertStatus(t, register(goodBody), http.StatusForbidden)
		var policy metadata.RegistrationPolicy
		policy, err := repository.Policy(ctx)
		if err != nil || policy.Open || policy.Version < 2 {
			t.Fatalf("policy=%+v err=%v", policy, err)
		}
		manager, err := auth.NewLoginManager(database, auth.NewRedisFailureLimiter(redisClient))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := manager.Authenticate(ctx, "new.user@example.com", "Str0ng-pass", "203.0.113.11"); err != nil {
			t.Fatalf("an existing account lost access: %v", err)
		}
	})
}
