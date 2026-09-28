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

	"openrum/internal/catalog"
	"openrum/internal/migrate"
	"openrum/migrations"
)

// Every expected number below is worked out from the raw Events this test inserts, not
// read back from the aggregates: the point is to prove the catalog's merge expressions
// reproduce what the raw data says.
var (
	metricsFrom = time.Date(2026, 9, 2, 10, 0, 0, 0, time.UTC)
	metricsEnd  = time.Date(2026, 9, 2, 11, 0, 0, 0, time.UTC)
	early       = time.Date(2026, 9, 2, 10, 12, 30, 0, time.UTC)
	late        = time.Date(2026, 9, 2, 10, 47, 30, 0, time.UTC)
)

func TestCatalogMetricsReconcileWithRawEvents(t *testing.T) {
	database := openClickHouseIntegrationDatabase(t)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	if err := migrate.ClickHouseUp(ctx, database, migrations.Files); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"rum_events_local", "project_metrics_1m_local", "api_metrics_1m_local",
		"issue_metrics_5m_local", "measurement_metrics_1m_local", "behavior_metrics_1m_local"} {
		if _, err := database.ExecContext(ctx, "TRUNCATE TABLE "+table); err != nil {
			t.Fatal(err)
		}
	}
	projectID := uuid.New()
	insertMetricsFixture(t, ctx, database, projectID.String())
	repository := NewMetricsRepository(database)
	run := func(t *testing.T, from, to time.Time, spec catalog.Spec) MetricsResult {
		t.Helper()
		result, err := repository.Run(ctx, MetricsQuery{ProjectID: projectID, From: from, To: to, Environment: "production", Spec: spec})
		if err != nil {
			t.Fatalf("%+v: %v", spec, err)
		}
		return result
	}

	t.Run("traffic totals", func(t *testing.T) {
		result := run(t, metricsFrom, metricsEnd, catalog.Spec{
			Metrics: []string{"traffic.pageViews", "traffic.errors", "traffic.apiRequests"}, Shape: catalog.ShapeTotal,
		})
		// Page views 1 + 1/0.5 + 1 + 1; errors 1 + 1/0.5 + 1 + 1 + 1; API 1 + 1 + 1/0.5 + 1 + 1.
		expectValue(t, result.Totals, "traffic.pageViews", 5)
		expectValue(t, result.Totals, "traffic.errors", 6)
		expectValue(t, result.Totals, "traffic.apiRequests", 6)
		people := run(t, metricsFrom, metricsEnd, catalog.Spec{Metrics: []string{"traffic.sessions", "traffic.uniqueUsers"}, Shape: catalog.ShapeTotal})
		expectValue(t, people.Totals, "traffic.sessions", 3)
		expectValue(t, people.Totals, "traffic.uniqueUsers", 3)
		rate := run(t, metricsFrom, metricsEnd, catalog.Spec{Metrics: []string{"traffic.errorRate"}, Shape: catalog.ShapeTotal})
		// Errors per page view: six over five. It exceeds one, which the classic metric allows.
		expectValue(t, rate.Totals, "traffic.errorRate", 1.2)
	})

	t.Run("series lays values on a dense grid with null gaps", func(t *testing.T) {
		result := run(t, metricsFrom, metricsEnd, catalog.Spec{Metrics: []string{"traffic.pageViews"}, Shape: catalog.ShapeSeries})
		if result.IntervalSeconds != 120 || len(result.Buckets) != 30 {
			t.Fatalf("one hour is 30 two-minute buckets: interval=%d buckets=%d", result.IntervalSeconds, len(result.Buckets))
		}
		// Null and zero mean different things. 10:20 and 10:30 hold only error Events, so the
		// rollup has a row there and page views are a real zero; every other empty bucket had
		// no data at all and is null.
		points := result.Series[0].Points
		filled := 0
		for index, point := range points {
			if point == nil {
				continue
			}
			filled++
			switch result.Buckets[index].Format("15:04") {
			case "10:12":
				expectPoint(t, point, 3)
			case "10:46":
				expectPoint(t, point, 2)
			case "10:20", "10:30":
				expectPoint(t, point, 0)
			default:
				t.Fatalf("unexpected value in bucket %s", result.Buckets[index])
			}
		}
		if filled != 4 {
			t.Fatalf("buckets without any data must be null, not zero: %d filled", filled)
		}
		expectValue(t, result.Totals, "traffic.pageViews", 5)
	})

	t.Run("previous period lands on the current grid", func(t *testing.T) {
		// 47 minutes is not a whole number of two-minute buckets, so the previous period is
		// shifted by the exact range length before bucketing.
		to := metricsFrom.Add(47 * time.Minute)
		result := run(t, metricsFrom, to, catalog.Spec{Metrics: []string{"traffic.pageViews"}, Shape: catalog.ShapeSeries, Compare: true})
		if result.Comparison == nil || result.Comparison.OffsetSeconds != 47*60 {
			t.Fatalf("comparison=%+v", result.Comparison)
		}
		expectValue(t, result.Comparison.Totals, "traffic.pageViews", 1)
		if change := result.Comparison.Changes["traffic.pageViews"].Percent; change == nil || !near(*change, 200) {
			t.Fatalf("three page views against one is +200%%: %+v", result.Comparison.Changes)
		}
		// The previous page view at 09:20:10 shifted by 47 minutes is 10:07:10: bucket 10:06.
		found := false
		for index, point := range result.PreviousSeries[0].Points {
			if point == nil {
				continue
			}
			if result.Buckets[index].Format("15:04") != "10:06" {
				t.Fatalf("previous value landed on %s", result.Buckets[index])
			}
			expectPoint(t, point, 1)
			found = true
		}
		if !found {
			t.Fatal("the previous period's page view is missing from the overlay")
		}
	})

	t.Run("breakdown ranks, cuts off and keeps the remainder", func(t *testing.T) {
		result := run(t, metricsFrom, metricsEnd, catalog.Spec{Metrics: []string{"traffic.pageViews"}, Shape: catalog.ShapeBreakdown, Dimension: "browser", TopN: 2})
		if len(result.Rows) != 2 || result.Rows[0].Value != "Chrome" || result.Rows[1].Value != "Firefox" || !result.LimitReached {
			t.Fatalf("rows=%+v limit=%v (ties break by name)", result.Rows, result.LimitReached)
		}
		expectValue(t, result.Rows[0].Values, "traffic.pageViews", 3)
		expectValue(t, result.Other, "traffic.pageViews", 1)
		countries := run(t, metricsFrom, metricsEnd, catalog.Spec{Metrics: []string{"traffic.pageViews"}, Shape: catalog.ShapeBreakdown, Dimension: "country"})
		if value := rowValue(countries.Rows, "unknown", "traffic.pageViews"); value == nil || !near(*value, 1) {
			t.Fatalf("an empty country is its own visible group: %+v", countries.Rows)
		}
		users := run(t, metricsFrom, metricsEnd, catalog.Spec{Metrics: []string{"traffic.uniqueUsers"}, Shape: catalog.ShapeBreakdown, Dimension: "browser", TopN: 1})
		if users.Other != nil {
			t.Fatalf("distinct users do not add up across browsers, so there is no Other: %+v", users.Other)
		}
		filtered := run(t, metricsFrom, metricsEnd, catalog.Spec{Metrics: []string{"traffic.pageViews"}, Shape: catalog.ShapeTotal, Filters: map[string]string{"country": "unknown"}})
		expectValue(t, filtered.Totals, "traffic.pageViews", 1)
	})

	t.Run("split series folds the rest into Other", func(t *testing.T) {
		result := run(t, metricsFrom, metricsEnd, catalog.Spec{Metrics: []string{"traffic.pageViews"}, Shape: catalog.ShapeSeriesByDimension, Dimension: "browser", TopN: 1, Stack: catalog.StackDimension})
		if len(result.Groups) != 2 || result.Groups[0].Value != "Chrome" || !result.Groups[1].Other {
			t.Fatalf("groups=%+v", result.Groups)
		}
		expectBucket(t, result, result.Groups[0].Points, "10:12", 3)
		expectBucket(t, result, result.Groups[1].Points, "10:46", 2)
	})

	t.Run("table ranks by rate with sparklines and comparison", func(t *testing.T) {
		result := run(t, metricsFrom, metricsEnd, catalog.Spec{Metrics: []string{"traffic.errorRate"}, Shape: catalog.ShapeTable, Dimension: "browser", Compare: true, Sparkline: true})
		// Safari 2 / 1, Chrome 4 / 3, Firefox 0 / 1.
		if len(result.Rows) != 3 || result.Rows[0].Value != "Safari" || result.Rows[1].Value != "Chrome" || result.Rows[2].Value != "Firefox" {
			t.Fatalf("rows=%+v", result.Rows)
		}
		expectValue(t, result.Rows[0].Values, "traffic.errorRate", 2)
		expectValue(t, result.Rows[1].Values, "traffic.errorRate", 4.0/3)
		expectBucket(t, result, result.Rows[0].Sparkline, "10:46", 2)
		if result.Other != nil {
			t.Fatal("rates have no remainder")
		}
	})

	t.Run("API outcomes and latency", func(t *testing.T) {
		result := run(t, metricsFrom, metricsEnd, catalog.Spec{
			Metrics: []string{"api.clientErrorRate", "api.serverErrorRate", "api.networkErrorRate"},
			Shape:   catalog.ShapeSeries, Stack: catalog.StackMetrics,
		})
		// Five requests: one 404, one 503, one network failure.
		expectValue(t, result.Totals, "api.clientErrorRate", 0.2)
		expectValue(t, result.Totals, "api.serverErrorRate", 0.2)
		expectValue(t, result.Totals, "api.networkErrorRate", 0.2)
		counts := run(t, metricsFrom, metricsEnd, catalog.Spec{Metrics: []string{"api.requests"}, Shape: catalog.ShapeBreakdown, Dimension: "api"})
		expectValue(t, counts.Totals, "api.requests", 6)
		if value := rowValue(counts.Rows, "POST /api/pay", "api.requests"); value == nil || !near(*value, 3) {
			t.Fatalf("POST /api/pay is 1/0.5 + 1: %+v", counts.Rows)
		}
		failures := run(t, metricsFrom, metricsEnd, catalog.Spec{Metrics: []string{"api.failureRate"}, Shape: catalog.ShapeTotal})
		// A 4xx is not a failure: two failures (503 and network) out of five.
		expectValue(t, failures.Totals, "api.failureRate", 0.4)
		latency := run(t, metricsFrom, metricsEnd, catalog.Spec{Metrics: []string{"api.durationP95"}, Shape: catalog.ShapeTotal})
		if value := latency.Totals["api.durationP95"]; value.Value == nil || *value.Value < 300 || *value.Value > 400 || value.Sufficient {
			t.Fatalf("P95 of 50..400 ms from five samples is high and insufficient: %+v", value)
		}
	})

	t.Run("vitals keep insufficient values", func(t *testing.T) {
		result := run(t, metricsFrom, metricsEnd, catalog.Spec{Metrics: []string{"vitals.lcpP75"}, Shape: catalog.ShapeTotal})
		value := result.Totals["vitals.lcpP75"]
		if value.Value == nil || *value.Value < 2000 || *value.Value > 3000 || value.Sufficient || value.Samples != 3 {
			t.Fatalf("LCP P75 of 1000/2000/3000 is ~2500 from three samples: %+v", value)
		}
	})

	t.Run("issues split by resolved error type", func(t *testing.T) {
		result := run(t, metricsFrom, metricsEnd, catalog.Spec{Metrics: []string{"issues.events", "issues.activeIssues"}, Shape: catalog.ShapeTable, Dimension: "errorType"})
		if value := rowValue(result.Rows, "TypeError", "issues.events"); value == nil || !near(*value, 4) {
			t.Fatalf("TypeError events: %+v", result.Rows)
		}
		if value := rowValue(result.Rows, "TypeError", "issues.activeIssues"); value == nil || !near(*value, 3) {
			t.Fatalf("TypeError Issues: %+v", result.Rows)
		}
		if value := rowValue(result.Rows, "RangeError", "issues.activeIssues"); value == nil || !near(*value, 1) {
			t.Fatalf("RangeError Issues: %+v", result.Rows)
		}
		totals := run(t, metricsFrom, metricsEnd, catalog.Spec{Metrics: []string{"issues.events", "issues.users"}, Shape: catalog.ShapeTotal})
		expectValue(t, totals.Totals, "issues.events", 5)
	})

	t.Run("new issues mean new or back after thirty quiet days", func(t *testing.T) {
		// F1 and F2 first appear in the window; F3 was seen ten days earlier; F4 was last
		// seen forty days earlier, beyond the lookback, so it counts as back.
		total := run(t, metricsFrom, metricsEnd, catalog.Spec{Metrics: []string{"issues.newIssues"}, Shape: catalog.ShapeTotal})
		expectValue(t, total.Totals, "issues.newIssues", 3)
		if total.NewIssuesLookbackFrom == nil || !total.NewIssuesLookbackFrom.Equal(metricsFrom.Add(-newIssueLookback)) {
			t.Fatalf("the response states the lookback: %v", total.NewIssuesLookbackFrom)
		}
		byType := run(t, metricsFrom, metricsEnd, catalog.Spec{Metrics: []string{"issues.newIssues"}, Shape: catalog.ShapeBreakdown, Dimension: "errorType"})
		if value := rowValue(byType.Rows, "TypeError", "issues.newIssues"); value == nil || !near(*value, 2) {
			t.Fatalf("new TypeErrors: %+v", byType.Rows)
		}
		safari := run(t, metricsFrom, metricsEnd, catalog.Spec{Metrics: []string{"issues.newIssues"}, Shape: catalog.ShapeTotal, Filters: map[string]string{"browser": "Safari"}})
		// A filter narrows which new Issues count; only F1 was seen on Safari in the window.
		expectValue(t, safari.Totals, "issues.newIssues", 1)
		series := run(t, metricsFrom, metricsEnd, catalog.Spec{Metrics: []string{"issues.newIssues"}, Shape: catalog.ShapeSeries})
		if series.IntervalSeconds != 300 {
			t.Fatalf("issue series never go below five minutes: %d", series.IntervalSeconds)
		}
		expectBucket(t, series, series.Series[0].Points, "10:10", 1)
		expectBucket(t, series, series.Series[0].Points, "10:30", 1)
		expectBucket(t, series, series.Series[0].Points, "10:45", 1)
		expectBucket(t, series, series.Series[0].Points, "10:00", 0)
	})

	t.Run("measurements", func(t *testing.T) {
		result := run(t, metricsFrom, metricsEnd, catalog.Spec{Metrics: []string{"measurement.avg", "measurement.min", "measurement.max", "measurement.p50"}, Shape: catalog.ShapeSeries, Measurement: "amount"})
		expectValue(t, result.Totals, "measurement.avg", 200)
		expectValue(t, result.Totals, "measurement.min", 100)
		expectValue(t, result.Totals, "measurement.max", 300)
		if value := result.Totals["measurement.p50"].Value; value == nil || *value < 100 || *value > 300 {
			t.Fatalf("median of 100 and 300: %+v", result.Totals["measurement.p50"])
		}
		sums := run(t, metricsFrom, metricsEnd, catalog.Spec{Metrics: []string{"measurement.sum"}, Shape: catalog.ShapeTotal, Measurement: "amount"})
		expectValue(t, sums.Totals, "measurement.sum", 400)
		estimated := run(t, metricsFrom, metricsEnd, catalog.Spec{Metrics: []string{"measurement.estimated"}, Shape: catalog.ShapeTotal, Measurement: "amount"})
		// 100/1.0 + 300/0.5: equal to the plain sum would mean the sample rate was ignored.
		expectValue(t, estimated.Totals, "measurement.estimated", 700)
		payment := run(t, metricsFrom, metricsEnd, catalog.Spec{Metrics: []string{"measurement.sum"}, Shape: catalog.ShapeBreakdown, Dimension: "property:payment", Measurement: "amount"})
		if value := rowValue(payment.Rows, "wallet", "measurement.sum"); value == nil || !near(*value, 300) {
			t.Fatalf("revenue by payment method: %+v", payment.Rows)
		}
		browsers := run(t, metricsFrom, metricsEnd, catalog.Spec{Metrics: []string{"measurement.sum"}, Shape: catalog.ShapeBreakdown, Dimension: "browser", Measurement: "amount", Filters: map[string]string{"eventName": "checkout"}})
		if value := rowValue(browsers.Rows, "Safari", "measurement.sum"); value == nil || !near(*value, 300) {
			t.Fatalf("revenue by browser: %+v", browsers.Rows)
		}
	})

	t.Run("behavior events as pinned lines", func(t *testing.T) {
		lines := run(t, metricsFrom, metricsEnd, catalog.Spec{
			Metrics: []string{"behavior.events"}, Shape: catalog.ShapeSeriesByDimension, Dimension: "eventName",
			Groups: []string{"pay_start", "pay_success", "pay_failed", "pay_refund"},
		})
		if len(lines.Groups) != 4 || lines.LimitReached {
			t.Fatalf("pinned groups draw exactly what was asked, in order: %+v", lines.Groups)
		}
		for index, want := range []struct {
			name  string
			total float64
		}{{"pay_start", 4}, {"pay_success", 2}, {"pay_failed", 1}} {
			group := lines.Groups[index]
			if group.Value != want.name || group.Other || !near(sumPoints(group.Points), want.total) {
				t.Fatalf("line %d: want %s=%v, got %s=%v", index, want.name, want.total, group.Value, sumPoints(group.Points))
			}
		}
		for _, point := range lines.Groups[3].Points {
			if point != nil {
				t.Fatalf("an event that never happened is a gap, not a zero line: %+v", point)
			}
		}

		// Filtered to Custom Events the page views drop out; the ranking is by weighted count.
		table := run(t, metricsFrom, metricsEnd, catalog.Spec{
			Metrics: []string{"behavior.events", "behavior.users"}, Shape: catalog.ShapeTable, Dimension: "eventName",
			Filters: map[string]string{"eventKind": "custom"},
		})
		order := make([]string, 0, len(table.Rows))
		for _, row := range table.Rows {
			order = append(order, row.Value)
		}
		if strings.Join(order, ",") != "pay_start,checkout,pay_success,pay_failed" {
			t.Fatalf("custom events by count: %v", order)
		}
		if value := rowValue(table.Rows, "pay_start", "behavior.users"); value == nil || !near(*value, 3) {
			t.Fatalf("three users started a payment: %+v", table.Rows)
		}

		// Every Event is stored once per dimension; a total must read only the 'all' rows.
		total := run(t, metricsFrom, metricsEnd, catalog.Spec{Metrics: []string{"behavior.events"}, Shape: catalog.ShapeTotal})
		expectValue(t, total.Totals, "behavior.events", 5+3+7)
		countries := run(t, metricsFrom, metricsEnd, catalog.Spec{
			Metrics: []string{"behavior.events"}, Shape: catalog.ShapeBreakdown, Dimension: "country",
			Filters: map[string]string{"eventName": "pay_start"},
		})
		if cn, us := rowValue(countries.Rows, "CN", "behavior.events"), rowValue(countries.Rows, "US", "behavior.events"); cn == nil || us == nil || !near(*cn, 3) || !near(*us, 1) {
			t.Fatalf("payment starts by country: %+v", countries.Rows)
		}
		reasons := run(t, metricsFrom, metricsEnd, catalog.Spec{
			Metrics: []string{"behavior.events"}, Shape: catalog.ShapeBreakdown, Dimension: "property:reason",
		})
		if value := rowValue(reasons.Rows, "declined", "behavior.events"); value == nil || !near(*value, 1) || reasons.Other != nil {
			t.Fatalf("failures by reason, with no share of the whole: %+v other=%+v", reasons.Rows, reasons.Other)
		}
	})

	t.Run("synthetic events are excluded", func(t *testing.T) {
		result := run(t, metricsFrom.Add(-2*time.Hour), metricsEnd, catalog.Spec{Metrics: []string{"traffic.pageViews"}, Shape: catalog.ShapeTotal, Filters: map[string]string{"route": "/synthetic"}})
		expectValue(t, result.Totals, "traffic.pageViews", 0)
	})
}

func insertMetricsFixture(t *testing.T, ctx context.Context, database *sql.DB, projectID string) {
	t.Helper()
	event := func(eventType string, at time.Time, fields map[string]any) map[string]any {
		return metricsEvent(projectID, eventType, at, fields)
	}
	previous := time.Date(2026, 9, 2, 9, 20, 10, 0, time.UTC)
	rows := []map[string]any{
		// Page views: 5 weighted, 3 Sessions (s3 twice), 3 users. One falls in the previous period.
		event("page_view", early, map[string]any{"session_id": "s1", "anonymous_user_id": "u1", "route": "/home"}),
		event("page_view", early, map[string]any{"session_id": "s2", "anonymous_user_id": "u2", "route": "/home", "sample_rate": 0.5}),
		event("page_view", late, map[string]any{"session_id": "s3", "anonymous_user_id": "u3", "route": "/checkout", "browser": "Safari", "country": "US", "device_type": "mobile"}),
		event("page_view", late, map[string]any{"session_id": "s3", "anonymous_user_id": "u3", "route": "/checkout", "browser": "Firefox", "country": ""}),
		event("page_view", previous, map[string]any{"session_id": "s9", "anonymous_user_id": "u9"}),
		event("page_view", early, map[string]any{"route": "/synthetic", "ingest_flags": []string{"synthetic"}}),

		// Errors: F1 TypeError (Chrome, then Safari), F2 RangeError, F3 seen ten days earlier,
		// F4 last seen forty days earlier. Weighted, the window holds 1 + 2 + 1 + 1 + 1 = 6.
		event("error", early, map[string]any{"fingerprint": "F1", "error_type": "TypeError", "session_id": "s1", "anonymous_user_id": "u1"}),
		event("error", late, map[string]any{"fingerprint": "F1", "error_type": "TypeError", "browser": "Safari", "sample_rate": 0.5, "session_id": "s3", "anonymous_user_id": "u3"}),
		event("error", late, map[string]any{"fingerprint": "F2", "error_type": "RangeError", "session_id": "s2", "anonymous_user_id": "u2"}),
		event("error", metricsFrom.Add(-10*24*time.Hour), map[string]any{"fingerprint": "F3", "error_type": "TypeError"}),
		event("error", metricsFrom.Add(20*time.Minute), map[string]any{"fingerprint": "F3", "error_type": "TypeError"}),
		event("error", metricsFrom.Add(-40*24*time.Hour), map[string]any{"fingerprint": "F4", "error_type": "TypeError"}),
		event("error", metricsFrom.Add(30*time.Minute), map[string]any{"fingerprint": "F4", "error_type": "TypeError"}),

		// API: five requests (six weighted) — 200, 404, 503, a network failure, and a late 200.
		event("api", early, map[string]any{"route": "/checkout", "api_method": "GET", "api_url_normalized": "/api/cart", "api_status": 200, "duration_ms": 100.0}),
		event("api", early, map[string]any{"route": "/checkout", "api_method": "GET", "api_url_normalized": "/api/cart", "api_status": 404, "duration_ms": 120.0}),
		event("api", early, map[string]any{"route": "/checkout", "api_method": "POST", "api_url_normalized": "/api/pay", "api_status": 503, "api_failure": "http", "duration_ms": 400.0, "sample_rate": 0.5}),
		event("api", early, map[string]any{"route": "/checkout", "api_method": "POST", "api_url_normalized": "/api/pay", "api_status": 0, "api_failure": "network", "duration_ms": 50.0}),
		event("api", late, map[string]any{"route": "/checkout", "api_method": "GET", "api_url_normalized": "/api/cart", "api_status": 200, "duration_ms": 300.0}),

		// LCP from three samples: below the 50 a P75 needs to be trusted.
		event("web_vital", early, map[string]any{"metric_name": "LCP", "metric_value": 1000.0}),
		event("web_vital", early, map[string]any{"metric_name": "LCP", "metric_value": 2000.0}),
		event("web_vital", late, map[string]any{"metric_name": "LCP", "metric_value": 3000.0}),

		// Checkout amounts: 100 by card on Chrome, 300 by wallet on Safari at half sampling.
		event("custom", early, map[string]any{"custom_name": "checkout", "measurements": map[string]float64{"amount": 100}, "attributes": map[string]string{"payment": "card"}}),
		event("custom", late, map[string]any{"custom_name": "checkout", "measurements": map[string]float64{"amount": 300}, "attributes": map[string]string{"payment": "wallet"}, "browser": "Safari", "country": "US", "sample_rate": 0.5}),

		// A payment funnel: three starts (four weighted), two successes and one failure.
		event("custom", early, map[string]any{"custom_name": "pay_start", "session_id": "s1", "anonymous_user_id": "u1"}),
		event("custom", early, map[string]any{"custom_name": "pay_start", "session_id": "s2", "anonymous_user_id": "u2", "sample_rate": 0.5}),
		event("custom", late, map[string]any{"custom_name": "pay_start", "session_id": "s3", "anonymous_user_id": "u3", "country": "US"}),
		event("custom", early, map[string]any{"custom_name": "pay_success", "session_id": "s1", "anonymous_user_id": "u1"}),
		event("custom", late, map[string]any{"custom_name": "pay_success", "session_id": "s3", "anonymous_user_id": "u3", "country": "US"}),
		event("custom", late, map[string]any{"custom_name": "pay_failed", "session_id": "s2", "anonymous_user_id": "u2", "attributes": map[string]string{"reason": "declined"}}),
	}
	insert := "INSERT INTO rum_events SETTINGS insert_distributed_sync=1,date_time_input_format='best_effort' FORMAT JSONEachRow\n" + encodeMetricsRows(t, rows)
	if _, err := database.ExecContext(ctx, insert); err != nil {
		t.Fatal(err)
	}
}

func metricsEvent(projectID, eventType string, at time.Time, fields map[string]any) map[string]any {
	row := map[string]any{
		"project_id": projectID, "event_id": uuid.NewString(), "event_type": eventType,
		"timestamp": at.Format(time.RFC3339Nano), "received_at": at.Format(time.RFC3339Nano),
		"environment": "production", "release": "1.0.0", "session_id": "s-default", "anonymous_user_id": "u-default",
		"route": "/", "sample_rate": 1.0, "browser": "Chrome", "device_type": "desktop", "country": "CN",
	}
	for key, value := range fields {
		row[key] = value
	}
	// session_id is a UUID column. Names keep the fixture readable; hashing them keeps two
	// events with the same name in the same Session.
	row["session_id"] = uuid.NewSHA1(uuid.NameSpaceOID, []byte(row["session_id"].(string))).String()
	return row
}

func expectValue(t *testing.T, values map[string]MetricValue, metric string, want float64) {
	t.Helper()
	value, ok := values[metric]
	if !ok || value.Value == nil || !near(*value.Value, want) {
		t.Fatalf("%s: got %+v, want %v", metric, value, want)
	}
}

func expectPoint(t *testing.T, point *MetricValue, want float64) {
	t.Helper()
	if point == nil || point.Value == nil || !near(*point.Value, want) {
		t.Fatalf("point: got %+v, want %v", point, want)
	}
}

func expectBucket(t *testing.T, result MetricsResult, points []*MetricValue, bucket string, want float64) {
	t.Helper()
	for index, current := range result.Buckets {
		if current.Format("15:04") == bucket {
			expectPoint(t, points[index], want)
			return
		}
	}
	t.Fatalf("no bucket %s in %v", bucket, result.Buckets)
}

func rowValue(rows []MetricsRow, group, metric string) *float64 {
	for _, row := range rows {
		if row.Value == group {
			return row.Values[metric].Value
		}
	}
	return nil
}

func encodeMetricsRows(t *testing.T, rows []map[string]any) string {
	t.Helper()
	encoded := make([]string, 0, len(rows))
	for _, row := range rows {
		contents, err := json.Marshal(row)
		if err != nil {
			t.Fatal(err)
		}
		encoded = append(encoded, string(contents))
	}
	return strings.Join(encoded, "\n")
}

func sumPoints(points []*MetricValue) float64 {
	total := 0.0
	for _, point := range points {
		if point != nil && point.Value != nil {
			total += *point.Value
		}
	}
	return total
}
