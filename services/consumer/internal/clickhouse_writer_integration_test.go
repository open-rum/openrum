//go:build integration

package consumerservice

import (
	"context"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"openrum/internal/event"
	"openrum/internal/migrate"
	"openrum/migrations"
)

func TestBufferedClickHouseWriterStoresCanonicalEventsIdempotently(t *testing.T) {
	dsn := safeClickHouseIntegrationDSN(t)
	database, err := migrate.OpenClickHouse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := migrate.ClickHouseUp(ctx, database, migrations.Files); err != nil {
		t.Fatal(err)
	}
	if _, err := database.ExecContext(ctx, "TRUNCATE TABLE rum_events_local"); err != nil {
		t.Fatal(err)
	}

	canonical, failures, err := event.NormalizeQueuedEnvelope(validQueuePayload(t))
	if err != nil || len(failures) != 0 || len(canonical) != 5 {
		t.Fatalf("canonical=%d failures=%+v error=%v", len(canonical), failures, err)
	}
	writer, err := OpenBufferedClickHouseWriter(ctx, dsn, ClickHouseWriterOptions{
		FlushInterval: 5 * time.Millisecond, MaxRows: 100, MaxAttempts: 3, AttemptTimeout: 5 * time.Second,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := writer.WriteEvents(ctx, canonical); err != nil {
		t.Fatal(err)
	}
	if err := writer.WriteEvents(ctx, canonical); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}

	var count uint64
	if err := database.QueryRowContext(ctx, "SELECT count() FROM rum_events WHERE project_id = ?", canonical[0].ProjectID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 5 {
		t.Fatalf("count=%d want=5 (duplicate retry must be deduplicated)", count)
	}
	var browser, device, country string
	if err := database.QueryRowContext(ctx, "SELECT browser, device_type, country FROM rum_events WHERE project_id = ? LIMIT 1", canonical[0].ProjectID).Scan(&browser, &device, &country); err != nil {
		t.Fatal(err)
	}
	if browser == "" || device == "" || country != "ZZ" {
		t.Fatalf("browser=%q device=%q country=%q", browser, device, country)
	}
}

func safeClickHouseIntegrationDSN(t *testing.T) string {
	t.Helper()
	dsn := os.Getenv("TEST_CLICKHOUSE_DSN")
	if dsn == "" {
		t.Skip("TEST_CLICKHOUSE_DSN is not set")
	}
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	databaseName := strings.TrimPrefix(parsed.Path, "/")
	if hostname := parsed.Hostname(); (hostname != "localhost" && hostname != "127.0.0.1" && hostname != "::1") || !strings.HasSuffix(databaseName, "_test") {
		t.Fatalf("refusing integration test against host=%q database=%q", hostname, databaseName)
	}
	return dsn
}
