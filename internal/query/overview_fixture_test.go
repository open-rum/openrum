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

func TestOverviewMaterializedViewsMatchRawFixture(t *testing.T) {
	database := openClickHouseIntegrationDatabase(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := migrate.ClickHouseUp(ctx, database, migrations.Files); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"rum_events_local", "project_metrics_1m_local", "api_metrics_1m_local"} {
		if _, err := database.ExecContext(ctx, "TRUNCATE TABLE "+table); err != nil {
			t.Fatal(err)
		}
	}

	fixture := readProtocolFixture(t)
	projectID := "018f4d9c-83a1-76c9-81c2-3020ab660000"
	timestamp := time.Date(2026, 9, 2, 10, 12, 30, 0, time.UTC)
	rows := make([]map[string]any, 0, 10)
	for _, rawEvent := range fixture.Events {
		rows = append(rows, fixtureRow(t, fixture, rawEvent, timestamp))
	}
	page := cloneRow(t, rows[0])
	page["event_id"] = uuid.NewString()
	page["sample_rate"] = 0.5
	rows = append(rows, page)
	errorRow := cloneRow(t, rows[1])
	errorRow["event_id"] = uuid.NewString()
	errorRow["sample_rate"] = 0.5
	rows = append(rows, errorRow)
	api := cloneRow(t, rows[3])
	api["event_id"] = uuid.NewString()
	api["sample_rate"] = 1.0
	api["api_status"] = 503
	api["api_failure"] = "http"
	api["duration_ms"] = 400.0
	rows = append(rows, api)
	rows = append(rows,
		metricRow(t, rows[2], "INP", 200, uuid.NewString()),
		metricRow(t, rows[2], "CLS", 0.15, uuid.NewString()),
	)
	syntheticPage := cloneRow(t, rows[0])
	syntheticPage["event_id"] = uuid.NewString()
	syntheticPage["ingest_flags"] = []string{"synthetic"}
	syntheticAPI := cloneRow(t, rows[3])
	syntheticAPI["event_id"] = uuid.NewString()
	syntheticAPI["ingest_flags"] = []string{"synthetic"}
	rows = append(rows, syntheticPage, syntheticAPI)

	encoded := make([]string, 0, len(rows))
	for _, row := range rows {
		contents, err := json.Marshal(row)
		if err != nil {
			t.Fatal(err)
		}
		encoded = append(encoded, string(contents))
	}
	insert := "INSERT INTO rum_events SETTINGS insert_distributed_sync=1,date_time_input_format='best_effort' FORMAT JSONEachRow\n" + strings.Join(encoded, "\n")
	if _, err := database.ExecContext(ctx, insert); err != nil {
		t.Fatal(err)
	}
	var rawCount, syntheticCount uint64
	if err := database.QueryRowContext(ctx,
		"SELECT count(), countIf(has(ingest_flags, 'synthetic')) FROM rum_events WHERE project_id = ?", projectID,
	).Scan(&rawCount, &syntheticCount); err != nil {
		t.Fatal(err)
	}
	if rawCount != uint64(len(rows)) || syntheticCount != 2 {
		t.Fatalf("raw=%d/%d synthetic=%d/2", rawCount, len(rows), syntheticCount)
	}

	var pageViews, users, sessions, errorsCount, apiRequests, apiFailures, lcpSamples, inpSamples, clsSamples uint64
	var pageEstimated, errorEstimated, apiEstimated, lcp, inp, cls float64
	err := database.QueryRowContext(ctx, `
		SELECT
			uniqCombined64Merge(page_view_events), sumMerge(page_view_estimated),
			uniqCombined64Merge(unique_users), uniqCombined64Merge(unique_sessions),
			uniqCombined64Merge(error_events), sumMerge(error_estimated),
			uniqCombined64Merge(api_requests), sumMerge(api_estimated), uniqCombined64Merge(api_failures),
			quantileTDigestMerge(0.75)(lcp_p75), uniqCombined64Merge(lcp_samples),
			quantileTDigestMerge(0.75)(inp_p75), uniqCombined64Merge(inp_samples),
			quantileTDigestMerge(0.75)(cls_p75), uniqCombined64Merge(cls_samples)
		FROM project_metrics_1m
		WHERE project_id = ? AND bucket >= ? AND bucket < ?`,
		projectID, timestamp.Truncate(time.Minute), timestamp.Truncate(time.Minute).Add(time.Minute),
	).Scan(&pageViews, &pageEstimated, &users, &sessions, &errorsCount, &errorEstimated,
		&apiRequests, &apiEstimated, &apiFailures, &lcp, &lcpSamples, &inp, &inpSamples, &cls, &clsSamples)
	if err != nil {
		t.Fatal(err)
	}
	if pageViews != 2 || users != 1 || sessions != 1 || errorsCount != 2 || apiRequests != 2 || apiFailures != 1 {
		t.Fatalf("views=%d users=%d sessions=%d errors=%d APIs=%d failures=%d", pageViews, users, sessions, errorsCount, apiRequests, apiFailures)
	}
	if !near(pageEstimated, 3) || !near(errorEstimated, 3) || !near(apiEstimated, 6) {
		t.Fatalf("estimated page=%v error=%v API=%v", pageEstimated, errorEstimated, apiEstimated)
	}
	if lcpSamples != 1 || inpSamples != 1 || clsSamples != 1 || !near(lcp, 2134.2) || !near(inp, 200) || !near(cls, 0.15) {
		t.Fatalf("vitals LCP=%v/%d INP=%v/%d CLS=%v/%d", lcp, lcpSamples, inp, inpSamples, cls, clsSamples)
	}

	var requests, failures, clientErrors, serverErrors, networkErrors uint64
	var estimated, p50, p75, p95 float64
	if err := database.QueryRowContext(ctx, `
		SELECT uniqCombined64Merge(requests), sumMerge(estimated), coalesce(uniqCombined64Merge(failures), 0),
			coalesce(uniqCombined64Merge(client_errors), 0), coalesce(uniqCombined64Merge(server_errors), 0), coalesce(uniqCombined64Merge(network_errors), 0),
			quantileTDigestMerge(0.50)(duration_p50), quantileTDigestMerge(0.75)(duration_p75), quantileTDigestMerge(0.95)(duration_p95)
		FROM api_metrics_1m WHERE project_id = ?`, projectID,
	).Scan(&requests, &estimated, &failures, &clientErrors, &serverErrors, &networkErrors, &p50, &p75, &p95); err != nil {
		t.Fatal(err)
	}
	if requests != 2 || !near(estimated, 6) || failures != 1 || clientErrors != 0 || serverErrors != 1 || networkErrors != 0 {
		t.Fatalf("API requests=%d estimated=%v failures=%d 4xx=%d 5xx=%d network=%d", requests, estimated, failures, clientErrors, serverErrors, networkErrors)
	}
	if p50 < 182.4 || p75 < p50 || p95 < p75 || p95 > 400 {
		t.Fatalf("API percentiles p50=%v p75=%v p95=%v", p50, p75, p95)
	}
}

func cloneRow(t *testing.T, source map[string]any) map[string]any {
	t.Helper()
	encoded, err := json.Marshal(source)
	if err != nil {
		t.Fatal(err)
	}
	var result map[string]any
	if err := json.Unmarshal(encoded, &result); err != nil {
		t.Fatal(err)
	}
	return result
}

func metricRow(t *testing.T, source map[string]any, name string, value float64, eventID string) map[string]any {
	t.Helper()
	result := cloneRow(t, source)
	result["event_id"] = eventID
	result["metric_name"] = name
	result["metric_value"] = value
	return result
}

func near(left, right float64) bool { return math.Abs(left-right) < 0.0001 }
