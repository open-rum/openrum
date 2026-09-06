//go:build integration

package query

import (
	"context"
	"encoding/json"
	"math"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"openrum/internal/migrate"
	"openrum/migrations"
)

func TestAPIAndUsageAggregatesReconcileWithRawFixtures(t *testing.T) {
	database := openClickHouseIntegrationDatabase(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := migrate.ClickHouseUp(ctx, database, migrations.Files); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"rum_events_local", "api_metrics_1m_local", "usage_records_local", "usage_metrics_1h_local"} {
		if _, err := database.ExecContext(ctx, "TRUNCATE TABLE "+table); err != nil {
			t.Fatal(err)
		}
	}

	fixture := readProtocolFixture(t)
	projectID := "018f4d9c-83a1-76c9-81c2-3020ab660000"
	at := time.Date(2026, 9, 3, 6, 12, 0, 0, time.UTC)
	base := fixtureRow(t, fixture, fixture.Events[3], at)
	apiFixtures := []struct {
		status     int
		failure    string
		duration   float64
		sampleRate float64
	}{
		{status: 200, duration: 100, sampleRate: 1},
		{status: 404, duration: 200, sampleRate: 0.5},
		{status: 503, failure: "http", duration: 400, sampleRate: 1},
		{failure: "network", duration: 800, sampleRate: 0.25},
	}
	rows := make([]string, 0, len(apiFixtures))
	for _, current := range apiFixtures {
		row := cloneRow(t, base)
		row["event_id"] = uuid.NewString()
		row["api_status"] = current.status
		row["api_failure"] = current.failure
		row["duration_ms"] = current.duration
		row["sample_rate"] = current.sampleRate
		encoded, err := json.Marshal(row)
		if err != nil {
			t.Fatal(err)
		}
		rows = append(rows, string(encoded))
	}
	if _, err := database.ExecContext(ctx, "INSERT INTO rum_events SETTINGS insert_distributed_sync=1,date_time_input_format='best_effort' FORMAT JSONEachRow\n"+strings.Join(rows, "\n")); err != nil {
		t.Fatal(err)
	}

	var requests, failures, clientErrors, serverErrors, networkErrors uint64
	var estimated, p50, p75, p95 float64
	err := database.QueryRowContext(ctx, `SELECT uniqCombined64Merge(requests), sumMerge(estimated),
		coalesce(uniqCombined64Merge(failures),0), coalesce(uniqCombined64Merge(client_errors),0),
		coalesce(uniqCombined64Merge(server_errors),0), coalesce(uniqCombined64Merge(network_errors),0),
		quantileTDigestMerge(0.50)(duration_p50), quantileTDigestMerge(0.75)(duration_p75), quantileTDigestMerge(0.95)(duration_p95)
		FROM api_metrics_1m WHERE project_id=?`, projectID).Scan(&requests, &estimated, &failures, &clientErrors,
		&serverErrors, &networkErrors, &p50, &p75, &p95)
	if err != nil {
		t.Fatal(err)
	}
	if requests != 4 || !withinTwoPercent(estimated, 8) || failures != 2 || clientErrors != 1 || serverErrors != 1 || networkErrors != 1 {
		t.Fatalf("API requests=%d estimated=%v failures=%d 4xx=%d 5xx=%d network=%d", requests, estimated, failures, clientErrors, serverErrors, networkErrors)
	}
	if p50 < 100 || p75 < p50 || p95 < p75 || p95 > 800 {
		t.Fatalf("API quantiles p50=%v p75=%v p95=%v", p50, p75, p95)
	}

	usageRows := []string{
		usageRow(projectID, at, "page_view", "accepted", "", 6, 9, 600),
		usageRow(projectID, at, "api", "sampled", "client_sample", 3, 3, 0),
		usageRow(projectID, at, "error", "rejected", "invalid_event", 2, 2, 140),
		usageRow(projectID, at, "api", "failed", "storage_failed", 1, 1, 90),
	}
	if _, err := database.ExecContext(ctx, "INSERT INTO usage_records SETTINGS insert_distributed_sync=1,date_time_input_format='best_effort' FORMAT JSONEachRow\n"+strings.Join(usageRows, "\n")); err != nil {
		t.Fatal(err)
	}
	usageResult, err := NewUsageRepository(database).Get(ctx, UsageFilters{
		ProjectID: uuid.MustParse(projectID), From: at.Add(-time.Hour), To: at.Add(time.Hour),
	})
	if err != nil {
		t.Fatal(err)
	}
	if usageResult.Totals.Accepted != 6 || usageResult.Totals.Sampled != 3 || usageResult.Totals.Rejected != 2 || usageResult.Totals.Failed != 1 || usageResult.Totals.Bytes != 830 || !withinTwoPercent(usageResult.Totals.Estimated, 15) || len(usageResult.Breakdown) != 4 {
		t.Fatalf("usage API result=%+v", usageResult)
	}
	var rawEvents, aggregateEvents, rawBytes, aggregateBytes uint64
	var rawEstimated, aggregateEstimated float64
	if err := database.QueryRowContext(ctx, `SELECT sum(event_count),sum(estimated_count),sum(payload_bytes) FROM usage_records WHERE project_id=?`, projectID).Scan(&rawEvents, &rawEstimated, &rawBytes); err != nil {
		t.Fatal(err)
	}
	if err := database.QueryRowContext(ctx, `SELECT sumMerge(events),sumMerge(estimated),sumMerge(bytes) FROM usage_metrics_1h WHERE project_id=?`, projectID).Scan(&aggregateEvents, &aggregateEstimated, &aggregateBytes); err != nil {
		t.Fatal(err)
	}
	if !withinTwoPercent(float64(aggregateEvents), float64(rawEvents)) || !withinTwoPercent(aggregateEstimated, rawEstimated) || !withinTwoPercent(float64(aggregateBytes), float64(rawBytes)) {
		t.Fatalf("usage raw=%d/%v/%d aggregate=%d/%v/%d", rawEvents, rawEstimated, rawBytes, aggregateEvents, aggregateEstimated, aggregateBytes)
	}
}

func usageRow(projectID string, at time.Time, eventType, outcome, reason string, events uint64, estimated float64, bytes uint64) string {
	value := map[string]any{
		"project_id": projectID, "record_id": uuid.NewString(), "occurred_at": at.Format(time.RFC3339Nano),
		"event_type": eventType, "outcome": outcome, "reason": reason, "event_count": events,
		"estimated_count": estimated, "payload_bytes": bytes,
	}
	encoded, _ := json.Marshal(value)
	return string(encoded)
}

func withinTwoPercent(actual, expected float64) bool {
	if expected == 0 {
		return actual == 0
	}
	return math.Abs(actual-expected)/math.Abs(expected) <= 0.02
}
