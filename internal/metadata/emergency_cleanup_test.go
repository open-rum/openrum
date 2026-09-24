package metadata

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestValidateEmergencyCleanupPlanRequiresClosedCalendarMonth(t *testing.T) {
	protectedAfter := time.Date(2026, time.September, 15, 0, 0, 0, 0, time.UTC)
	plan := EmergencyCleanupPlan{
		UsedBytes:             96,
		CapacityBytes:         100,
		EstimatedReleaseBytes: 12,
		ProjectedUsedBytes:    84,
		TargetUsedPercent:     85,
		ProtectedAfter:        protectedAfter,
		CanReachTarget:        true,
		Steps: []EmergencyCleanupStep{{
			ProjectID:      uuid.New(),
			ProjectName:    "Storefront",
			Table:          "rum_events_local",
			Month:          202608,
			PartitionID:    "0123456789abcdef0123456789abcdef",
			AffectedRows:   100,
			EstimatedBytes: 12,
			OldestAt:       time.Date(2026, time.August, 1, 0, 0, 0, 0, time.UTC),
			NewestAt:       time.Date(2026, time.August, 31, 23, 0, 0, 0, time.UTC),
		}},
	}
	if err := validateEmergencyCleanupPlan(plan); err != nil {
		t.Fatalf("closed month should be valid: %v", err)
	}

	plan.Steps[0].Month = 202609
	plan.Steps[0].OldestAt = time.Date(2026, time.September, 1, 0, 0, 0, 0, time.UTC)
	plan.Steps[0].NewestAt = time.Date(2026, time.September, 10, 0, 0, 0, 0, time.UTC)
	if err := validateEmergencyCleanupPlan(plan); err == nil {
		t.Fatal("open calendar month should be rejected even when its current data is older than the protected boundary")
	}
}
