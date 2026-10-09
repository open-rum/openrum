//go:build integration

package internal

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"openrum/internal/migrate"
	"openrum/internal/sourcemap"
	"openrum/migrations"
)

func TestClickHouseMappingsClaimsAndPersistsEvent(t *testing.T) {
	dsn := os.Getenv("TEST_CLICKHOUSE_DSN")
	if dsn == "" {
		t.Skip("TEST_CLICKHOUSE_DSN is not set")
	}
	if !strings.Contains(dsn, "openrum_test") {
		t.Fatalf("refusing integration test against non-test ClickHouse")
	}
	database, err := migrate.OpenClickHouse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = database.Close() }()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if err := migrate.ClickHouseUp(ctx, database, migrations.Files); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"rum_events_local", "event_stack_mappings_local"} {
		if _, err := database.ExecContext(ctx, "TRUNCATE TABLE "+table); err != nil {
			t.Fatal(err)
		}
	}
	projectID, eventID := uuid.New(), uuid.New()
	now := time.Now().UTC().Truncate(time.Millisecond)
	if _, err := database.ExecContext(ctx, `INSERT INTO rum_events
(project_id,event_id,event_type,timestamp,received_at,release,dist,error_stack)
VALUES (?,?,?,?,?,?,?,?)`, projectID, eventID, "error", now, now, "web@1", "browser", "at run (https://cdn.example/app.js:1:0)"); err != nil {
		t.Fatal(err)
	}
	repository := NewClickHouseMappings(database)
	pending, err := repository.NextBatch(ctx, 10)
	if err != nil || len(pending) != 1 || pending[0].EventID != eventID {
		t.Fatalf("pending=%+v err=%v", pending, err)
	}
	if err := repository.Save(ctx, pending[0], sourcemap.MappedStack{Raw: pending[0].Stack, Status: "failed", Failure: sourcemap.FailureMissingArtifact}); err != nil {
		t.Fatal(err)
	}
	pending, err = repository.NextBatch(ctx, 10)
	if err != nil || len(pending) != 0 {
		t.Fatalf("pending after save=%+v err=%v", pending, err)
	}
}

func TestClickHouseMappingsRemapCandidatesAndBatchSave(t *testing.T) {
	dsn := os.Getenv("TEST_CLICKHOUSE_DSN")
	if dsn == "" {
		t.Skip("TEST_CLICKHOUSE_DSN is not set")
	}
	if !strings.Contains(dsn, "openrum_test") {
		t.Fatalf("refusing integration test against non-test ClickHouse")
	}
	database, err := migrate.OpenClickHouse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = database.Close() }()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := migrate.ClickHouseUp(ctx, database, migrations.Files); err != nil {
		t.Fatal(err)
	}
	projectID := uuid.New()
	now := time.Now().UTC().Truncate(time.Millisecond)
	failed, mapped, stale, otherRelease := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	for _, row := range []struct {
		id      uuid.UUID
		release string
		at      time.Time
	}{
		{failed, "web@1", now}, {mapped, "web@1", now}, {stale, "web@1", now.Add(-8 * 24 * time.Hour)}, {otherRelease, "web@2", now},
	} {
		if _, err := database.ExecContext(ctx, `INSERT INTO rum_events
(project_id,event_id,event_type,timestamp,received_at,release,dist,error_stack)
VALUES (?,?,?,?,?,?,?,?)`, projectID, row.id, "error", row.at, now, row.release, "browser", "at run (https://cdn.example/app.js:1:0)"); err != nil {
			t.Fatal(err)
		}
	}
	repository := NewClickHouseMappings(database)
	earlier := sourcemap.MappedStack{Status: "failed", Failure: sourcemap.FailureMissingArtifact}
	if err := repository.SaveBatch(ctx, []MappedEvent{
		{Event: PendingEvent{ProjectID: projectID, EventID: failed}, Mapped: earlier},
		{Event: PendingEvent{ProjectID: projectID, EventID: mapped}, Mapped: sourcemap.MappedStack{Status: "mapped"}},
	}); err != nil {
		t.Fatal(err)
	}
	candidates, err := repository.RemapCandidates(ctx, projectID, "web@1", "browser", now.Add(-7*24*time.Hour), 2000)
	if err != nil || len(candidates) != 1 || candidates[0].EventID != failed {
		t.Fatalf("candidates=%+v err=%v", candidates, err)
	}
	time.Sleep(5 * time.Millisecond)
	if err := repository.SaveBatch(ctx, []MappedEvent{{Event: candidates[0], Mapped: sourcemap.MappedStack{Status: "mapped"}}}); err != nil {
		t.Fatal(err)
	}
	candidates, err = repository.RemapCandidates(ctx, projectID, "web@1", "browser", now.Add(-7*24*time.Hour), 2000)
	if err != nil || len(candidates) != 0 {
		t.Fatalf("candidates after remap=%+v err=%v", candidates, err)
	}
}
