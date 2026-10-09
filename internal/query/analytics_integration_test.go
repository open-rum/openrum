//go:build integration

package query

import (
	"context"
	"errors"
	"math"
	"testing"
	"time"

	"github.com/google/uuid"

	"openrum/internal/migrate"
	"openrum/migrations"
)

func TestBehaviorAggregatesReconcileWithRawEvents(t *testing.T) {
	database := openClickHouseIntegrationDatabase(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := migrate.ClickHouseUp(ctx, database, migrations.Files); err != nil {
		t.Fatal(err)
	}
	projectID := uuid.New()
	sessionA, sessionB := uuid.New(), uuid.New()
	// Relative to now: raw events expire after 14 days, so a fixed date ages out of rum_events.
	from := time.Now().UTC().Truncate(time.Hour).Add(-24 * time.Hour)
	_, err := database.ExecContext(ctx, `INSERT INTO rum_events
		(project_id,event_id,event_type,timestamp,received_at,environment,session_id,anonymous_user_id,page_id,
		referrer,navigation_type,sample_rate,browser,device_type,country,custom_name,attributes,ingest_flags)
		VALUES
		(?,?,?,?,?,'production',?,?,?,'https://search.example.com/results','navigate',1,'Chrome','desktop','CN','',map(),[]),
		(?,?,?,?,?,'production',?,?,?,'https://app.example.com/home','route_change',0.5,'Chrome','desktop','CN','',map(),[]),
		(?,?,?,?,?,'production',?,?,?,'https://app.example.com/cart','',1,'Safari','mobile','CN','ui.click',map('element','button'),[]),
		(?,?,?,?,?,'production',?,?,?,'','',1,'Safari','mobile','US','signup',map('plan','pro'),[])`,
		projectID, uuid.New(), "page_view", from.Add(time.Minute), from.Add(time.Minute), sessionA, "user-a", uuid.New(),
		projectID, uuid.New(), "page_view", from.Add(2*time.Minute), from.Add(2*time.Minute), sessionA, "user-a", uuid.New(),
		projectID, uuid.New(), "custom", from.Add(3*time.Minute), from.Add(3*time.Minute), sessionA, "user-a", uuid.New(),
		projectID, uuid.New(), "custom", from.Add(4*time.Minute), from.Add(4*time.Minute), sessionB, "user-b", uuid.New(),
	)
	if err != nil {
		t.Fatal(err)
	}

	repository := NewBehaviorRepository(database)
	repository.now = func() time.Time { return from.Add(5 * time.Minute) }
	result, err := repository.Get(ctx, BehaviorFilters{
		ProjectID: projectID, From: from, To: from.Add(time.Hour), Environment: "production", Dimension: "country",
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Totals.Events != 4 || result.Totals.UniqueUsers != 2 || result.Totals.UniqueSessions != 2 || math.Abs(result.Totals.Estimated-5) > 0.001 {
		t.Fatalf("totals=%+v", result.Totals)
	}
	if len(result.Breakdown) != 2 || result.Breakdown[0].Value != "CN" || result.Breakdown[0].Metric.Events != 3 {
		t.Fatalf("country breakdown=%+v", result.Breakdown)
	}
	if len(result.Trend) != 4 || result.SampleCount != 4 || result.Freshness.LatestReceivedAt == nil {
		t.Fatalf("trend=%d sampleCount=%d freshness=%+v", len(result.Trend), result.SampleCount, result.Freshness)
	}
	if len(result.Catalog) != 4 {
		t.Fatalf("catalog=%+v", result.Catalog)
	}
	if len(result.Properties) != 2 || result.Properties[0].Events == 0 {
		t.Fatalf("properties=%+v", result.Properties)
	}

	property, err := repository.Get(ctx, BehaviorFilters{
		ProjectID: projectID, From: from, To: from.Add(time.Hour), EventKind: "custom", Dimension: "property:plan",
	})
	if err != nil {
		t.Fatal(err)
	}
	if property.Totals.Events != 1 || len(property.Breakdown) != 1 || property.Breakdown[0].Value != "pro" {
		t.Fatalf("property result=%+v", property)
	}

	var raw uint64
	if err := database.QueryRowContext(ctx, `SELECT uniqExact(event_id) FROM rum_events FINAL WHERE project_id=? AND event_type IN ('page_view','custom')`, projectID).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	if raw != result.Totals.Events {
		t.Fatalf("raw=%d aggregate=%d", raw, result.Totals.Events)
	}
	for _, check := range []struct {
		dimension string
		value     string
		events    uint64
	}{
		{dimension: "device", value: "desktop", events: 2},
		{dimension: "browser", value: "Chrome", events: 2},
		{dimension: "source", value: "app.example.com", events: 2},
	} {
		grouped, queryErr := repository.Get(ctx, BehaviorFilters{
			ProjectID: projectID, From: from, To: from.Add(time.Hour), Dimension: check.dimension,
		})
		if queryErr != nil {
			t.Fatal(queryErr)
		}
		if len(grouped.Breakdown) == 0 || grouped.Breakdown[0].Value != check.value || grouped.Breakdown[0].Metric.Events != check.events {
			t.Fatalf("%s breakdown=%+v", check.dimension, grouped.Breakdown)
		}
	}
	navigation, err := repository.Get(ctx, BehaviorFilters{
		ProjectID: projectID, From: from, To: from.Add(time.Hour), EventKind: "navigation", Dimension: "country",
	})
	if err != nil || navigation.Totals.Events != 1 {
		t.Fatalf("navigation=%+v err=%v", navigation, err)
	}
	samples, err := repository.ListSamples(ctx, BehaviorFilters{
		ProjectID: projectID, From: from, To: from.Add(time.Hour), EventKind: "click", Dimension: "country",
	})
	if err != nil || len(samples.Samples) != 1 || samples.Samples[0].Name != "click" || samples.Samples[0].Attributes["element"] != "button" {
		t.Fatalf("samples=%+v err=%v", samples, err)
	}

	highCardinalityProject := uuid.New()
	if _, err := database.ExecContext(ctx, `INSERT INTO rum_events
		(project_id,event_id,event_type,timestamp,received_at,environment,session_id,anonymous_user_id,page_id,sample_rate,custom_name,attributes,ingest_flags)
		SELECT ?,generateUUIDv4(),'custom',?,?,'production',generateUUIDv4(),concat('user-',toString(number)),generateUUIDv4(),1,'campaign_view',map('campaign',toString(number)),[]
		FROM numbers(101)`, highCardinalityProject, from.Add(10*time.Minute), from.Add(10*time.Minute)); err != nil {
		t.Fatal(err)
	}
	_, err = repository.Get(ctx, BehaviorFilters{
		ProjectID: highCardinalityProject, From: from, To: from.Add(time.Hour), Dimension: "property:campaign",
	})
	if !errors.Is(err, ErrBehaviorCardinalityExceeded) {
		t.Fatalf("cardinality error=%v", err)
	}
}
