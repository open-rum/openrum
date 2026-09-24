//go:build integration

package query

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"openrum/internal/migrate"
	"openrum/migrations"
)

func TestPerformanceRepositoryFiltersRoutesFacetsDistributionAndSamples(t *testing.T) {
	database := openClickHouseIntegrationDatabase(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := migrate.ClickHouseUp(ctx, database, migrations.Files); err != nil {
		t.Fatal(err)
	}
	truncateOverviewTables(t, ctx, database)

	fixture := readProtocolFixture(t)
	projectID := uuid.MustParse("018f4d9c-83a1-76c9-81c2-3020ab660000")
	from := time.Date(2026, 9, 3, 8, 0, 0, 0, time.UTC)
	rows := make([]map[string]any, 0, 86)
	// These rows share the time range but must contribute neither PV/vitals nor
	// facet options. The optimized WHERE must preserve those semantics.
	for _, index := range []int{1, 3, 4} {
		unrelated := fixtureRow(t, fixture, fixture.Events[index], from.Add(10*time.Minute))
		unrelated["event_id"] = uuid.NewString()
		unrelated["route"], unrelated["browser"], unrelated["country"] = "/unrelated", "UnrelatedBrowser", "FR"
		rows = append(rows, unrelated)
	}
	for index := range 80 {
		row := metricRow(t, fixtureRow(t, fixture, fixture.Events[2], from.Add(time.Duration(index)*time.Minute)), "LCP", 1000+float64(index*10), uuid.NewString())
		row["browser"] = map[bool]string{true: "Chrome", false: "Safari"}[index%2 == 0]
		row["device_type"] = map[bool]string{true: "desktop", false: "mobile"}[index%2 == 0]
		row["country"] = map[bool]string{true: "CN", false: "US"}[index%4 < 2]
		rows = append(rows, row)
	}
	for range 2 {
		page := fixtureRow(t, fixture, fixture.Events[0], from.Add(10*time.Minute))
		page["event_id"] = uuid.NewString()
		rows = append(rows, page)
	}
	for index := range 80 {
		for _, name := range []string{"FCP", "TTFB"} {
			value := 600 + float64(index*10)
			if name == "TTFB" {
				value = 200 + float64(index*5)
			}
			row := metricRow(t, fixtureRow(t, fixture, fixture.Events[2], from.Add(time.Duration(index)*time.Minute)), name, value, uuid.NewString())
			row["country"], row["device_type"], row["browser"] = "CN", "desktop", "Chrome"
			rows = append(rows, row)
		}
	}
	auxiliaryOnly := metricRow(t, fixtureRow(t, fixture, fixture.Events[2], from.Add(10*time.Minute)), "TTFB", 2100, uuid.NewString())
	auxiliaryOnly["route"] = "/auxiliary-only"
	rows = append(rows, auxiliaryOnly)
	synthetic := metricRow(t, fixtureRow(t, fixture, fixture.Events[2], from.Add(20*time.Minute)), "LCP", 9999, uuid.NewString())
	synthetic["ingest_flags"] = []string{"synthetic"}
	rows = append(rows, synthetic)
	otherRoute := metricRow(t, fixtureRow(t, fixture, fixture.Events[2], from.Add(20*time.Minute)), "LCP", 8888, uuid.NewString())
	otherRoute["route"] = "/other"
	rows = append(rows, otherRoute)
	insertOverviewRows(t, ctx, database, rows)

	result, err := NewPerformanceRepository(database).Get(ctx, PerformanceFilters{
		ProjectID: projectID, From: from, To: from.Add(2 * time.Hour), Environment: "production",
		Release: "2.18.0", Route: "/checkout", Metric: "LCP",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Routes) != 1 || result.Routes[0].Route != "/checkout" {
		t.Fatalf("routes=%+v", result.Routes)
	}
	var checkout RoutePerformance
	for _, route := range result.Routes {
		if route.Route == "/checkout" {
			checkout = route
		}
	}
	if checkout.PageViews != 2 || checkout.LCP.Samples != 80 || !checkout.LCP.Sufficient || checkout.LCP.P75 == nil {
		t.Fatalf("checkout=%+v", checkout)
	}
	if result.Detail == nil || len(result.Detail.Trend) == 0 || len(result.Detail.Distribution) == 0 || len(result.Detail.Samples) != 25 || len(result.Detail.Browsers) != 2 || len(result.Detail.DeviceTypes) != 2 {
		t.Fatalf("detail=%+v", result.Detail)
	}
	if result.Detail.Samples[0].Value >= 9999 || result.Detail.Samples[0].PageURL == "" || result.Detail.Browsers[0].Metric.Sufficient {
		t.Fatalf("samples/facets=%+v %+v", result.Detail.Samples[:1], result.Detail.Browsers)
	}

	overview, err := NewPerformanceRepository(database).Get(ctx, PerformanceFilters{
		ProjectID: projectID, From: from, To: from.Add(2 * time.Hour), Environment: "production",
		Release: "2.18.0", Metric: "LCP",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(overview.Trend) == 0 || overview.Trend[0].LCP.P75 == nil || overview.Trend[0].LCP.Samples == 0 {
		t.Fatalf("overview trend=%+v", overview.Trend)
	}
	if overview.Summary.LCP.Samples != 81 || overview.Summary.LCP.P50 == nil || overview.Summary.LCP.P99 == nil || *overview.Summary.LCP.P50 >= *overview.Summary.LCP.P99 {
		t.Fatalf("overall quantiles=%+v", overview.Summary.LCP)
	}
	if *overview.Summary.LCP.P75 >= 1800 || overview.Summary.INP.P95 != nil {
		t.Fatalf("must merge all samples, not average route quantiles: %+v", overview.Summary)
	}
	if overview.Summary.FCP.Samples != 80 || overview.Summary.TTFB.Samples != 81 || overview.Trend[0].FCP.P95 == nil || overview.Trend[0].TTFB.P50 == nil {
		t.Fatalf("auxiliary overall/trend=%+v %+v", overview.Summary, overview.Trend[0])
	}
	for _, name := range []string{"FCP", "TTFB"} {
		aux, err := NewPerformanceRepository(database).Get(ctx, PerformanceFilters{ProjectID: projectID, From: from, To: from.Add(2 * time.Hour), Route: "/checkout", Metric: name, Percentile: "p95", Country: "CN", DeviceType: "desktop"})
		if err != nil || aux.Detail == nil || aux.Detail.Metric != name || len(aux.Detail.Samples) != 25 || len(aux.Detail.Trend) == 0 || aux.Detail.Trend[0].Metric.P95 == nil {
			t.Fatalf("%s detail=%+v err=%v", name, aux.Detail, err)
		}
		var count uint64
		for _, bucket := range aux.Detail.Distribution {
			count += bucket.Samples
		}
		if count != 80 {
			t.Fatalf("%s distribution samples=%d", name, count)
		}
	}
	auxOnly, err := NewPerformanceRepository(database).Get(ctx, PerformanceFilters{ProjectID: projectID, From: from, To: from.Add(2 * time.Hour), Metric: "TTFB", Percentile: "p95"})
	if err != nil || len(auxOnly.Routes) != 3 || auxOnly.Routes[0].Route != "/auxiliary-only" || auxOnly.Routes[0].TTFB.Samples != 1 {
		t.Fatalf("auxiliary-only route and sorting=%+v err=%v", auxOnly.Routes, err)
	}
	filtered, err := NewPerformanceRepository(database).Get(ctx, PerformanceFilters{
		ProjectID: projectID, From: from, To: from.Add(2 * time.Hour), Environment: "production", Release: "2.18.0", Route: "/checkout", Metric: "LCP", Percentile: "p95", Country: "cn", DeviceType: "desktop", Browser: "Chrome",
	})
	if err != nil {
		t.Fatal(err)
	}
	if filtered.Summary.LCP.Samples != 20 || filtered.Detail == nil || len(filtered.Detail.Samples) != 20 || len(filtered.Facets["countries"]) != 2 {
		t.Fatalf("combined filters/facet self-exclusion: %+v", filtered)
	}
	var histogramCount, trendCount uint64
	for _, bucket := range filtered.Detail.Distribution {
		histogramCount += bucket.Samples
	}
	for _, point := range filtered.Detail.Trend {
		trendCount += point.Metric.Samples
		if point.Metric.Samples > 0 && point.Metric.P95 == nil {
			t.Fatal("missing P95 trend")
		}
		if point.Metric.Samples == 0 && point.Metric.P95 != nil {
			t.Fatal("a bucket with only auxiliary metrics must stay a gap for LCP")
		}
	}
	if histogramCount != 20 || trendCount != 20 {
		t.Fatalf("histogram=%d trend=%d", histogramCount, trendCount)
	}
	for _, sample := range filtered.Detail.Samples {
		if sample.Country != "CN" || sample.DeviceType != "desktop" || sample.Browser != "Chrome" {
			t.Fatalf("unfiltered raw sample: %+v", sample)
		}
	}
	empty, err := NewPerformanceRepository(database).Get(ctx, PerformanceFilters{ProjectID: projectID, From: from, To: from.Add(2 * time.Hour), Country: "JP", Metric: "LCP"})
	if err != nil || len(empty.Routes) != 0 || empty.Summary.LCP.P95 != nil || empty.Summary.LCP.Samples != 0 {
		t.Fatalf("empty=%+v err=%v", empty, err)
	}
	overflow, err := NewPerformanceRepository(database).Get(ctx, PerformanceFilters{ProjectID: projectID, From: from, To: from.Add(2 * time.Hour), Route: "/other", Metric: "LCP"})
	if err != nil || overflow.Detail == nil || len(overflow.Detail.Distribution) != 1 || !overflow.Detail.Distribution[0].Overflow {
		t.Fatalf("overflow=%+v err=%v", overflow, err)
	}
}
