//go:build integration

package internal

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"openrum/internal/metadata"
	"openrum/internal/migrate"
	"openrum/migrations"
)

func TestRetentionCleanupJobIsIdempotentAndObservable(t *testing.T) {
	postgresDSN, clickHouseDSN := os.Getenv("TEST_POSTGRES_DSN"), os.Getenv("TEST_CLICKHOUSE_DSN")
	if postgresDSN == "" || clickHouseDSN == "" {
		t.Skip("TEST_POSTGRES_DSN and TEST_CLICKHOUSE_DSN are required")
	}
	if !strings.HasSuffix(strings.Split(postgresDSN, "?")[0], "_test") || !strings.HasSuffix(strings.Split(clickHouseDSN, "?")[0], "_test") {
		t.Fatal("refusing retention integration test outside *_test databases")
	}
	ctx, cancel := context.WithTimeout(t.Context(), 90*time.Second)
	defer cancel()
	postgres, err := metadata.OpenPostgres(ctx, postgresDSN)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = postgres.Close() })
	clickHouse, err := migrate.OpenClickHouse(clickHouseDSN)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = clickHouse.Close() })
	if err := migrate.PostgresUp(ctx, postgres, migrations.Files); err != nil {
		t.Fatal(err)
	}
	if err := migrate.ClickHouseUp(ctx, clickHouse, migrations.Files); err != nil {
		t.Fatal(err)
	}

	ownerID, organizationID, projectID := uuid.New(), uuid.New(), uuid.New()
	if _, err := postgres.ExecContext(ctx, `INSERT INTO users (id,email,display_name,password_hash)
		VALUES ($1,$2,'Retention Owner','hash')`, ownerID, ownerID.String()+"@example.test"); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.ExecContext(ctx, `INSERT INTO organizations (id,name,slug,created_by)
		VALUES ($1,'Retention Org',$2,$3)`, organizationID, "retention-"+organizationID.String(), ownerID); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.ExecContext(ctx, `INSERT INTO projects (id,organization_id,name,slug,retention_days)
		VALUES ($1,$2,'Retention Project',$3,1)`, projectID, organizationID, "retention-"+projectID.String()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		for _, table := range []string{"behavior_metrics_1m_local", "project_metrics_1m_local", "rum_events_local"} {
			_, _ = clickHouse.ExecContext(context.Background(),
				"ALTER TABLE "+table+" DELETE WHERE project_id=? SETTINGS mutations_sync=2", projectID)
		}
		_, _ = postgres.ExecContext(context.Background(), "DELETE FROM organizations WHERE id=$1", organizationID)
		_, _ = postgres.ExecContext(context.Background(), "DELETE FROM users WHERE id=$1", ownerID)
	})

	now := time.Now().UTC().Truncate(time.Second)
	oldTimestamp, recentTimestamp := now.Add(-48*time.Hour), now
	for _, timestamp := range []time.Time{oldTimestamp, recentTimestamp} {
		if _, err := clickHouse.ExecContext(ctx, `INSERT INTO rum_events_local
			(project_id,event_id,event_type,timestamp,received_at,raw_expires_at,aggregate_expires_at,
			session_id,page_id,country,environment,sample_rate)
			VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, projectID, uuid.New(), "page_view", timestamp, timestamp,
			timestamp.Add(14*24*time.Hour), timestamp.Add(90*24*time.Hour), uuid.New(), uuid.New(), "ZZ", "test", 1); err != nil {
			t.Fatal(err)
		}
	}

	months := map[int]uint64{}
	for _, timestamp := range []time.Time{oldTimestamp, recentTimestamp} {
		months[timestamp.Year()*100+int(timestamp.Month())]++
	}
	plan := metadata.RetentionPlan{ProjectID: projectID, RawDays: 1, AggregateDays: 90, AffectedRows: 2, DeleteRows: 1}
	for month, rows := range months {
		deletes := uint64(0)
		if month == oldTimestamp.Year()*100+int(oldTimestamp.Month()) {
			deletes = 1
		}
		plan.Steps = append(plan.Steps, metadata.RetentionPlanStep{
			Table: "rum_events_local", TimeColumn: "timestamp", Month: month, RetentionDays: 1,
			AffectedRows: rows, DeleteRows: deletes,
		})
	}
	repository := metadata.NewMaintenanceJobRepository(postgres)
	preview, err := repository.CreateRetentionPreview(ctx, ownerID, plan)
	if err != nil || strings.Contains(preview.Token, ownerID.String()) {
		t.Fatalf("preview token=%q err=%v", preview.Token, err)
	}
	job, err := repository.CreateRetentionJob(ctx, ownerID, preview.Token)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repository.CreateRetentionJob(ctx, ownerID, preview.Token); !errors.Is(err, metadata.ErrInvalidPreviewToken) {
		t.Fatalf("reused preview error=%v", err)
	}
	cleanup := NewRetentionCleanupJob(repository, NewClickHouseRetentionCleaner(clickHouse))
	for range len(plan.Steps) {
		if _, err := postgres.ExecContext(ctx, "UPDATE maintenance_jobs SET next_attempt_at=now() WHERE id=$1", job.ID); err != nil {
			t.Fatal(err)
		}
		if _, err := postgres.ExecContext(ctx, "UPDATE maintenance_job_steps SET updated_at=now()-interval '6 seconds' WHERE job_id=$1 AND status='completed'", job.ID); err != nil {
			t.Fatal(err)
		}
		processed, err := cleanup.RunOne(ctx)
		if err != nil || !processed {
			t.Fatalf("cleanup processed=%v err=%v", processed, err)
		}
	}
	// A completed step can be retried safely at the ClickHouse layer without changing the result.
	for _, step := range plan.Steps {
		if err := NewClickHouseRetentionCleaner(clickHouse).Apply(ctx, metadata.MaintenanceStep{
			ProjectID: projectID, Table: step.Table, TimeColumn: step.TimeColumn, Month: step.Month, RetentionDays: step.RetentionDays,
		}); err != nil {
			t.Fatalf("idempotent replay: %v", err)
		}
	}

	var oldRows, recentRows uint64
	if err := clickHouse.QueryRowContext(ctx, "SELECT count() FROM rum_events_local WHERE project_id=? AND timestamp=?", projectID, oldTimestamp).Scan(&oldRows); err != nil {
		t.Fatal(err)
	}
	if err := clickHouse.QueryRowContext(ctx, "SELECT count() FROM rum_events_local WHERE project_id=? AND timestamp=?", projectID, recentTimestamp).Scan(&recentRows); err != nil {
		t.Fatal(err)
	}
	if oldRows != 0 || recentRows != 1 {
		t.Fatalf("old rows=%d recent rows=%d", oldRows, recentRows)
	}
	var expiry time.Time
	if err := clickHouse.QueryRowContext(ctx, "SELECT raw_expires_at FROM rum_events_local WHERE project_id=?", projectID).Scan(&expiry); err != nil {
		t.Fatal(err)
	}
	if !expiry.Equal(recentTimestamp.Add(24 * time.Hour)) {
		t.Fatalf("expiry=%s want=%s", expiry, recentTimestamp.Add(24*time.Hour))
	}
	jobs, err := repository.List(ctx, 10)
	if err != nil {
		t.Fatal(err)
	}
	for _, current := range jobs {
		if current.ID == job.ID {
			if current.Status != "completed" || current.CompletedSteps != current.TotalSteps {
				t.Fatalf("job=%+v", current)
			}
			var audits int
			if err := postgres.QueryRowContext(ctx, `SELECT count(*) FROM audit_logs WHERE resource_id=$1
				AND action IN ('instance.retention_cleanup_requested','instance.retention_cleanup_completed')`, job.ID).Scan(&audits); err != nil || audits != 2 {
				t.Fatalf("retention audits=%d err=%v", audits, err)
			}
			return
		}
	}
	t.Fatal("completed maintenance job was not observable")
}
