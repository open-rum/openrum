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
	for index := range 80 {
		row := metricRow(t, fixtureRow(t, fixture, fixture.Events[2], from.Add(time.Duration(index)*time.Minute)), "LCP", 1000+float64(index*10), uuid.NewString())
		row["browser"] = map[bool]string{true: "Chrome", false: "Safari"}[index%2 == 0]
		row["device_type"] = map[bool]string{true: "desktop", false: "mobile"}[index%2 == 0]
		rows = append(rows, row)
	}
	for range 2 {
		page := fixtureRow(t, fixture, fixture.Events[0], from.Add(10*time.Minute))
		page["event_id"] = uuid.NewString()
		rows = append(rows, page)
	}
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
	if len(result.Routes) != 2 || result.Routes[0].Route != "/other" && result.Routes[1].Route != "/other" {
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
}
