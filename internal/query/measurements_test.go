package query

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func measurementFilters(measurement, dimension string) BehaviorFilters {
	from := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	return BehaviorFilters{
		ProjectID: uuid.New(), From: from, To: from.Add(24 * time.Hour),
		Dimension: dimension, Measurement: measurement,
	}
}

func TestValidMeasurementName(t *testing.T) {
	for _, name := range []string{"amount", "order_value", "a", "items.count", "v-2"} {
		if !ValidMeasurementName(name) {
			t.Fatalf("%q was rejected", name)
		}
	}
	// Leading digits, empty names and anything that could reach the SQL text are refused:
	// the name is concatenated into no query, but the pattern is the storage rule and a
	// value outside it can only ever match zero rows.
	for _, name := range []string{"", "1amount", "amount price", "amount'", "amount;drop", string(make([]byte, 65))} {
		if ValidMeasurementName(name) {
			t.Fatalf("%q was accepted", name)
		}
	}
}

func TestNormalizeBehaviorFiltersAcceptsMeasurementOnARealDimension(t *testing.T) {
	for _, dimension := range []string{"country", "device", "browser", "source", "property:plan"} {
		if _, err := NormalizeBehaviorFilters(measurementFilters("amount", dimension)); err != nil {
			t.Fatalf("dimension %q with a measurement was rejected: %v", dimension, err)
		}
	}
}

func TestNormalizeBehaviorFiltersRejectsUnusableMeasurementBreakdown(t *testing.T) {
	// A malformed key cannot be served, and neither can a breakdown with no dimension to
	// split on — the summary already answers that question.
	if _, err := NormalizeBehaviorFilters(measurementFilters("1bad", "country")); err == nil {
		t.Fatal("a malformed measurement name was accepted")
	}
	if _, err := NormalizeBehaviorFilters(measurementFilters("amount", "all")); err == nil {
		t.Fatal("a breakdown against the `all` dimension was accepted")
	}
}

func TestMeasurementSummaryStillWorksWithoutABreakdown(t *testing.T) {
	filters := measurementFilters("", "country")
	normalized, err := NormalizeBehaviorFilters(filters)
	if err != nil {
		t.Fatal(err)
	}
	if normalized.Measurement != "" {
		t.Fatalf("Measurement is %q, want it left empty", normalized.Measurement)
	}
}

func TestMeasurementBreakdownIsCharged(t *testing.T) {
	// A breakdown scans a second aggregate, so it has to cost more than the same query
	// without one. Otherwise the cheapest way to widen a range would be to add one.
	// Seven days is exactly the behavior budget, so the plain query is the most
	// expensive one that is still allowed and any surcharge has to push it over.
	plain := measurementFilters("", "country")
	plain.To = plain.From.Add(7 * 24 * time.Hour)
	withBreakdown := plain
	withBreakdown.Measurement = "amount"

	if err := CheckBehaviorBudget(plain); err != nil {
		t.Fatalf("the plain query was rejected: %v", err)
	}
	if err := CheckBehaviorBudget(withBreakdown); err == nil {
		t.Fatal("adding a breakdown to a range at the budget edge stayed free")
	}
}

func TestMeasurementAverageHasNoNaN(t *testing.T) {
	// A key with no samples must serialize as 0, not NaN: NaN becomes `null` in JSON and
	// makes every caller handle a case that only means "nothing here".
	if got := measurementAverage(0, 0); got != 0 {
		t.Fatalf("average of nothing is %v, want 0", got)
	}
	if got := measurementAverage(400, 2); got != 200 {
		t.Fatalf("average is %v, want 200", got)
	}
}
