//go:build integration

package internal

import (
	"context"
	"database/sql"
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

type integrationObjectDeleter struct{ keys []string }

func (deleter *integrationObjectDeleter) Delete(_ context.Context, key string) error {
	deleter.keys = append(deleter.keys, key)
	return nil
}

func TestProjectDeletionLeavesNoQueryableData(t *testing.T) {
	postgresDSN, clickHouseDSN := os.Getenv("TEST_POSTGRES_DSN"), os.Getenv("TEST_CLICKHOUSE_DSN")
	if postgresDSN == "" || clickHouseDSN == "" {
		t.Skip("TEST_POSTGRES_DSN and TEST_CLICKHOUSE_DSN are required")
	}
	if !strings.Contains(postgresDSN, "openrum_test") || !strings.Contains(clickHouseDSN, "openrum_test") {
		t.Fatal("refusing project deletion integration test outside openrum_test databases")
	}
	ctx, cancel := context.WithTimeout(t.Context(), 90*time.Second)
	defer cancel()
	postgres, err := metadata.OpenPostgres(ctx, postgresDSN)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = postgres.Close() }()
	clickHouse, err := migrate.OpenClickHouse(clickHouseDSN)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = clickHouse.Close() }()
	if err := migrate.PostgresUp(ctx, postgres, migrations.Files); err != nil {
		t.Fatal(err)
	}
	if err := migrate.ClickHouseUp(ctx, clickHouse, migrations.Files); err != nil {
		t.Fatal(err)
	}

	ownerID, organizationID := uuid.New(), uuid.New()
	if _, err := postgres.ExecContext(ctx, `INSERT INTO users (id,email,display_name,password_hash) VALUES ($1,$2,'Deletion Owner','hash')`, ownerID, ownerID.String()+"@example.test"); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.ExecContext(ctx, `INSERT INTO organizations (id,name,slug,created_by) VALUES ($1,'Deletion Org',$2,$3)`, organizationID, "delete-"+organizationID.String(), ownerID); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.ExecContext(ctx, `INSERT INTO organization_members (organization_id,user_id,role) VALUES ($1,$2,'owner')`, organizationID, ownerID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = postgres.ExecContext(context.Background(), "DELETE FROM organizations WHERE id=$1", organizationID)
		_, _ = postgres.ExecContext(context.Background(), "DELETE FROM users WHERE id=$1", ownerID)
	})

	projects := metadata.NewProjectRepository(postgres)
	project, _, err := projects.CreateWithKey(ctx, ownerID, metadata.CreateProjectInput{
		OrganizationID: organizationID, Name: "Delete Me", Slug: "delete-me", AllowedOrigins: []string{"https://delete.example"},
		Environment: "production", RetentionDays: 14, EventSampleRate: 1, APISampleRate: 0.2, ErrorSampleRate: 1,
	}, "Default")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	if _, err := clickHouse.ExecContext(ctx, `INSERT INTO rum_events
		(project_id,event_id,event_type,timestamp,received_at,environment,custom_name)
		VALUES (?,?,?,?,?,?,?)`, project.ID, uuid.New(), "custom", now, now, "production", "delete_probe"); err != nil {
		t.Fatal(err)
	}

	if err := projects.RequestDeletion(ctx, ownerID, project.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := projects.GetForUser(ctx, ownerID, project.ID); !errors.Is(err, metadata.ErrNotFound) {
		t.Fatalf("deleting project remains queryable: %v", err)
	}
	var activeKeys int
	if err := postgres.QueryRowContext(ctx, "SELECT count(*) FROM project_keys WHERE project_id=$1 AND revoked_at IS NULL", project.ID).Scan(&activeKeys); err != nil || activeKeys != 0 {
		t.Fatalf("active keys=%d err=%v", activeKeys, err)
	}

	objects := &integrationObjectDeleter{}
	store := NewPostgresProjectDeletionStore(postgres)
	store.confirmationDelay = 100 * time.Millisecond
	job := NewProjectDeletionJob(store, NewClickHouseProjectDeleter(clickHouse), objects)
	processed, err := job.RunOne(ctx)
	if err != nil || !processed {
		t.Fatalf("processed=%v err=%v", processed, err)
	}
	// Simulate a distributed/Kafka event arriving after the first cleanup pass.
	if _, err := clickHouse.ExecContext(ctx, `INSERT INTO rum_events_local
		(project_id,event_id,event_type,timestamp,received_at,environment,custom_name)
		VALUES (?,?,?,?,?,?,?)`, project.ID, uuid.New(), "custom", now, now, "production", "late_delete_probe"); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.ExecContext(ctx, "UPDATE project_deletions SET next_attempt_at=now() WHERE project_id=$1", project.ID); err != nil {
		t.Fatal(err)
	}
	processed, err = job.RunOne(ctx)
	if err != nil || !processed {
		t.Fatalf("late cleanup processed=%v err=%v", processed, err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		time.Sleep(150 * time.Millisecond)
		if _, err := postgres.ExecContext(ctx, "UPDATE project_deletions SET next_attempt_at=now() WHERE project_id=$1", project.ID); err != nil {
			t.Fatal(err)
		}
		processed, err = job.RunOne(ctx)
		if err != nil || !processed {
			t.Fatalf("confirmation processed=%v err=%v", processed, err)
		}
		var currentStatus string
		if err := postgres.QueryRowContext(ctx, "SELECT status FROM project_deletions WHERE project_id=$1", project.ID).Scan(&currentStatus); err != nil {
			t.Fatal(err)
		}
		if currentStatus == "completed" {
			break
		}
	}
	remaining, err := NewClickHouseProjectDeleter(clickHouse).CountProject(ctx, project.ID)
	if err != nil || remaining != 0 {
		t.Fatalf("remaining analytics rows=%d err=%v", remaining, err)
	}
	var status string
	var completedAt sql.NullTime
	if err := postgres.QueryRowContext(ctx, "SELECT status,completed_at FROM project_deletions WHERE project_id=$1", project.ID).Scan(&status, &completedAt); err != nil || status != "completed" || !completedAt.Valid {
		t.Fatalf("deletion status=%q completed=%v err=%v", status, completedAt.Valid, err)
	}
	var audits int
	if err := postgres.QueryRowContext(ctx, `SELECT count(*) FROM audit_logs WHERE resource_id=$1
		AND action IN ('project.deletion_requested','project.deletion_completed')`, project.ID).Scan(&audits); err != nil || audits != 2 {
		t.Fatalf("deletion audits=%d err=%v", audits, err)
	}
}
