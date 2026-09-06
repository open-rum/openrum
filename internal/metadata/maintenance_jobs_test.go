package metadata

import (
	"errors"
	"testing"

	"github.com/google/uuid"
)

func TestValidateRetentionPlanRequiresConsistentBoundedSteps(t *testing.T) {
	valid := RetentionPlan{
		ProjectID: uuid.New(), RawDays: 14, AggregateDays: 90, AffectedRows: 10, DeleteRows: 4,
		Steps: []RetentionPlanStep{{
			Table: "rum_events_local", TimeColumn: "timestamp", Month: 202609,
			RetentionDays: 14, AffectedRows: 10, DeleteRows: 4,
		}},
	}
	if err := validateRetentionPlan(valid); err != nil {
		t.Fatal(err)
	}
	invalidTotals := valid
	invalidTotals.AffectedRows++
	if err := validateRetentionPlan(invalidTotals); !errors.Is(err, ErrInvalidRetentionPlan) {
		t.Fatalf("invalid totals error=%v", err)
	}
	duplicate := valid
	duplicate.AffectedRows, duplicate.DeleteRows = 20, 8
	duplicate.Steps = append(append([]RetentionPlanStep(nil), valid.Steps...), valid.Steps[0])
	if err := validateRetentionPlan(duplicate); !errors.Is(err, ErrInvalidRetentionPlan) {
		t.Fatalf("duplicate error=%v", err)
	}
}
