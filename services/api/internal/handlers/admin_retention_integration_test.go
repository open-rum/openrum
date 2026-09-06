//go:build integration

package handlers

import (
	"context"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"openrum/internal/migrate"
	"openrum/migrations"
)

func TestSQLRetentionPreviewSourceBuildsBoundedMonthlyPlan(t *testing.T) {
	dsn := os.Getenv("TEST_CLICKHOUSE_DSN")
	if dsn == "" {
		t.Skip("TEST_CLICKHOUSE_DSN is not set")
	}
	parsed, err := url.Parse(dsn)
	if err != nil || (parsed.Hostname() != "127.0.0.1" && parsed.Hostname() != "localhost" && parsed.Hostname() != "::1") ||
		!strings.HasSuffix(strings.TrimPrefix(parsed.Path, "/"), "_test") {
		t.Fatal("refusing retention preview integration test outside a local *_test database")
	}
	database, err := migrate.OpenClickHouse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	if err := migrate.ClickHouseUp(ctx, database, migrations.Files); err != nil {
		t.Fatal(err)
	}
	projectID := uuid.New()
	t.Cleanup(func() {
		for _, table := range []string{"behavior_metrics_1m_local", "project_metrics_1m_local", "rum_events_local"} {
			_, _ = database.ExecContext(context.Background(),
				"ALTER TABLE "+table+" DELETE WHERE project_id=? SETTINGS mutations_sync=2", projectID)
		}
	})
	timestamp := time.Now().UTC().Add(-10 * 24 * time.Hour).Truncate(time.Second)
	if _, err := database.ExecContext(ctx, `INSERT INTO rum_events_local
		(project_id,event_id,event_type,timestamp,received_at,raw_expires_at,aggregate_expires_at,
		session_id,page_id,country,environment,sample_rate)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, projectID, uuid.New(), "page_view", timestamp, timestamp,
		timestamp.Add(14*24*time.Hour), timestamp.Add(90*24*time.Hour), uuid.New(), uuid.New(), "ZZ", "test", 1); err != nil {
		t.Fatal(err)
	}
	plan, err := NewSQLRetentionPreviewSource(database).Plan(ctx, projectID, 7, 30)
	if err != nil {
		t.Fatal(err)
	}
	if plan.ProjectID != projectID || plan.RawDays != 7 || plan.AggregateDays != 30 ||
		plan.AffectedRows != 7 || plan.DeleteRows != 1 || len(plan.Steps) != 3 {
		t.Fatalf("plan=%+v", plan)
	}
	for _, step := range plan.Steps {
		if step.Month != timestamp.Year()*100+int(timestamp.Month()) || step.AffectedRows == 0 {
			t.Fatalf("step=%+v", step)
		}
	}
}
