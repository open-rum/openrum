//go:build integration

package metadata

import (
	"database/sql"
	"net/url"
	"os"
	"strings"
	"testing"

	_ "github.com/jackc/pgx/v5/stdlib"
)

func openIntegrationDatabase(t *testing.T) *sql.DB {
	t.Helper()
	dsn := os.Getenv("TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("TEST_POSTGRES_DSN is not set")
	}
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatalf("parse TEST_POSTGRES_DSN: %v", err)
	}
	hostname := parsed.Hostname()
	databaseName := strings.TrimPrefix(parsed.Path, "/")
	if (hostname != "localhost" && hostname != "127.0.0.1" && hostname != "::1") ||
		!strings.HasSuffix(databaseName, "_test") || strings.Contains(databaseName, "/") {
		t.Fatalf("refusing to run destructive integration tests against host=%q database=%q", hostname, databaseName)
	}
	database, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatalf("open integration database: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })
	return database
}
