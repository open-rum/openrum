package auth

import (
	"context"
	"database/sql"
	"errors"
	"net/url"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestBootstrapTokenMatchesConstantLengthDigests(t *testing.T) {
	if !bootstrapTokenMatches("", "anything") {
		t.Fatal("an unconfigured token should allow bootstrap")
	}
	if !bootstrapTokenMatches("correct-token", "correct-token") {
		t.Fatal("matching token was rejected")
	}
	if bootstrapTokenMatches("correct-token", "wrong") {
		t.Fatal("mismatched token was accepted")
	}
}

func TestValidateBootstrapInput(t *testing.T) {
	input, err := validateBootstrapInput(BootstrapInput{
		Email:            " OWNER@Example.COM ",
		DisplayName:      " Owner ",
		Password:         "twelve-chars!",
		OrganizationName: " Example Team ",
	})
	if err != nil {
		t.Fatal(err)
	}
	if input.Email != "owner@example.com" || input.DisplayName != "Owner" {
		t.Fatalf("normalized input = %+v", input)
	}
	_, err = validateBootstrapInput(BootstrapInput{
		Email: "owner@example.com", DisplayName: "Owner", Password: "too-short", OrganizationName: "Example",
	})
	var validationError *ValidationError
	if !errors.As(err, &validationError) || validationError.Field != "password" {
		t.Fatalf("validation error = %v", err)
	}
}

func TestSlugifyHasSafeFallback(t *testing.T) {
	if got := slugify("Frontend Platform"); got != "frontend-platform" {
		t.Fatalf("slug = %q", got)
	}
	if got := slugify("前端平台"); got != "organization" {
		t.Fatalf("fallback slug = %q", got)
	}
}

func TestConcurrentBootstrapCreatesExactlyOneOwner(t *testing.T) {
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

	bootstrapper := NewBootstrapper(database, "setup-secret")
	bootstrapper.hashPassword = func(string) (string, error) { return "argon2id-test-hash", nil }
	input := BootstrapInput{
		Email:            "owner@example.com",
		DisplayName:      "Owner",
		Password:         "a-production-password",
		OrganizationName: "Frontend Platform",
	}

	const requests = 20
	start := make(chan struct{})
	var successes atomic.Int32
	var alreadyInitialized atomic.Int32
	var unexpected atomic.Int32
	var waitGroup sync.WaitGroup
	waitGroup.Add(requests)
	for range requests {
		go func() {
			defer waitGroup.Done()
			<-start
			_, credentials, bootstrapErr := bootstrapper.BootstrapWithSession(ctx, input, "setup-secret", "127.0.0.1", "bootstrap-test")
			switch {
			case bootstrapErr == nil:
				if credentials.Token == "" || credentials.CSRFToken == "" {
					unexpected.Add(1)
					return
				}
				successes.Add(1)
			case errors.Is(bootstrapErr, ErrAlreadyInitialized):
				alreadyInitialized.Add(1)
			default:
				unexpected.Add(1)
			}
		}()
	}
	close(start)
	waitGroup.Wait()

	if successes.Load() != 1 || alreadyInitialized.Load() != requests-1 || unexpected.Load() != 0 {
		t.Fatalf("success=%d already=%d unexpected=%d", successes.Load(), alreadyInitialized.Load(), unexpected.Load())
	}
	for table, want := range map[string]int{"users": 1, "organizations": 1, "organization_members": 1, "instance_members": 1, "audit_logs": 1, "sessions": 1} {
		var count int
		if err := database.QueryRowContext(ctx, "SELECT count(*) FROM "+table).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count != want {
			t.Fatalf("%s count = %d, want %d", table, count, want)
		}
	}
}

func assertSafeTestDatabase(t *testing.T, dsn string) {
	t.Helper()
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Hostname() != "127.0.0.1" && parsed.Hostname() != "localhost" {
		t.Fatalf("refusing destructive test against host %q", parsed.Hostname())
	}
	if !strings.HasSuffix(strings.Trim(parsed.Path, "/"), "_test") {
		t.Fatalf("refusing destructive test against database %q; name must end in _test", parsed.Path)
	}
}
