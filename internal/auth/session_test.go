package auth

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestSessionCredentialsAreRandomAndBounded(t *testing.T) {
	first, _, err := newSessionCredentials(time.Now())
	if err != nil {
		t.Fatal(err)
	}
	second, _, err := newSessionCredentials(time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if first.Token == second.Token || first.CSRFToken == second.CSRFToken {
		t.Fatal("session credentials were reused")
	}
	if first.ExpiresAt.Before(time.Now().Add(SessionAbsoluteTTL - time.Minute)) {
		t.Fatal("absolute expiry is too short")
	}
}

func TestSessionLifecycleRotationExpiryRevokeAndPasswordChange(t *testing.T) {
	dsn := os.Getenv("TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("TEST_POSTGRES_DSN is not set")
	}
	assertSafeTestDatabase(t, dsn)
	database, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = database.Close() }()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if _, err := database.ExecContext(ctx, "TRUNCATE audit_logs, sessions, project_keys, projects, organization_members, organizations, users CASCADE"); err != nil {
		t.Fatal(err)
	}
	defer func() {
		_, _ = database.ExecContext(context.WithoutCancel(ctx), "TRUNCATE audit_logs, sessions, project_keys, projects, organization_members, organizations, users CASCADE")
	}()

	passwordHash, err := HashPassword("current-password")
	if err != nil {
		t.Fatal(err)
	}
	userID := uuid.New()
	if _, err := database.ExecContext(ctx,
		"INSERT INTO users (id, email, display_name, password_hash) VALUES ($1, $2, $3, $4)",
		userID, "owner@example.com", "Owner", passwordHash); err != nil {
		t.Fatal(err)
	}
	manager := NewSessionManager(database)
	first, err := manager.Create(ctx, userID, "127.0.0.1", "test-agent")
	if err != nil {
		t.Fatal(err)
	}
	principal, err := manager.Authenticate(ctx, first.Token)
	if err != nil || principal.UserID != userID {
		t.Fatalf("principal=%+v err=%v", principal, err)
	}
	tokenHash := sha256.Sum256([]byte(first.Token))
	var storedHash []byte
	if err := database.QueryRowContext(ctx, "SELECT token_hash FROM sessions WHERE id=$1", principal.SessionID).Scan(&storedHash); err != nil {
		t.Fatal(err)
	}
	if string(storedHash) != string(tokenHash[:]) || string(storedHash) == first.Token {
		t.Fatal("database did not store exactly the session token hash")
	}

	rotated, err := manager.Rotate(ctx, userID, first.Token, "127.0.0.1", "test-agent")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Authenticate(ctx, first.Token); !errors.Is(err, ErrUnauthenticated) {
		t.Fatalf("rotated token error = %v", err)
	}
	rotatedPrincipal, err := manager.Authenticate(ctx, rotated.Token)
	if err != nil {
		t.Fatal(err)
	}

	other, err := manager.Create(ctx, userID, "127.0.0.2", "other-agent")
	if err != nil {
		t.Fatal(err)
	}
	if err := manager.ChangePassword(ctx, rotatedPrincipal, "current-password", "replacement-password"); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Authenticate(ctx, other.Token); !errors.Is(err, ErrUnauthenticated) {
		t.Fatalf("other session after password change error = %v", err)
	}
	var newHash string
	if err := database.QueryRowContext(ctx, "SELECT password_hash FROM users WHERE id=$1", userID).Scan(&newHash); err != nil {
		t.Fatal(err)
	}
	valid, err := VerifyPassword("replacement-password", newHash)
	if err != nil || !valid {
		t.Fatalf("new password valid=%v err=%v", valid, err)
	}

	if _, err := database.ExecContext(ctx, "UPDATE sessions SET idle_expires_at=now()-interval '1 second' WHERE id=$1", rotatedPrincipal.SessionID); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Authenticate(ctx, rotated.Token); !errors.Is(err, ErrUnauthenticated) {
		t.Fatalf("expired session error = %v", err)
	}

	fresh, err := manager.Create(ctx, userID, "127.0.0.1", "test-agent")
	if err != nil {
		t.Fatal(err)
	}
	freshPrincipal, err := manager.Authenticate(ctx, fresh.Token)
	if err != nil {
		t.Fatal(err)
	}
	if err := manager.Revoke(ctx, freshPrincipal.SessionID); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Authenticate(ctx, fresh.Token); !errors.Is(err, ErrUnauthenticated) {
		t.Fatalf("revoked session error = %v", err)
	}
}
