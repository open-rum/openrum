//go:build integration

package metadata

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestEmergencyCleanupRepositoryClaimsAndCompletesJob(t *testing.T) {
	database := openIntegrationDatabase(t)
	ctx, cancel := context.WithTimeout(t.Context(), 20*time.Second)
	defer cancel()

	actorID, organizationID, projectID := uuid.New(), uuid.New(), uuid.New()
	mustExecDatabase(t, ctx, database,
		"INSERT INTO users (id,email,display_name,password_hash) VALUES ($1,$2,'Cleanup Owner','hash')",
		actorID, "cleanup-"+actorID.String()+"@example.test")
	mustExecDatabase(t, ctx, database,
		"INSERT INTO organizations (id,name,slug,created_by) VALUES ($1,'Cleanup Org',$2,$3)",
		organizationID, "cleanup-"+organizationID.String(), actorID)
	mustExecDatabase(t, ctx, database,
		"INSERT INTO projects (id,organization_id,name,slug) VALUES ($1,$2,'Cleanup Project',$3)",
		projectID, organizationID, "cleanup-"+projectID.String())

	repository := NewEmergencyCleanupRepository(database)
	protectedAfter := time.Date(2026, time.September, 15, 0, 0, 0, 0, time.UTC)
	preview, err := repository.CreatePreview(ctx, actorID, EmergencyCleanupPlan{
		UsedBytes:             96,
		CapacityBytes:         100,
		EstimatedReleaseBytes: 12,
		ProjectedUsedBytes:    84,
		TargetUsedPercent:     85,
		ProtectedAfter:        protectedAfter,
		CanReachTarget:        true,
		Steps: []EmergencyCleanupStep{{
			ProjectID:      projectID,
			ProjectName:    "Cleanup Project",
			Table:          "rum_events_local",
			Month:          202608,
			PartitionID:    "0123456789abcdef0123456789abcdef",
			AffectedRows:   100,
			EstimatedBytes: 12,
			OldestAt:       time.Date(2026, time.August, 1, 0, 0, 0, 0, time.UTC),
			NewestAt:       time.Date(2026, time.August, 31, 23, 0, 0, 0, time.UTC),
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	job, err := repository.CreateJob(ctx, actorID, preview.Token)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = database.ExecContext(context.Background(), "DELETE FROM emergency_cleanup_jobs WHERE id=$1", job.ID)
		_, _ = database.ExecContext(context.Background(), "DELETE FROM organizations WHERE id=$1", organizationID)
		_, _ = database.ExecContext(context.Background(), "DELETE FROM users WHERE id=$1", actorID)
	})

	step, found, err := repository.ClaimStep(ctx)
	if err != nil || !found || step.JobID != job.ID || step.Attempts != 1 {
		t.Fatalf("found=%v step=%+v err=%v", found, step, err)
	}
	if err := repository.CompleteStep(ctx, step); err != nil {
		t.Fatal(err)
	}
	latest, found, err := repository.Latest(ctx)
	if err != nil || !found || latest.ID != job.ID || latest.Status != "completed" || latest.CompletedSteps != 1 {
		t.Fatalf("found=%v latest=%+v err=%v", found, latest, err)
	}
}
