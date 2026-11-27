//go:build integration

package handlers

import (
	"context"
	"encoding/json"
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
	"openrum/internal/metadata"
	"openrum/internal/migrate"
	"openrum/migrations"
)

func TestPasswordResetFlowIntegration(t *testing.T) {
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
	const truncate = "TRUNCATE password_resets, sessions, email_verifications, organization_members, organizations, users CASCADE"
	if _, err := database.ExecContext(ctx, truncate); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = database.ExecContext(context.Background(), truncate)
	})

	redisClient := redis.NewClient(&redis.Options{Addr: redisAddress})
	t.Cleanup(func() { _ = redisClient.Close() })
	if err := redisClient.Ping(ctx).Err(); err != nil {
		t.Skipf("redis unavailable: %v", err)
	}
	if keys, err := redisClient.Keys(ctx, "openrum:password-reset:*").Result(); err == nil && len(keys) > 0 {
		_ = redisClient.Del(ctx, keys...).Err()
	}

	userID := uuid.New()
	oldHash, err := auth.HashPassword("OldPassword123!")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := database.ExecContext(ctx,
		`INSERT INTO users (id, email, display_name, password_hash, email_verified_at)
		 VALUES ($1, 'owner@example.com', 'Owner', $2, NOW())`,
		userID, oldHash,
	); err != nil {
		t.Fatal(err)
	}

	sessions := auth.NewSessionManager(database)
	sessionCredentials, err := sessions.Create(ctx, userID, "127.0.0.1", "test-agent")
	if err != nil {
		t.Fatal(err)
	}

	repo := metadata.NewPasswordResetRepository(database)
	mail := &fakePasswordResetMail{configured: true}
	baseURL, _ := url.Parse("https://rum.example.com")
	handler := NewPasswordResetHandler(repo, mail, redisClient, baseURL, zerolog.Nop())

	router := httpx.NewRouter(zerolog.Nop())
	router.HandleFunc("GET /api/v1/auth/password-reset/status", handler.Status)
	router.HandleFunc("POST /api/v1/auth/password-reset/request", handler.Request)
	router.HandleFunc("POST /api/v1/auth/password-reset/confirm", handler.Confirm)

	// 1. Request reset link for existing verified account.
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/password-reset/request", strings.NewReader(`{"email":"owner@example.com"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("request status=%d body=%s", rec.Code, rec.Body.String())
	}
	if len(mail.sent) != 1 {
		t.Fatalf("sent=%d, want 1", len(mail.sent))
	}

	// Extract token from mailed link.
	const prefix = "https://rum.example.com/reset-password/"
	idx := strings.Index(mail.sent[0].Body, prefix)
	if idx < 0 {
		t.Fatalf("missing reset URL in %q", mail.sent[0].Body)
	}
	rest := mail.sent[0].Body[idx+len(prefix):]
	token := strings.Fields(rest)[0]

	// 2. Immediate repeat request within cooldown should still return 202 without sending a second email.
	req2 := httptest.NewRequest(http.MethodPost, "/api/v1/auth/password-reset/request", strings.NewReader(`{"email":"owner@example.com"}`))
	req2.Header.Set("Content-Type", "application/json")
	rec2 := httptest.NewRecorder()
	router.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusAccepted {
		t.Fatalf("second request status=%d, want 202", rec2.Code)
	}
	if len(mail.sent) != 1 {
		t.Fatalf("cooldown should prevent second email, got %d", len(mail.sent))
	}

	// 3. Confirm password reset; old session should be revoked and token consumed.
	confirmPayload, _ := json.Marshal(map[string]string{
		"token":    token,
		"password": "BrandNewPassword123!",
	})
	confirmReq := httptest.NewRequest(http.MethodPost, "/api/v1/auth/password-reset/confirm", strings.NewReader(string(confirmPayload)))
	confirmReq.Header.Set("Content-Type", "application/json")
	confirmRec := httptest.NewRecorder()
	router.ServeHTTP(confirmRec, confirmReq)
	if confirmRec.Code != http.StatusNoContent {
		t.Fatalf("confirm status=%d body=%s", confirmRec.Code, confirmRec.Body.String())
	}

	// Reusing the same token must fail with 410.
	reuseReq := httptest.NewRequest(http.MethodPost, "/api/v1/auth/password-reset/confirm", strings.NewReader(string(confirmPayload)))
	reuseReq.Header.Set("Content-Type", "application/json")
	reuseRec := httptest.NewRecorder()
	router.ServeHTTP(reuseRec, reuseReq)
	if reuseRec.Code != http.StatusGone {
		t.Fatalf("reuse status=%d, want 410", reuseRec.Code)
	}

	// Old session should be invalid.
	if _, err := sessions.Authenticate(ctx, sessionCredentials.Token); err == nil {
		t.Fatalf("expected prior session to be revoked after password reset")
	}

	// New password should verify against stored hash.
	var storedHash string
	if err := database.QueryRowContext(ctx, `SELECT password_hash FROM users WHERE id = $1`, userID).Scan(&storedHash); err != nil {
		t.Fatal(err)
	}
	if ok, err := auth.VerifyPassword("BrandNewPassword123!", storedHash); err != nil || !ok {
		t.Fatalf("stored password hash did not match new password (err=%v)", err)
	}

	// 4. Emergency CLI path: AdminResetPassword updates password and revokes sessions.
	sessionCredentials2, err := sessions.Create(ctx, userID, "127.0.0.1", "test-agent")
	if err != nil {
		t.Fatal(err)
	}
	cliHash, err := auth.HashPassword("EmergencyReset123!")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AdminResetPassword(ctx, "owner@example.com", cliHash); err != nil {
		t.Fatalf("AdminResetPassword: %v", err)
	}
	if _, err := sessions.Authenticate(ctx, sessionCredentials2.Token); err == nil {
		t.Fatalf("expected session to be revoked after AdminResetPassword")
	}
}
