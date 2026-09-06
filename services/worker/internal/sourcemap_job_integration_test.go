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
