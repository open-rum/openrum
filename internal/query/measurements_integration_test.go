//go:build integration

package query

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"openrum/internal/migrate"
	"openrum/migrations"
)

// The aggregate is a materialized view over a deliberate cross product of measurement
// keys and dimensions. Two arrays listed in one ARRAY JOIN would zip instead of cross,
// which produces a plausible-looking table containing the wrong numbers, so the numbers
// themselves are what this test asserts.
func TestMeasurementAggregateSumsAndSplits(t *testing.T) {
	database := openClickHouseIntegrationDatabase(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := migrate.ClickHouseUp(ctx, database, migrations.Files); err != nil {
		t.Fatal(err)
	}
	if _, err := database.ExecContext(ctx, "TRUNCATE TABLE rum_events_local"); err != nil {
		t.Fatal(err)
	}
	if _, err := database.ExecContext(ctx, "TRUNCATE TABLE measurement_metrics_1m_local"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		background := context.Background()
		_, _ = database.ExecContext(background, "TRUNCATE TABLE rum_events_local")
		_, _ = database.ExecContext(background, "TRUNCATE TABLE measurement_metrics_1m_local")
	})

	project := uuid.New()
	at := time.Date(2026, 9, 10, 10, 0, 0, 0, time.UTC)
	rows := []string{
		// Full sampling, two measurements, paid by card.
		measurementFixture(project, "custom", "checkout_completed", at, 1.0,
			`{"payment":"card"}`, `{"amount":100.0,"items":2.0}`),
		// Half sampling: the stored total stays 300 while the estimate doubles it.
		measurementFixture(project, "custom", "checkout_completed", at.Add(30*time.Second), 0.5,
			`{"payment":"wallet"}`, `{"amount":300.0}`),
		// A Page View carries no measurements and must not reach the aggregate at all.
		measurementFixture(project, "page_view", "", at.Add(40*time.Second), 1.0, `{}`, `{}`),
	}
	insert := "INSERT INTO rum_events SETTINGS date_time_input_format = 'best_effort' FORMAT JSONEachRow\n" +
		strings.Join(rows, "\n")
	if _, err := database.ExecContext(ctx, insert); err != nil {
		t.Fatalf("insert fixtures: %v", err)
	}

	repository := NewBehaviorRepository(database)
	filters := BehaviorFilters{
		ProjectID: project, From: at.Add(-time.Hour), To: at.Add(time.Hour), Dimension: "country",
	}

	summary, err := repository.measurements(ctx, filters)
	if err != nil {
		t.Fatal(err)
	}
	byName := map[string]BehaviorMeasurementSummary{}
	for _, item := range summary {
		byName[item.Name] = item
	}
	if len(byName) != 2 {
		t.Fatalf("summary has %d keys, want amount and items only: %+v", len(byName), summary)
	}
	amount := byName["amount"]
	if amount.Samples != 2 || amount.Total != 400 {
		t.Fatalf("amount is %d samples totalling %v, want 2 and 400", amount.Samples, amount.Total)
	}
	// 100/1.0 + 300/0.5. An estimate equal to the total would mean the sample rate was
	// ignored, which is the failure that silently under-reports a sampled Project.
	if amount.Estimated != 700 {
		t.Fatalf("amount estimate is %v, want 700", amount.Estimated)
	}
	if amount.Average != 200 || amount.Minimum != 100 || amount.Maximum != 300 {
		t.Fatalf("amount avg/min/max are %v/%v/%v, want 200/100/300",
			amount.Average, amount.Minimum, amount.Maximum)
	}

	filters.Measurement = "amount"
	filters.Dimension = "property:payment"
	breakdown, err := repository.measurementBreakdown(ctx, filters)
	if err != nil {
		t.Fatal(err)
	}
	// Zipped arrays would pair the first measurement with the first dimension only, so a
	// broken cross product loses one of these two rows.
	totals := map[string]float64{}
	for _, row := range breakdown {
		totals[row.Value] = row.Total
	}
	if totals["card"] != 100 || totals["wallet"] != 300 || len(breakdown) != 2 {
		t.Fatalf("payment breakdown is %+v, want card=100 and wallet=300", breakdown)
	}
}

func measurementFixture(
	project uuid.UUID,
	eventType, name string,
	at time.Time,
	sampleRate float64,
	attributes, measurements string,
) string {
	return fmt.Sprintf(`{"project_id":%q,"event_id":%q,"event_type":%q,"timestamp":%q,`+
		`"received_at":%q,"environment":"production","session_id":%q,"anonymous_user_id":"visitor",`+
		`"custom_name":%q,"sample_rate":%v,"country":"US","device_type":"desktop","browser":"Chrome",`+
		`"referrer":"","attributes":%s,"measurements":%s,"ingest_flags":[]}`,
		project, uuid.New(), eventType, at.Format("2006-01-02 15:04:05.000"),
		at.Format("2006-01-02 15:04:05.000"), uuid.New(), name, sampleRate, attributes, measurements)
}
