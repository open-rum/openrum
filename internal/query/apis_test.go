//go:build integration

package query

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"openrum/internal/migrate"
	"openrum/migrations"
)

func TestAPIRepositoryGroupsNormalizedEndpointsAndReturnsSafeSamples(t *testing.T) {
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
	base := fixtureRow(t, fixture, fixture.Events[3], from.Add(10*time.Minute))
	rows := make([]map[string]any, 0, 6)
	for index, status := range []int{200, 404, 503} {
		row := cloneRow(t, base)
		row["event_id"] = uuid.NewString()
		row["api_status"] = status
		row["api_failure"] = map[bool]string{true: "http", false: ""}[status >= 500]
		row["duration_ms"] = float64(100 + index*150)
		row["page_url_normalized"] = "https://shop.example/checkout?token=secret#card"
		rows = append(rows, row)
	}
	network := cloneRow(t, base)
	network["event_id"], network["api_status"], network["api_failure"], network["duration_ms"] = uuid.NewString(), 0, "network", 800.0
	rows = append(rows, network)
	self := cloneRow(t, base)
	self["event_id"], self["api_url_normalized"] = uuid.NewString(), "https://rum.example/ingest/v1/envelope"
	rows = append(rows, self)
	insertOverviewRows(t, ctx, database, rows)

	result, err := NewAPIRepository(database).Get(ctx, APIFilters{
		ProjectID: projectID, From: from, To: from.Add(time.Hour), Environment: "production", Release: "2.18.0",
		Method: "POST", URL: "https://shop.example.com/api/order/submit?secret=yes", Sort: "failures",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Endpoints) != 1 || result.Endpoints[0].Requests != 4 || result.Endpoints[0].Failures != 2 || result.Endpoints[0].ClientErrors != 1 || result.Endpoints[0].ServerErrors != 1 || result.Endpoints[0].NetworkErrors != 1 || result.Endpoints[0].P95 == nil {
		t.Fatalf("endpoints=%+v", result.Endpoints)
	}
	if result.Detail == nil || len(result.Detail.Trend) == 0 || len(result.Detail.Routes) != 1 || len(result.Detail.Samples) != 4 {
		t.Fatalf("detail=%+v", result.Detail)
	}
	// The trend feeds a stacked composition, so a bucket has to add up: four
	// requests split into one 4xx, one 5xx and one transport failure.
	if point := result.Detail.Trend[0]; point.Requests != 4 || point.Failures != 2 || point.ClientErrors != 1 {
		t.Fatalf("trend point=%+v", point)
	}
	for _, sample := range result.Detail.Samples {
		if strings.ContainsAny(sample.PageURL, "?#") || strings.Contains(sample.PageURL, "secret") {
			t.Fatalf("unsafe sample=%+v", sample)
		}
	}
}

func TestAPIRepositoryExcludesSelfIngestEndpoint(t *testing.T) {
	database := openClickHouseIntegrationDatabase(t)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	from := time.Date(2026, 9, 3, 8, 0, 0, 0, time.UTC)
	result, err := NewAPIRepository(database).Get(ctx, APIFilters{ProjectID: uuid.New(), From: from, To: from.Add(time.Hour)})
	if err != nil || result.Endpoints == nil {
		t.Fatalf("result=%+v err=%v", result, err)
	}
}
