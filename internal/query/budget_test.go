package query

import (
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestOverviewBudgetRejectsWideUnfilteredQuery(t *testing.T) {
	to := time.Date(2026, 9, 2, 12, 0, 0, 0, time.UTC)
	filters := OverviewFilters{ProjectID: uuid.New(), From: to.Add(-30 * 24 * time.Hour), To: to}
	if err := DefaultOverviewBudget().Check(filters); !errors.Is(err, ErrQueryTooExpensive) {
		t.Fatalf("error=%v", err)
	}
	filters.Environment = "production"
	if err := DefaultOverviewBudget().Check(filters); err != nil {
		t.Fatalf("filtered query error=%v", err)
	}
}

func TestOverviewBudgetPreservesValidationErrors(t *testing.T) {
	if err := DefaultOverviewBudget().Check(OverviewFilters{}); !errors.Is(err, ErrInvalidOverviewFilters) {
		t.Fatalf("error=%v", err)
	}
}
