package query

import (
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestNormalizeBehaviorFiltersDefaultsAndBoundsDimension(t *testing.T) {
	to := time.Date(2026, 9, 3, 12, 0, 0, 0, time.UTC)
	filters, err := NormalizeBehaviorFilters(BehaviorFilters{ProjectID: uuid.New(), From: to.Add(-time.Hour), To: to})
	if err != nil || filters.Dimension != "country" {
		t.Fatalf("filters=%+v err=%v", filters, err)
	}
	for _, dimension := range []string{"country", "device", "browser", "source", "property:plan.name"} {
		if _, err := NormalizeBehaviorFilters(BehaviorFilters{ProjectID: uuid.New(), From: to.Add(-time.Hour), To: to, Dimension: dimension}); err != nil {
			t.Errorf("dimension %q rejected: %v", dimension, err)
		}
	}
	for _, dimension := range []string{"route", "property:", "property:bad key", "property:value') OR 1=1--"} {
		if _, err := NormalizeBehaviorFilters(BehaviorFilters{ProjectID: uuid.New(), From: to.Add(-time.Hour), To: to, Dimension: dimension}); !errors.Is(err, ErrInvalidBehaviorFilters) {
			t.Errorf("dimension %q error=%v", dimension, err)
		}
	}
}

func TestBehaviorBudgetRejectsBroadAndHighCardinalityQueriesPredictably(t *testing.T) {
	to := time.Date(2026, 9, 3, 12, 0, 0, 0, time.UTC)
	base := BehaviorFilters{ProjectID: uuid.New(), From: to.Add(-8 * 24 * time.Hour), To: to, Dimension: "country"}
	if err := CheckBehaviorBudget(base); !errors.Is(err, ErrBehaviorQueryTooExpensive) {
		t.Fatalf("broad query error=%v", err)
	}
	base.From = to.Add(-24 * time.Hour)
	base.Dimension = "property:campaign"
	if err := CheckBehaviorBudget(base); err != nil {
		t.Fatalf("bounded property query rejected: %v", err)
	}
	base.From = to.Add(-48 * time.Hour)
	if err := CheckBehaviorBudget(base); !errors.Is(err, ErrBehaviorQueryTooExpensive) {
		t.Fatalf("wide property query error=%v", err)
	}
	base.EventName = "signup"
	if err := CheckBehaviorBudget(base); err != nil {
		t.Fatalf("filtered property query rejected: %v", err)
	}
}

func TestBehaviorFreshness(t *testing.T) {
	now := time.Date(2026, 9, 3, 12, 0, 0, 0, time.UTC)
	latest := now.Add(-3 * time.Minute)
	result := behaviorFreshness(&latest, now)
	if result.AgeSeconds == nil || *result.AgeSeconds != 180 || !result.Stale {
		t.Fatalf("freshness=%+v", result)
	}
}

func TestBehaviorCountryBudgetFitsWorldMap(t *testing.T) {
	if got := behaviorDimensionLimit("country"); got != 250 {
		t.Fatalf("country row limit=%d", got)
	}
	for _, dimension := range []string{"device", "browser", "source", "property:plan"} {
		if got := behaviorDimensionLimit(dimension); got != 100 {
			t.Fatalf("%s row limit=%d", dimension, got)
		}
	}
}
