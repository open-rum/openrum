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
	// Raw events expire after 14 days, so a fixed date turns this into a test of the clock.
	from := time.Now().UTC().Truncate(time.Hour).Add(-3 * time.Hour)
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
	if result.Detail == nil || len(result.Detail.Trend) == 0 || len(result.Detail.Routes) != 1 {
		t.Fatalf("detail=%+v", result.Detail)
	}
	// The trend feeds a stacked composition, so a bucket has to add up: four
	// requests split into one 4xx, one 5xx and one transport failure.
	if point := result.Detail.Trend[0]; point.Requests != 4 || point.Failures != 2 || point.ClientErrors != 1 ||
		point.ServerErrors != 1 || point.NetworkErrors != 1 {
		t.Fatalf("trend point=%+v", point)
	}
	// The latency chart draws all three percentiles from the same bucket, in order.
	if point := result.Detail.Trend[0]; point.P50 == nil || point.P75 == nil || point.P95 == nil ||
		*point.P50 > *point.P75 || *point.P75 > *point.P95 {
		t.Fatalf("trend percentiles=%+v", result.Detail.Trend[0])
	}
	// An hour is thirty two-minute buckets under the Console's shared policy.
	if result.Interval != "2 MINUTE" {
		t.Fatalf("interval=%q, want the bucket size the trend was grouped by", result.Interval)
	}
	endpointFilters := APIFilters{
		ProjectID: projectID, From: from, To: from.Add(time.Hour), Environment: "production", Release: "2.18.0",
		Method: "POST", URL: "https://shop.example.com/api/order/submit?secret=yes",
	}
	samples, err := NewAPIRepository(database).Samples(ctx, endpointFilters)
	if err != nil {
		t.Fatal(err)
	}
	if len(samples.Samples) != 4 || samples.Truncated {
		t.Fatalf("samples=%d truncated=%v, want the endpoint's four requests", len(samples.Samples), samples.Truncated)
	}
	for index, sample := range samples.Samples {
		if strings.ContainsAny(sample.PageURL, "?#") || strings.Contains(sample.PageURL, "secret") || strings.ContainsAny(sample.URL, "?#") {
			t.Fatalf("unsafe sample=%+v", sample)
		}
		if sample.Method != "POST" || sample.URL != "https://shop.example.com/api/order/submit" || sample.SessionID == uuid.Nil {
			t.Fatalf("sample=%+v", sample)
		}
		if index > 0 && sample.Timestamp.After(samples.Samples[index-1].Timestamp) {
			t.Fatalf("samples are not newest first: %+v", samples.Samples)
		}
	}
	// Searching by the start of either user ID narrows only the list.
	someone := samples.Samples[0]
	for _, term := range []string{someone.AnonymousUserID, someone.UserID} {
		if term == "" {
			continue
		}
		narrowed := endpointFilters
		narrowed.User = term[:min(len(term), 6)]
		found, err := NewAPIRepository(database).Samples(ctx, narrowed)
		if err != nil || len(found.Samples) == 0 {
			t.Fatalf("user %q: samples=%v err=%v", narrowed.User, found.Samples, err)
		}
	}
	narrowed := endpointFilters
	narrowed.User = "nobody-has-this-id"
	if found, err := NewAPIRepository(database).Samples(ctx, narrowed); err != nil || len(found.Samples) != 0 {
		t.Fatalf("unknown user matched %d samples, err=%v", len(found.Samples), err)
	}
	if _, err := NewAPIRepository(database).Samples(ctx, APIFilters{ProjectID: projectID, From: from, To: from.Add(time.Hour)}); err == nil {
		t.Fatal("samples without an endpoint must be refused")
	}
}

func TestAPIRepositoryExcludesSelfIngestEndpoint(t *testing.T) {
	database := openClickHouseIntegrationDatabase(t)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	// Raw events expire after 14 days, so a fixed date turns this into a test of the clock.
	from := time.Now().UTC().Truncate(time.Hour).Add(-3 * time.Hour)
	result, err := NewAPIRepository(database).Get(ctx, APIFilters{ProjectID: uuid.New(), From: from, To: from.Add(time.Hour)})
	if err != nil || result.Endpoints == nil {
		t.Fatalf("result=%+v err=%v", result, err)
	}
}

func TestAPIRepositorySamplesReturnHeadersOnlyInsideTheRetentionWindow(t *testing.T) {
	database := openClickHouseIntegrationDatabase(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := migrate.ClickHouseUp(ctx, database, migrations.Files); err != nil {
		t.Fatal(err)
	}
	truncateOverviewTables(t, ctx, database)
	fixture := readProtocolFixture(t)
	projectID := uuid.MustParse("018f4d9c-83a1-76c9-81c2-3020ab660000")
	now := time.Now().UTC()

	row := func(age time.Duration, request, response map[string]string) map[string]any {
		current := cloneRow(t, fixtureRow(t, fixture, fixture.Events[3], now.Add(-age)))
		current["event_id"] = uuid.NewString()
		current["api_request_headers"], current["api_response_headers"] = request, response
		current["api_request_body"], current["api_response_body"] = "", ""
		if len(request) > 0 {
			current["api_request_body"], current["api_response_body"] = `{"asked":"`+request["x-request-id"]+`"}`, `{"answered":true}`
		}
		return current
	}
	insertOverviewRows(t, ctx, database, []map[string]any{
		row(time.Hour, map[string]string{"x-request-id": "fresh"}, map[string]string{"etag": `"abc"`}),
		// Older than three days but well inside the raw row's 14: the row stays, the snapshot goes.
		row(4*24*time.Hour, map[string]string{"x-request-id": "stale"}, map[string]string{"etag": `"old"`}),
		row(2*time.Hour, nil, nil),
	})

	samples, err := NewAPIRepository(database).Samples(ctx, APIFilters{
		ProjectID: projectID, From: now.Add(-6 * 24 * time.Hour), To: now.Add(time.Minute),
		Environment: "production", Release: "2.18.0",
		Method: "POST", URL: "https://shop.example.com/api/order/submit",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(samples.Samples) != 3 {
		t.Fatalf("samples=%d, want all three requests listed", len(samples.Samples))
	}
	var withHeaders, withoutHeaders int
	for _, sample := range samples.Samples {
		switch {
		case sample.RequestHeaders["x-request-id"] == "fresh" && sample.ResponseHeaders["etag"] == `"abc"`:
			if sample.RequestBody != `{"asked":"fresh"}` || sample.ResponseBody != `{"answered":true}` {
				t.Fatalf("the fresh snapshot lost its bodies: %+v", sample)
			}
			withHeaders++
		case len(sample.RequestHeaders) == 0 && len(sample.ResponseHeaders) == 0:
			if sample.RequestBody != "" || sample.ResponseBody != "" {
				t.Fatalf("a body outside the window was returned: %+v", sample)
			}
			withoutHeaders++
		default:
			t.Fatalf("a snapshot outside the window or unexpected one was returned: %+v", sample)
		}
	}
	if withHeaders != 1 || withoutHeaders != 2 {
		t.Fatalf("with=%d without=%d, want 1 fresh snapshot and 2 empty (stale hidden, none captured)", withHeaders, withoutHeaders)
	}
}
