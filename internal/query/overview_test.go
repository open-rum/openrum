//go:build integration

package query

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"openrum/internal/migrate"
	"openrum/migrations"
)

func TestOverviewRepositoryReturnsFilteredKPIsComparisonSeriesAndFreshness(t *testing.T) {
	database := openClickHouseIntegrationDatabase(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := migrate.ClickHouseUp(ctx, database, migrations.Files); err != nil {
		t.Fatal(err)
	}
	truncateOverviewTables(t, ctx, database)

	fixture := readProtocolFixture(t)
	projectID := uuid.MustParse("018f4d9c-83a1-76c9-81c2-3020ab660000")
	currentFrom := time.Date(2026, 9, 2, 10, 0, 0, 0, time.UTC)
	currentTo := currentFrom.Add(time.Hour)
	previousAt := currentFrom.Add(-30 * time.Minute)
	currentAt := currentFrom.Add(15 * time.Minute)

	previousPage := fixtureRow(t, fixture, fixture.Events[0], previousAt)
	previousPage["event_id"] = uuid.NewString()
	previousPage["received_at"] = previousAt.Add(time.Second).Format(time.RFC3339Nano)
	previousAPI := fixtureRow(t, fixture, fixture.Events[3], previousAt)
	previousAPI["event_id"] = uuid.NewString()
	previousAPI["sample_rate"] = 1.0
	previousAPI["received_at"] = previousAt.Add(time.Second).Format(time.RFC3339Nano)
	previousLCP := metricRow(t, fixtureRow(t, fixture, fixture.Events[2], previousAt), "LCP", 1000, uuid.NewString())
	previousINP := metricRow(t, fixtureRow(t, fixture, fixture.Events[2], previousAt), "INP", 100, uuid.NewString())
	previousCLS := metricRow(t, fixtureRow(t, fixture, fixture.Events[2], previousAt), "CLS", 0.1, uuid.NewString())

	currentPage := fixtureRow(t, fixture, fixture.Events[0], currentAt)
	currentPage["event_id"] = uuid.NewString()
	currentPage["received_at"] = currentTo.Add(-10 * time.Second).Format(time.RFC3339Nano)
	secondPage := cloneRow(t, currentPage)
	secondPage["event_id"] = uuid.NewString()
	secondPage["sample_rate"] = 0.5
	secondPage["anonymous_user_id"] = "anon_second"
	secondPage["session_id"] = uuid.NewString()
	currentError := fixtureRow(t, fixture, fixture.Events[1], currentAt)
	currentError["event_id"] = uuid.NewString()
	currentError["fingerprint"] = "v1:overview-checkout"
	currentError["fingerprint_version"] = 1
	currentError["error_message"] = "Cannot submit checkout"
	currentError["received_at"] = currentTo.Add(-10 * time.Second).Format(time.RFC3339Nano)
	currentAPI := fixtureRow(t, fixture, fixture.Events[3], currentAt)
	currentAPI["event_id"] = uuid.NewString()
	currentAPI["sample_rate"] = 1.0
	currentAPI["received_at"] = currentTo.Add(-10 * time.Second).Format(time.RFC3339Nano)
	slowAPI := cloneRow(t, currentAPI)
	slowAPI["event_id"] = uuid.NewString()
	slowAPI["api_url_normalized"] = "https://shop.example.com/api/slow"
	slowAPI["api_status"] = 503
	slowAPI["api_failure"] = "http"
	slowAPI["duration_ms"] = 400.0
	currentLCP := metricRow(t, fixtureRow(t, fixture, fixture.Events[2], currentAt), "LCP", 2000, uuid.NewString())
	currentINP := metricRow(t, fixtureRow(t, fixture, fixture.Events[2], currentAt), "INP", 200, uuid.NewString())
	currentCLS := metricRow(t, fixtureRow(t, fixture, fixture.Events[2], currentAt), "CLS", 0.2, uuid.NewString())
	for _, row := range []map[string]any{currentLCP, currentINP, currentCLS} {
		row["received_at"] = currentTo.Add(-10 * time.Second).Format(time.RFC3339Nano)
	}

	insertOverviewRows(t, ctx, database, []map[string]any{
		previousPage, previousAPI, previousLCP, previousINP, previousCLS,
		currentPage, secondPage, currentError, currentAPI, slowAPI, currentLCP, currentINP, currentCLS,
	})

	repository := NewOverviewRepository(database)
	repository.now = func() time.Time { return currentTo }
	shanghai := time.FixedZone("Asia/Shanghai", 8*60*60)
	result, err := repository.Get(ctx, OverviewFilters{
		ProjectID: projectID,
		From:      currentFrom.In(shanghai), To: currentTo.In(shanghai),
		Environment: "production", Release: "2.18.0", Route: "/checkout",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !result.From.Equal(currentFrom) || result.From.Location() != time.UTC || result.IntervalSeconds != 60 {
		t.Fatalf("range=%s..%s interval=%d", result.From, result.To, result.IntervalSeconds)
	}
	if !near(result.KPIs.PageViews.Value, 3) || result.KPIs.PageViews.Samples != 2 ||
		result.KPIs.UniqueUsers.Value != 2 || !result.KPIs.UniqueUsers.Approximate {
		t.Fatalf("traffic KPIs=%+v %+v", result.KPIs.PageViews, result.KPIs.UniqueUsers)
	}
	assertRate(t, "error", result.KPIs.ErrorRate, 1.0/3.0, 1, 2)
	assertRate(t, "API failure", result.KPIs.APIFailureRate, 0.5, 1, 2)
	assertVital(t, "LCP", result.KPIs.LCP, 2000, 1)
	assertVital(t, "INP", result.KPIs.INP, 200, 1)
	assertVital(t, "CLS", result.KPIs.CLS, 0.2, 1)
	if !near(result.Comparison.Previous.PageViews.Value, 1) || result.Comparison.Previous.UniqueUsers.Value != 1 ||
		result.Comparison.Changes.PageViewsPercent == nil || !near(*result.Comparison.Changes.PageViewsPercent, 200) ||
		result.Comparison.Changes.ErrorRatePoints == nil || !near(*result.Comparison.Changes.ErrorRatePoints, 100.0/3.0) ||
		result.Comparison.Changes.APIFailureRatePoints == nil || !near(*result.Comparison.Changes.APIFailureRatePoints, 50) {
		t.Fatalf("comparison=%+v", result.Comparison)
	}
	if len(result.Series) != 1 || !result.Series[0].Bucket.Equal(currentAt.Truncate(time.Minute)) {
		t.Fatalf("series=%+v", result.Series)
	}
	if len(result.TopIssues) != 1 || result.TopIssues[0].Events != 1 || result.TopIssues[0].Users != 1 ||
		result.TopIssues[0].LastSeenAt == nil || !result.TopIssues[0].LastSeenAt.Equal(currentAt) {
		t.Fatalf("issues=%+v", result.TopIssues)
	}
	if result.Freshness.LatestReceivedAt == nil || !result.Freshness.LatestReceivedAt.Equal(currentTo.Add(-10*time.Second)) ||
		result.Freshness.AgeSeconds == nil || !near(*result.Freshness.AgeSeconds, 10) || result.Freshness.Stale {
		t.Fatalf("freshness=%+v", result.Freshness)
	}
}

func TestOverviewRepositoryReturnsExplicitEmptyState(t *testing.T) {
	database := openClickHouseIntegrationDatabase(t)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if err := migrate.ClickHouseUp(ctx, database, migrations.Files); err != nil {
		t.Fatal(err)
	}
	from := time.Date(2026, 9, 2, 10, 0, 0, 0, time.UTC)
	result, err := NewOverviewRepository(database).Get(ctx, OverviewFilters{ProjectID: uuid.New(), From: from, To: from.Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	if result.KPIs.PageViews.Value != 0 || result.KPIs.PageViews.Samples != 0 || result.KPIs.ErrorRate.Value != nil ||
		result.KPIs.APIFailureRate.Value != nil || result.KPIs.LCP.P75 != nil || result.KPIs.LCP.Sufficient ||
		result.Series == nil || len(result.Series) != 0 ||
		result.Freshness.LatestReceivedAt != nil || result.Freshness.AgeSeconds != nil {
		t.Fatalf("empty result=%+v", result)
	}
}

func TestOverviewRepositoryUsesHalfOpenUTCWindow(t *testing.T) {
	database := openClickHouseIntegrationDatabase(t)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if err := migrate.ClickHouseUp(ctx, database, migrations.Files); err != nil {
		t.Fatal(err)
	}
	truncateOverviewTables(t, ctx, database)
	fixture := readProtocolFixture(t)
	projectID := uuid.MustParse("018f4d9c-83a1-76c9-81c2-3020ab660000")
	from := time.Date(2026, 9, 2, 10, 0, 0, 0, time.UTC)
	times := []time.Time{from.Add(-time.Millisecond), from, from.Add(time.Hour - time.Millisecond), from.Add(time.Hour)}
	rows := make([]map[string]any, 0, len(times))
	for _, at := range times {
		row := fixtureRow(t, fixture, fixture.Events[0], at)
		row["event_id"] = uuid.NewString()
		rows = append(rows, row)
	}
	insertOverviewRows(t, ctx, database, rows)
	shanghai := time.FixedZone("Asia/Shanghai", 8*60*60)
	result, err := NewOverviewRepository(database).Get(ctx, OverviewFilters{
		ProjectID: projectID, From: from.In(shanghai), To: from.Add(time.Hour).In(shanghai),
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.KPIs.PageViews.Samples != 2 || !near(result.KPIs.PageViews.Value, 2) ||
		result.Comparison.Previous.PageViews.Samples != 1 {
		t.Fatalf("half-open current=%+v previous=%+v", result.KPIs.PageViews, result.Comparison.Previous.PageViews)
	}
}

func truncateOverviewTables(t *testing.T, ctx context.Context, database interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}) {
	t.Helper()
	for _, table := range []string{"rum_events_local", "project_metrics_1m_local", "api_metrics_1m_local", "issue_metrics_5m_local"} {
		if _, err := database.ExecContext(ctx, "TRUNCATE TABLE "+table); err != nil {
			t.Fatal(err)
		}
	}
}

func insertOverviewRows(t *testing.T, ctx context.Context, database interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}, rows []map[string]any) {
	t.Helper()
	encoded := make([]string, 0, len(rows))
	for _, row := range rows {
		contents, err := json.Marshal(row)
		if err != nil {
			t.Fatal(err)
		}
		encoded = append(encoded, string(contents))
	}
	query := "INSERT INTO rum_events SETTINGS insert_distributed_sync=1,date_time_input_format='best_effort' FORMAT JSONEachRow\n" + strings.Join(encoded, "\n")
	if _, err := database.ExecContext(ctx, query); err != nil {
		t.Fatal(err)
	}
}

func assertRate(t *testing.T, name string, metric RateMetric, value float64, numeratorSamples, denominatorSamples uint64) {
	t.Helper()
	if metric.Value == nil || !near(*metric.Value, value) || metric.NumeratorSamples != numeratorSamples || metric.DenominatorSamples != denominatorSamples {
		t.Fatalf("%s rate=%+v want value=%v samples=%d/%d", name, metric, value, numeratorSamples, denominatorSamples)
	}
}

func assertVital(t *testing.T, name string, metric VitalMetric, value float64, samples uint64) {
	t.Helper()
	if metric.P75 == nil || !near(*metric.P75, value) || metric.Samples != samples || metric.Sufficient {
		t.Fatalf("%s=%+v want p75=%v samples=%d insufficient", name, metric, value, samples)
	}
}
