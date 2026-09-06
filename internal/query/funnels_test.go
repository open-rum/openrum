package query

import (
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestNormalizeFunnelQueryAppliesSafeDefaults(t *testing.T) {
	to := time.Date(2026, 9, 3, 12, 0, 0, 0, time.UTC)
	result, err := NormalizeFunnelQuery(FunnelQuery{
		ProjectID: uuid.New(), From: to.Add(-time.Hour), To: to, WindowSeconds: 3600,
		Steps: []FunnelStep{{Kind: "page_view"}, {Kind: "custom", Name: "checkout_started"}},
	})
	if err != nil || result.Dimension != "country" || result.Steps[0].Name != "page_view" {
		t.Fatalf("result=%+v err=%v", result, err)
	}
}

func TestNormalizeFunnelQueryRejectsInvalidStepsAndDimensions(t *testing.T) {
	to := time.Date(2026, 9, 3, 12, 0, 0, 0, time.UTC)
	base := FunnelQuery{ProjectID: uuid.New(), From: to.Add(-time.Hour), To: to, WindowSeconds: 3600,
		Steps: []FunnelStep{{Kind: "page_view"}, {Kind: "click"}}}
	checks := []FunnelQuery{
		{ProjectID: base.ProjectID, From: base.From, To: base.To, WindowSeconds: 3600, Steps: base.Steps[:1]},
		{ProjectID: base.ProjectID, From: base.From, To: base.To, WindowSeconds: 7, Steps: base.Steps},
		{ProjectID: base.ProjectID, From: base.From, To: base.To, WindowSeconds: 3600, Dimension: "property:bad key", Steps: base.Steps},
		{ProjectID: base.ProjectID, From: base.From, To: base.To, WindowSeconds: 3600, Steps: []FunnelStep{{Kind: "page_view"}, {Kind: "custom", Name: "ui.click"}}},
	}
	for index, input := range checks {
		if _, err := NormalizeFunnelQuery(input); !errors.Is(err, ErrInvalidFunnelQuery) {
			t.Errorf("check %d error=%v", index, err)
		}
	}
}

func TestFunnelBudgetRejectsBroadQueriesPredictably(t *testing.T) {
	to := time.Date(2026, 9, 3, 12, 0, 0, 0, time.UTC)
	input := FunnelQuery{ProjectID: uuid.New(), From: to.Add(-15 * 24 * time.Hour), To: to, WindowSeconds: 3600,
		Steps: []FunnelStep{{Kind: "page_view"}, {Kind: "click"}, {Kind: "custom", Name: "checkout_started"}}}
	if err := CheckFunnelBudget(input); !errors.Is(err, ErrFunnelQueryTooExpensive) {
		t.Fatalf("broad query error=%v", err)
	}
	input.From = to.Add(-24 * time.Hour)
	input.Dimension = "property:campaign"
	if err := CheckFunnelBudget(input); err != nil {
		t.Fatalf("bounded property query rejected: %v", err)
	}
	input.From = to.Add(-4 * 24 * time.Hour)
	if err := CheckFunnelBudget(input); !errors.Is(err, ErrFunnelQueryTooExpensive) {
		t.Fatalf("wide property query error=%v", err)
	}
}
