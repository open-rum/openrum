//go:build integration

package auth

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestApprovedExternalAccountSetsIndependentPasswordAfterFreshLogin(t *testing.T) {
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
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	userID := uuid.New()
	email := "external-" + userID.String() + "@example.test"
	if _, err := database.ExecContext(ctx, "INSERT INTO users(id,email,display_name,auth_source,access_status) VALUES($1,$2,'External','oidc','approved')", userID, email); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = database.ExecContext(context.Background(), "DELETE FROM users WHERE id=$1", userID) })
	sessions := NewSessionManager(database)
	old, err := sessions.Create(ctx, userID, "127.0.0.1", "test")
	if err != nil {
		t.Fatal(err)
	}
	oldPrincipal, err := sessions.Authenticate(ctx, old.Token)
	if err != nil || oldPrincipal.HasPassword {
		t.Fatalf("old principal=%+v err=%v", oldPrincipal, err)
	}
	if _, err := database.ExecContext(ctx, "UPDATE sessions SET created_at=now()-interval '6 minutes' WHERE id=$1", oldPrincipal.SessionID); err != nil {
		t.Fatal(err)
	}
	if err := sessions.SetInitialPassword(ctx, oldPrincipal, "a-secure-new-password"); !errors.Is(err, ErrReauthenticationRequired) {
		t.Fatalf("stale session enrolled password: %v", err)
	}
	fresh, err := sessions.Create(ctx, userID, "127.0.0.1", "test")
	if err != nil {
		t.Fatal(err)
	}
	freshPrincipal, err := sessions.Authenticate(ctx, fresh.Token)
	if err != nil {
		t.Fatal(err)
	}
	if err := sessions.SetInitialPassword(ctx, freshPrincipal, "a-secure-new-password"); err != nil {
		t.Fatal(err)
	}
	if _, err := sessions.Authenticate(ctx, old.Token); !errors.Is(err, ErrUnauthenticated) {
		t.Fatalf("other session survived password enrollment: %v", err)
	}
	login, err := NewLoginManager(database, newMemoryFailureLimiter(3, 10, time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	user, err := login.Authenticate(ctx, email, "a-secure-new-password", "127.0.0.1")
	if err != nil || user.ID != userID {
		t.Fatalf("OpenRUM password login user=%+v err=%v", user, err)
	}
}
