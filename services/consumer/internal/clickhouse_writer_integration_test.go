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

func TestBufferedClickHouseWriterStoresAPIHeaderSnapshots(t *testing.T) {
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

	canonical, failures, err := event.NormalizeQueuedEnvelope(queuePayloadFrom(t, "valid-api-headers.json"))
	if err != nil || len(failures) != 0 {
		t.Fatalf("failures=%+v error=%v", failures, err)
	}
	// What the consumer would keep after applying a project's rule.
	for index := range canonical {
		if canonical[index].EventType == event.EventTypeAPI {
			canonical[index].APIRequestHeaders = nil
			canonical[index].APIResponseHeaders = map[string]string{"etag": `"abc"`}
			canonical[index].APIRequestBody = `{"items":[{"sku":"A-1"}]}`
			canonical[index].APIResponseBody = ""
		}
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
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}

	var request, response map[string]string
	var requestBody, responseBody string
	if err := database.QueryRowContext(ctx, `SELECT api_request_headers, api_response_headers, api_request_body, api_response_body FROM rum_events
		WHERE project_id = ? AND event_type = 'api'`, canonical[0].ProjectID).Scan(&request, &response, &requestBody, &responseBody); err != nil {
		t.Fatal(err)
	}
	if len(request) != 0 || response["etag"] != `"abc"` {
		t.Fatalf("request=%v response=%v", request, response)
	}
	if requestBody != `{"items":[{"sku":"A-1"}]}` || responseBody != "" {
		t.Fatalf("bodies = %q / %q", requestBody, responseBody)
	}
	var others uint64
	if err := database.QueryRowContext(ctx, `SELECT count() FROM rum_events
		WHERE project_id = ? AND event_type != 'api' AND (length(api_request_headers) > 0 OR length(api_response_headers) > 0)`,
		canonical[0].ProjectID).Scan(&others); err != nil || others != 0 {
		t.Fatalf("headers on non-API rows=%d err=%v", others, err)
	}
	var definition string
	if err := database.QueryRowContext(ctx, "SELECT create_table_query FROM system.tables WHERE database = currentDatabase() AND name = 'rum_events_local'").Scan(&definition); err != nil {
		t.Fatal(err)
	}
	for column, kind := range map[string]string{
		"api_request_headers": "Map(String, String)", "api_response_headers": "Map(String, String)",
		"api_request_body": "String", "api_response_body": "String",
	} {
		if !strings.Contains(definition, "`"+column+"` "+kind+" CODEC(ZSTD(3)) TTL timestamp + toIntervalDay(3)") {
			t.Fatalf("%s must expire three days after the request; table definition:\n%s", column, definition)
		}
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
