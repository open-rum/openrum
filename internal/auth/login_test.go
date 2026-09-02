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
	"github.com/redis/go-redis/v9"
)

func TestPasswordHashAndVerify(t *testing.T) {
	hash, err := HashPassword("a-secure-password")
	if err != nil {
		t.Fatal(err)
	}
	valid, err := VerifyPassword("a-secure-password", hash)
	if err != nil || !valid {
		t.Fatalf("valid=%v err=%v", valid, err)
	}
	valid, err = VerifyPassword("wrong-password", hash)
	if err != nil || valid {
		t.Fatalf("valid=%v err=%v", valid, err)
	}
	if _, err := HashPassword("short"); err == nil {
		t.Fatal("short password was accepted")
	}
}

func TestMemoryFailureLimiterExpiresAndResetsAccount(t *testing.T) {
	now := time.Date(2026, 9, 2, 10, 0, 0, 0, time.UTC)
	limiter := newMemoryFailureLimiter(2, 3, time.Minute)
	limiter.now = func() time.Time { return now }
	ctx := context.Background()
	limiter.Failed(ctx, "127.0.0.1", "owner@example.com")
	limiter.Failed(ctx, "127.0.0.1", "owner@example.com")
	if limiter.Allow(ctx, "127.0.0.1", "owner@example.com") {
		t.Fatal("account should be limited")
	}
	limiter.Succeeded(ctx, "owner@example.com")
	if !limiter.Allow(ctx, "127.0.0.1", "owner@example.com") {
		t.Fatal("successful login should clear account failures")
	}
	now = now.Add(2 * time.Minute)
	if !limiter.Allow(ctx, "127.0.0.1", "another@example.com") {
		t.Fatal("IP failures should expire")
	}
}

func TestRedisLimiterUsesConservativeFallback(t *testing.T) {
	client := redis.NewClient(&redis.Options{
		Addr:         "127.0.0.1:1",
		DialTimeout:  10 * time.Millisecond,
		ReadTimeout:  10 * time.Millisecond,
		WriteTimeout: 10 * time.Millisecond,
		MaxRetries:   -1,
	})
	defer func() { _ = client.Close() }()
	limiter := NewRedisFailureLimiter(client)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	for range 3 {
		limiter.Failed(ctx, "192.0.2.1", "fallback@example.com")
	}
	if limiter.Allow(ctx, "192.0.2.1", "fallback@example.com") {
		t.Fatal("fallback should apply its conservative account limit")
	}
}

func TestRedisFailureLimiterAccountLimit(t *testing.T) {
	address := os.Getenv("TEST_REDIS_ADDR")
	if address == "" {
		t.Skip("TEST_REDIS_ADDR is not set")
	}
	client := redis.NewClient(&redis.Options{Addr: address, DB: 15})
	defer func() { _ = client.Close() }()
	limiter := NewRedisFailureLimiter(client)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	account := "rate-" + uuid.NewString() + "@example.com"
	ipAddress := "198.51.100." + time.Now().Format("05")
	accountKey, ipKey := loginLimitKeys(ipAddress, account)
	defer func() { _ = client.Del(context.WithoutCancel(ctx), accountKey, ipKey).Err() }()
	for range accountFailureLimit {
		if !limiter.Allow(ctx, ipAddress, account) {
			t.Fatal("request was limited too early")
		}
		limiter.Failed(ctx, ipAddress, account)
	}
	if limiter.Allow(ctx, ipAddress, account) {
		t.Fatal("Redis account limit was not enforced")
	}
}

func TestLoginManagerValidInvalidAndRateLimited(t *testing.T) {
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

	passwordHash, err := HashPassword("a-secure-password")
	if err != nil {
		t.Fatal(err)
	}
	userID := uuid.New()
	if _, err := database.ExecContext(ctx,
		"INSERT INTO users (id, email, display_name, password_hash) VALUES ($1, $2, $3, $4)",
		userID, "owner@example.com", "Owner", passwordHash); err != nil {
		t.Fatal(err)
	}
	limiter := newMemoryFailureLimiter(2, 10, time.Minute)
	manager, err := NewLoginManager(database, limiter)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Authenticate(ctx, "owner@example.com", "wrong-password", "127.0.0.1"); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("invalid login error = %v", err)
	}
	user, err := manager.Authenticate(ctx, " OWNER@example.com ", "a-secure-password", "127.0.0.1")
	if err != nil || user.ID != userID {
		t.Fatalf("user=%+v err=%v", user, err)
	}
	for range 2 {
		_, _ = manager.Authenticate(ctx, "missing@example.com", "wrong-password", "127.0.0.2")
	}
	if _, err := manager.Authenticate(ctx, "missing@example.com", "wrong-password", "127.0.0.2"); !errors.Is(err, ErrLoginRateLimited) {
		t.Fatalf("rate-limit error = %v", err)
	}
}
