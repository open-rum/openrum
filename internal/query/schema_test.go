//go:build integration

package query

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"openrum/internal/migrate"
	"openrum/migrations"
)

type protocolFixture struct {
	SchemaVersion string `json:"schema_version"`
	SDK           struct {
		Name    string `json:"name"`
		Version string `json:"version"`
	} `json:"sdk"`
	Context struct {
		Environment     string            `json:"environment"`
		Release         string            `json:"release"`
		Dist            string            `json:"dist"`
		SessionID       string            `json:"session_id"`
		PageID          string            `json:"page_id"`
		AnonymousUserID string            `json:"anonymous_user_id"`
		UserID          string            `json:"user_id"`
		Tags            map[string]string `json:"tags"`
		Page            struct {
			URL      string `json:"url"`
			Route    string `json:"route"`
			Referrer string `json:"referrer"`
			Title    string `json:"title"`
		} `json:"page"`
		Trace struct {
			TraceID string `json:"trace_id"`
			SpanID  string `json:"span_id"`
		} `json:"trace"`
	} `json:"context"`
	Events []json.RawMessage `json:"events"`
}

func TestRUMEventsSchemaStoresEveryProtocolEvent(t *testing.T) {
	database := openClickHouseIntegrationDatabase(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := migrate.ClickHouseUp(ctx, database, migrations.Files); err != nil {
		t.Fatal(err)
	}
	if _, err := database.ExecContext(ctx, "TRUNCATE TABLE rum_events_local"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = database.ExecContext(context.Background(), "TRUNCATE TABLE rum_events_local") })

	fixture := readProtocolFixture(t)
	rows := make([]string, 0, len(fixture.Events))
	for index, rawEvent := range fixture.Events {
		row := fixtureRow(t, fixture, rawEvent, time.Now().UTC().Add(time.Duration(index)*time.Millisecond))
		encoded, err := json.Marshal(row)
		if err != nil {
			t.Fatal(err)
		}
		rows = append(rows, string(encoded))
	}
	insert := "INSERT INTO rum_events SETTINGS date_time_input_format = 'best_effort' FORMAT JSONEachRow\n" + strings.Join(rows, "\n")
	if _, err := database.ExecContext(ctx, insert); err != nil {
		t.Fatalf("insert protocol fixtures: %v", err)
	}

	counts := map[string]uint64{}
	result, err := database.QueryContext(ctx, `
		SELECT event_type, count()
		FROM rum_events
		WHERE project_id = '018f4d9c-83a1-76c9-81c2-3020ab660000'
		GROUP BY event_type`)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = result.Close() }()
	for result.Next() {
		var eventType string
		var count uint64
		if err := result.Scan(&eventType, &count); err != nil {
			t.Fatal(err)
		}
		counts[eventType] = count
	}
	if err := result.Err(); err != nil {
		t.Fatal(err)
	}
	for _, eventType := range []string{"page_view", "error", "web_vital", "api", "custom"} {
		if counts[eventType] != 1 {
			t.Errorf("%s count = %d, want 1", eventType, counts[eventType])
		}
	}

	assertString(t, database, "SELECT navigation_type FROM rum_events WHERE event_type = 'page_view'", "navigate")
	assertString(t, database, "SELECT error_type FROM rum_events WHERE event_type = 'error'", "TypeError")
	assertFloat(t, database, "SELECT metric_value FROM rum_events WHERE event_type = 'web_vital'", 2134.2)
	assertUint16(t, database, "SELECT api_status FROM rum_events WHERE event_type = 'api'", 201)
	assertString(t, database, "SELECT attributes['member_level'] FROM rum_events WHERE event_type = 'custom'", "gold")

	var localEngine, localDefinition, distributedEngine string
	if err := database.QueryRowContext(ctx, `
		SELECT engine, create_table_query
		FROM system.tables
		WHERE database = currentDatabase() AND name = 'rum_events_local'`).Scan(&localEngine, &localDefinition); err != nil {
		t.Fatal(err)
	}
	if err := database.QueryRowContext(ctx, `
		SELECT engine
		FROM system.tables
		WHERE database = currentDatabase() AND name = 'rum_events'`).Scan(&distributedEngine); err != nil {
		t.Fatal(err)
	}
	if localEngine != "ReplicatedReplacingMergeTree" || distributedEngine != "Distributed" {
		t.Fatalf("engines local=%q distributed=%q", localEngine, distributedEngine)
	}
	for _, fragment := range []string{
		"PARTITION BY (toYYYYMM(timestamp), project_id)",
		"ORDER BY (project_id, event_type, timestamp, event_id)",
		"`raw_expires_at` DateTime64(3, 'UTC')",
		"`aggregate_expires_at` DateTime64(3, 'UTC')",
		"TTL raw_expires_at",
	} {
		if !strings.Contains(localDefinition, fragment) {
			t.Errorf("local schema does not contain %q: %s", fragment, localDefinition)
		}
	}
}

func TestRetentionPolicyPhysicallyExpiresRawAndPreservesConfiguredAggregates(t *testing.T) {
	database := openClickHouseIntegrationDatabase(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := migrate.ClickHouseUp(ctx, database, migrations.Files); err != nil {
		t.Fatal(err)
	}

	rawExpiredProject, aggregateExpiredProject := uuid.New(), uuid.New()
	now := time.Now().UTC().Truncate(time.Second)
	insertRetentionEvent(t, database, rawExpiredProject, now, now.Add(-time.Hour), now.Add(24*time.Hour))
	insertRetentionEvent(t, database, aggregateExpiredProject, now.Add(time.Second), now.Add(24*time.Hour), now.Add(-time.Hour))

	for _, table := range []string{"rum_events_local", "project_metrics_1m_local", "behavior_metrics_1m_local"} {
		if _, err := database.ExecContext(ctx, "ALTER TABLE "+table+" MATERIALIZE TTL SETTINGS mutations_sync=2"); err != nil {
			t.Fatalf("materialize %s TTL: %v", table, err)
		}
	}

	assertProjectCount(t, database, "rum_events_local", rawExpiredProject, 0)
	assertProjectCount(t, database, "rum_events_local", aggregateExpiredProject, 1)
	assertProjectCount(t, database, "project_metrics_1m_local", rawExpiredProject, 1)
	assertProjectCount(t, database, "project_metrics_1m_local", aggregateExpiredProject, 0)
	assertProjectCount(t, database, "behavior_metrics_1m_local", rawExpiredProject, 5)
	assertProjectCount(t, database, "behavior_metrics_1m_local", aggregateExpiredProject, 0)
}

func insertRetentionEvent(t *testing.T, database *sql.DB, projectID uuid.UUID, timestamp, rawExpiry, aggregateExpiry time.Time) {
	t.Helper()
	_, err := database.ExecContext(context.Background(), `INSERT INTO rum_events_local
		(project_id,event_id,event_type,timestamp,received_at,raw_expires_at,aggregate_expires_at,
		session_id,page_id,sample_rate,country,environment,anonymous_user_id)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		projectID, uuid.New(), "page_view", timestamp, timestamp, rawExpiry, aggregateExpiry,
		uuid.New(), uuid.New(), 1, "ZZ", "test", uuid.NewString())
	if err != nil {
		t.Fatalf("insert retention fixture: %v", err)
	}
}

func assertProjectCount(t *testing.T, database *sql.DB, table string, projectID uuid.UUID, want uint64) {
	t.Helper()
	var count uint64
	if err := database.QueryRowContext(context.Background(),
		"SELECT count() FROM "+table+" WHERE project_id = ?", projectID,
	).Scan(&count); err != nil {
		t.Fatalf("count %s project %s: %v", table, projectID, err)
	}
	if count != want {
		t.Fatalf("%s project %s count=%d want=%d", table, projectID, count, want)
	}
}

func openClickHouseIntegrationDatabase(t *testing.T) *sql.DB {
	t.Helper()
	dsn := os.Getenv("TEST_CLICKHOUSE_DSN")
	if dsn == "" {
		t.Skip("TEST_CLICKHOUSE_DSN is not set")
	}
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatalf("parse TEST_CLICKHOUSE_DSN: %v", err)
	}
	databaseName := strings.TrimPrefix(parsed.Path, "/")
	if hostname := parsed.Hostname(); (hostname != "localhost" && hostname != "127.0.0.1" && hostname != "::1") ||
		!strings.HasSuffix(databaseName, "_test") || strings.Contains(databaseName, "/") {
		t.Fatalf("refusing integration test against host=%q database=%q", hostname, databaseName)
	}
	database, err := migrate.OpenClickHouse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	return database
}

func readProtocolFixture(t *testing.T) protocolFixture {
	t.Helper()
	contents, err := os.ReadFile(filepath.Join("..", "..", "packages", "protocol", "fixtures", "valid-all-events.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fixture protocolFixture
	if err := json.Unmarshal(contents, &fixture); err != nil {
		t.Fatal(err)
	}
	return fixture
}

func fixtureRow(t *testing.T, fixture protocolFixture, raw json.RawMessage, timestamp time.Time) map[string]any {
	t.Helper()
	var event map[string]any
	if err := json.Unmarshal(raw, &event); err != nil {
		t.Fatal(err)
	}
	eventType, _ := event["type"].(string)
	row := map[string]any{
		"project_id": "018f4d9c-83a1-76c9-81c2-3020ab660000", "event_id": event["event_id"],
		"event_type": eventType, "timestamp": timestamp.Format(time.RFC3339Nano), "received_at": timestamp.Format(time.RFC3339Nano),
		"environment": fixture.Context.Environment, "release": fixture.Context.Release, "dist": fixture.Context.Dist,
		"session_id": fixture.Context.SessionID, "anonymous_user_id": fixture.Context.AnonymousUserID,
		"user_id": fixture.Context.UserID, "page_id": fixture.Context.PageID, "page_url": fixture.Context.Page.URL,
		"page_url_normalized": normalizeFixtureURL(fixture.Context.Page.URL), "route": fixture.Context.Page.Route,
		"referrer": fixture.Context.Page.Referrer, "title": fixture.Context.Page.Title, "sdk_name": fixture.SDK.Name,
		"sdk_version": fixture.SDK.Version, "schema_version": fixture.SchemaVersion, "sample_rate": 1,
		"country": "ZZ", "trace_id": fixture.Context.Trace.TraceID, "span_id": fixture.Context.Trace.SpanID,
		"attributes": fixture.Context.Tags,
	}
	if sampleRate, ok := event["sample_rate"]; ok {
		row["sample_rate"] = sampleRate
	}
	switch eventType {
	case "page_view":
		row["navigation_type"] = event["navigation_type"]
	case "error":
		errorValue := event["error"].(map[string]any)
		row["error_type"] = errorValue["name"]
		row["error_message"] = errorValue["message"]
		row["handled"] = errorValue["handled"]
		row["breadcrumbs"] = encodeBreadcrumbs(t, event["breadcrumbs"])
		copyPresent(row, "error_stack", errorValue, "stack")
		copyPresent(row, "error_mechanism", errorValue, "mechanism")
	case "web_vital":
		metric := event["metric"].(map[string]any)
		row["metric_name"] = metric["name"]
		row["metric_value"] = metric["value"]
		row["metric_rating"] = metric["rating"]
		copyPresent(row, "metric_delta", metric, "delta")
	case "api":
		request := event["request"].(map[string]any)
		row["api_method"] = request["method"]
		row["api_url_normalized"] = normalizeFixtureURL(fmt.Sprint(request["url"]))
		row["api_status"] = request["status"]
		row["duration_ms"] = request["duration_ms"]
		copyPresent(row, "api_failure", request, "failure")
		copyPresent(row, "transfer_size", request, "transfer_size")
	case "custom":
		row["custom_name"] = event["name"]
		row["attributes"] = event["attributes"]
		row["measurements"] = event["measurements"]
	default:
		t.Fatalf("unexpected fixture event type %q", eventType)
	}
	return row
}

func copyPresent(destination map[string]any, destinationKey string, source map[string]any, sourceKey string) {
	if value, ok := source[sourceKey]; ok {
		destination[destinationKey] = value
	}
}

func normalizeFixtureURL(raw string) string {
	parsed, err := url.Parse(raw)
	if err != nil {
		return raw
	}
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String()
}

func encodeBreadcrumbs(t *testing.T, value any) []string {
	t.Helper()
	items, _ := value.([]any)
	encoded := make([]string, 0, len(items))
	for _, item := range items {
		contents, err := json.Marshal(item)
		if err != nil {
			t.Fatal(err)
		}
		encoded = append(encoded, string(contents))
	}
	return encoded
}

func assertString(t *testing.T, database *sql.DB, query, want string) {
	t.Helper()
	var got string
	if err := database.QueryRow(query).Scan(&got); err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Errorf("query %q = %q, want %q", query, got, want)
	}
}

func assertFloat(t *testing.T, database *sql.DB, query string, want float64) {
	t.Helper()
	var got float64
	if err := database.QueryRow(query).Scan(&got); err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Errorf("query %q = %v, want %v", query, got, want)
	}
}

func assertUint16(t *testing.T, database *sql.DB, query string, want uint16) {
	t.Helper()
	var got uint16
	if err := database.QueryRow(query).Scan(&got); err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Errorf("query %q = %d, want %d", query, got, want)
	}
}
