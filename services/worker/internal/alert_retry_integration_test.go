//go:build integration

package internal

import (
	"context"
	"database/sql"
	"errors"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"openrum/internal/metadata"
	"openrum/internal/migrate"
	"openrum/migrations"
)

// A breached window that no channel accepted is offered again on later ticks, at most
// maxDeliveryAttempts times, and never again once it was delivered.
func TestFailedAlertDeliveriesAreRetriedAFewTimes(t *testing.T) {
	dsn := os.Getenv("TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("TEST_POSTGRES_DSN is required")
	}
	parsed, err := url.Parse(dsn)
	if err != nil || !strings.HasSuffix(strings.TrimPrefix(parsed.Path, "/"), "_test") {
		t.Fatalf("refusing to run against %q", dsn)
	}
	database, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = database.Close() }()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := migrate.PostgresUp(ctx, database, migrations.Files); err != nil {
		t.Fatal(err)
	}
	reset := "TRUNCATE alert_deliveries, alert_evaluations, alert_rule_channels, alert_rules, notification_channels, projects, organization_members, organizations, users CASCADE"
	if _, err := database.ExecContext(ctx, reset); err != nil {
		t.Fatal(err)
	}
	defer func() { _, _ = database.ExecContext(context.WithoutCancel(ctx), reset) }()

	user, org, project, channel := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	rule := metadata.AlertRule{ID: uuid.New(), ProjectID: project, Name: "r", Metric: metadata.AlertErrorRate,
		Comparator: "gte", Threshold: 1, WindowMinutes: 5, CooldownMinutes: 30}
	for _, statement := range []struct {
		query     string
		arguments []any
	}{
		{"INSERT INTO users (id,email,display_name,password_hash) VALUES ($1,'retry@example.com','retry','hash')", []any{user}},
		{"INSERT INTO organizations (id,name,slug,created_by) VALUES ($1,'R','retry',$2)", []any{org, user}},
		{"INSERT INTO projects (id,organization_id,name,slug) VALUES ($1,$2,'R','retry')", []any{project, org}},
		{`INSERT INTO notification_channels (id,organization_id,name,kind,encrypted_config,encryption_key_id)
			VALUES ($1,$2,'f','feishu',decode(repeat('ab',40),'hex'),'k')`, []any{channel, org}},
		{`INSERT INTO alert_rules (id,project_id,name,metric,comparator,threshold,window_minutes,cooldown_minutes)
			VALUES ($1,$2,'r','error_rate','gte',1,5,30)`, []any{rule.ID, project}},
	} {
		if _, err := database.ExecContext(ctx, statement.query, statement.arguments...); err != nil {
			t.Fatal(err)
		}
	}
	store := NewPostgresAlertStore(database)
	end := time.Date(2026, 9, 29, 10, 0, 0, 0, time.UTC)
	window := AlertWindow{StartedAt: end.Add(-5 * time.Minute), EndedAt: end}
	value := 3.0
	breach := AlertEvaluation{RuleID: rule.ID, Window: window, Value: &value, Status: "breached"}

	if notify, err := store.Record(ctx, rule, breach); err != nil || !notify {
		t.Fatalf("a new breach is offered for delivery: %v %v", notify, err)
	}
	evaluation, err := store.EvaluationID(ctx, rule.ID, window)
	if err != nil {
		t.Fatal(err)
	}
	for attempt := 1; attempt <= maxDeliveryAttempts; attempt++ {
		if err := store.RecordDelivery(ctx, evaluation, rule.ID, channel, errors.New("down"), "network"); err != nil {
			t.Fatal(err)
		}
		notify, err := store.Record(ctx, rule, breach)
		if err != nil {
			t.Fatal(err)
		}
		if want := attempt < maxDeliveryAttempts; notify != want {
			t.Fatalf("after %d failed attempts notify=%v, want %v", attempt, notify, want)
		}
	}

	// A second window that succeeds on its first attempt is not offered again.
	next := AlertWindow{StartedAt: end, EndedAt: end.Add(5 * time.Minute)}
	second := AlertEvaluation{RuleID: rule.ID, Window: next, Value: &value, Status: "breached"}
	if notify, err := store.Record(ctx, rule, second); err != nil || !notify {
		t.Fatalf("the next window is offered: %v %v", notify, err)
	}
	if err := store.MarkNotified(ctx, rule.ID, next, next.EndedAt); err != nil {
		t.Fatal(err)
	}
	if notify, err := store.Record(ctx, rule, second); err != nil || notify {
		t.Fatalf("a delivered window is never offered again: %v %v", notify, err)
	}
}
