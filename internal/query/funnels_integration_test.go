//go:build integration

package query

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"openrum/internal/migrate"
	"openrum/migrations"
)

func TestFunnelQueryReconcilesKnownSessions(t *testing.T) {
	database := openClickHouseIntegrationDatabase(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := migrate.ClickHouseUp(ctx, database, migrations.Files); err != nil {
		t.Fatal(err)
	}
	projectID := uuid.New()
	// Relative to now: raw events expire after 14 days, so a fixed date ages out of rum_events.
	from := time.Now().UTC().Truncate(time.Hour).Add(-24 * time.Hour)
	insert := func(sessionID uuid.UUID, country string, offset int, eventType, navigation, customName string) {
		at := from.Add(time.Duration(offset) * time.Minute)
		_, err := database.ExecContext(ctx, `INSERT INTO rum_events
			(project_id,event_id,event_type,timestamp,received_at,environment,session_id,anonymous_user_id,page_id,
			navigation_type,sample_rate,country,custom_name,attributes,ingest_flags)
			VALUES (?,?,?,?,?,'production',?,?,?, ?,1,?,?,map(),[])`,
			projectID, uuid.New(), eventType, at, at, sessionID, "visitor-"+sessionID.String(), uuid.New(), navigation, country, customName)
		if err != nil {
			t.Fatal(err)
		}
	}
	sessionA, sessionB, sessionC, wrongOrder := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	insert(sessionA, "CN", 1, "page_view", "navigate", "")
	insert(sessionA, "CN", 2, "custom", "", "ui.click")
	insert(sessionA, "CN", 3, "custom", "", "checkout_started")
	insert(sessionB, "US", 4, "page_view", "navigate", "")
	insert(sessionB, "US", 5, "custom", "", "ui.click")
	insert(sessionC, "CN", 6, "page_view", "navigate", "")
	insert(wrongOrder, "JP", 7, "custom", "", "ui.click")
	insert(wrongOrder, "JP", 8, "page_view", "navigate", "")

	result, err := NewFunnelRepository(database).Query(ctx, FunnelQuery{
		ProjectID: projectID, From: from, To: from.Add(time.Hour), Environment: "production", Dimension: "country", WindowSeconds: 3600,
		Steps: []FunnelStep{{Kind: "page_view"}, {Kind: "click"}, {Kind: "custom", Name: "checkout_started"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Steps) != 3 || result.Steps[0].Sessions != 4 || result.Steps[1].Sessions != 2 || result.Steps[2].Sessions != 1 {
		t.Fatalf("steps=%+v", result.Steps)
	}
	if result.Identity != "session_id" || !result.Approximate || len(result.Breakdown) != 3 || len(result.Samples) != 4 {
		t.Fatalf("result=%+v", result)
	}
}
