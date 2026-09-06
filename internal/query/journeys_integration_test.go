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

func TestBoundedPathsAndWeeklyRetentionReconcileKnownFixtures(t *testing.T) {
	database := openClickHouseIntegrationDatabase(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := migrate.ClickHouseUp(ctx, database, migrations.Files); err != nil {
		t.Fatal(err)
	}
	pathProject := uuid.New()
	base := time.Date(2026, 10, 5, 8, 0, 0, 0, time.UTC)
	insertBehaviorFixture := func(projectID, sessionID uuid.UUID, user string, at time.Time, eventType, route, customName string) {
		_, err := database.ExecContext(ctx, `INSERT INTO rum_events
			(project_id,event_id,event_type,timestamp,received_at,environment,session_id,anonymous_user_id,page_id,
			page_url_normalized,route,navigation_type,sample_rate,custom_name,attributes,ingest_flags)
			VALUES (?,?,?,?,?,'production',?,?,?, ?,?,'navigate',1,?,map(),[])`,
			projectID, uuid.New(), eventType, at, at, sessionID, user, uuid.New(), route, route, customName)
		if err != nil {
			t.Fatal(err)
		}
	}
	for index := range 2 {
		sessionID := uuid.New()
		insertBehaviorFixture(pathProject, sessionID, "path-user-"+string(rune('a'+index)), base.Add(time.Duration(index)*time.Minute), "page_view", "/home", "")
		insertBehaviorFixture(pathProject, sessionID, "path-user-"+string(rune('a'+index)), base.Add(time.Duration(index)*time.Minute+time.Second), "custom", "", "ui.click")
		insertBehaviorFixture(pathProject, sessionID, "path-user-"+string(rune('a'+index)), base.Add(time.Duration(index)*time.Minute+2*time.Second), "custom", "", "checkout_started")
	}
	otherSession := uuid.New()
	insertBehaviorFixture(pathProject, otherSession, "path-user-c", base.Add(3*time.Minute), "page_view", "/home", "")
	insertBehaviorFixture(pathProject, otherSession, "path-user-c", base.Add(3*time.Minute+time.Second), "page_view", "/search", "")
	paths, err := NewPathRepository(database).Query(ctx, PathQuery{ProjectID: pathProject, From: base, To: base.Add(time.Hour), Environment: "production", Depth: 5, TopN: 20})
	if err != nil {
		t.Fatal(err)
	}
	if paths.TotalSessions != 3 || len(paths.Paths) != 2 || paths.Paths[0].Sessions != 2 || len(paths.Paths[0].Events) != 3 || paths.Paths[0].Events[2] != "event:checkout_started" {
		t.Fatalf("paths=%+v", paths)
	}

	retentionProject := uuid.New()
	week := func(value int) time.Time { return base.AddDate(0, 0, value*7) }
	insertBehaviorFixture(retentionProject, uuid.New(), "returning-a", week(0), "page_view", "/home", "")
	insertBehaviorFixture(retentionProject, uuid.New(), "returning-a", week(1), "page_view", "/home", "")
	insertBehaviorFixture(retentionProject, uuid.New(), "returning-a", week(2), "page_view", "/home", "")
	insertBehaviorFixture(retentionProject, uuid.New(), "returning-b", week(0).Add(time.Hour), "page_view", "/home", "")
	insertBehaviorFixture(retentionProject, uuid.New(), "returning-b", week(2).Add(time.Hour), "page_view", "/home", "")
	insertBehaviorFixture(retentionProject, uuid.New(), "new-c", week(1).Add(2*time.Hour), "page_view", "/home", "")
	insertBehaviorFixture(retentionProject, uuid.New(), "new-c", week(2).Add(2*time.Hour), "page_view", "/home", "")
	retention, err := NewRetentionRepository(database).Query(ctx, RetentionQuery{ProjectID: retentionProject, From: week(0), To: week(4), Environment: "production", Weeks: 4})
	if err != nil {
		t.Fatal(err)
	}
	if len(retention.Cohorts) != 2 || retention.Cohorts[0].Users != 2 || len(retention.Cohorts[0].Retention) != 3 || retention.Cohorts[0].Retention[1].Users != 1 || retention.Cohorts[0].Retention[2].Users != 2 {
		t.Fatalf("retention=%+v", retention)
	}
}
