//go:build integration

package query

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	"openrum/internal/migrate"
	"openrum/migrations"
)

func TestBehaviorEventDetail(t *testing.T) {
	database := openClickHouseIntegrationDatabase(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := migrate.ClickHouseUp(ctx, database, migrations.Files); err != nil {
		t.Fatal(err)
	}
	projectID := uuid.New()
	// Relative to now: raw events expire after 14 days. The event last occurs three days
	// before the end of a week-long range, so the range's final day holds none of it.
	to := time.Now().UTC().Truncate(time.Hour)
	from := to.Add(-7 * 24 * time.Hour)
	last := to.Add(-3 * 24 * time.Hour).Add(17 * time.Minute)
	plans := []string{"pro", "pro", "pro", "pro", "free", "free", "free", "team", "team", "edu", "trial", "gift"}
	for index, plan := range plans {
		at := last.Add(-time.Duration(index) * time.Minute)
		if _, err := database.ExecContext(ctx, `INSERT INTO rum_events
			(project_id,event_id,event_type,timestamp,received_at,environment,session_id,anonymous_user_id,page_id,sample_rate,custom_name,attributes,ingest_flags)
			VALUES (?,?,'custom',?,?,'production',?,?,?,1,'checkout',map('plan',?,'step','pay'),[])`,
			projectID, uuid.New(), at, at, uuid.New(), "user", uuid.New(), plan); err != nil {
			t.Fatal(err)
		}
	}
	// Two days before the last one: inside the range, outside the day the samples read.
	early := last.Add(-2 * 24 * time.Hour)
	if _, err := database.ExecContext(ctx, `INSERT INTO rum_events
		(project_id,event_id,event_type,timestamp,received_at,environment,session_id,anonymous_user_id,page_id,sample_rate,custom_name,attributes,ingest_flags)
		VALUES (?,?,'custom',?,?,'production',?,'user',?,1,'checkout',map('plan','early'),[])`,
		projectID, uuid.New(), early, early, uuid.New(), uuid.New()); err != nil {
		t.Fatal(err)
	}

	repository := NewBehaviorRepository(database)
	filters := BehaviorFilters{ProjectID: projectID, From: from, To: to, EventName: "checkout", Dimension: "country"}
	result, err := repository.Get(ctx, filters)
	if err != nil {
		t.Fatal(err)
	}
	var plan BehaviorPropertySummary
	for _, property := range result.Properties {
		if property.Name == "plan" {
			plan = property
		}
	}
	if len(plan.TopValues) != behaviorPropertyTopValues || plan.TopValues[0] != (BehaviorPropertyValue{Value: "pro", Events: 4}) ||
		plan.TopValues[1] != (BehaviorPropertyValue{Value: "free", Events: 3}) || plan.TopValues[2].Value != "team" {
		t.Fatalf("plan values=%+v", plan.TopValues)
	}
	// Across every event a property name means nothing in particular, so no values are read.
	all, err := repository.Get(ctx, BehaviorFilters{ProjectID: projectID, From: from, To: to, Dimension: "country"})
	if err != nil {
		t.Fatal(err)
	}
	for _, property := range all.Properties {
		if len(property.TopValues) != 0 {
			t.Fatalf("unselected event property=%+v", property)
		}
	}

	samples, err := repository.ListSamples(ctx, filters)
	if err != nil {
		t.Fatal(err)
	}
	if len(samples.Samples) != len(plans) || samples.Samples[0].Attributes["plan"] != "pro" {
		t.Fatalf("samples=%d first=%+v", len(samples.Samples), samples.Samples)
	}
	wantTo := last.Truncate(time.Minute).Add(time.Minute)
	if samples.Window == nil || !samples.Window.To.Equal(wantTo) || !samples.Window.From.Equal(wantTo.Add(-24*time.Hour)) {
		t.Fatalf("window=%+v want to %s", samples.Window, wantTo)
	}

	quiet, err := repository.ListSamples(ctx, BehaviorFilters{
		ProjectID: projectID, From: from, To: to, EventName: "never_sent", Dimension: "country",
	})
	if err != nil || len(quiet.Samples) != 0 || quiet.Window != nil {
		t.Fatalf("quiet=%+v err=%v", quiet, err)
	}
	if _, err := repository.ListSamples(ctx, BehaviorFilters{
		ProjectID: projectID, From: to.Add(-31 * 24 * time.Hour), To: to, EventName: "checkout", Dimension: "country",
	}); !errors.Is(err, ErrInvalidBehaviorFilters) {
		t.Fatalf("31-day range err=%v", err)
	}
}
