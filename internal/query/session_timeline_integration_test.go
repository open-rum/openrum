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

func TestSessionTimelineConnectsBehaviorAPIAndErrorEvidence(t *testing.T) {
	database := openClickHouseIntegrationDatabase(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := migrate.ClickHouseUp(ctx, database, migrations.Files); err != nil {
		t.Fatal(err)
	}
	projectID, sessionID := uuid.New(), uuid.New()
	from := time.Date(2026, 10, 5, 8, 0, 0, 0, time.UTC)
	_, err := database.ExecContext(ctx, `INSERT INTO rum_events
		(project_id,event_id,event_type,timestamp,received_at,environment,session_id,anonymous_user_id,page_id,
		page_url_normalized,route,navigation_type,sample_rate,custom_name,attributes,api_method,api_url_normalized,
		api_status,error_type,error_message,fingerprint,fingerprint_version,ingest_flags)
		VALUES
		(?,?, 'page_view',?,?, 'production',?,?,?, '/checkout','/checkout','navigate',1,'',map(),'','',0,'','','',1,[]),
		(?,?, 'custom',?,?, 'production',?,?,?, '/checkout','/checkout','',1,'ui.click',map('role','button'),'','',0,'','','',1,[]),
		(?,?, 'api',?,?, 'production',?,?,?, '/checkout','/checkout','',1,'',map(),'POST','https://api.example/orders',500,'','','',1,[]),
		(?,?, 'error',?,?, 'production',?,?,?, '/checkout','/checkout','',1,'',map(),'','',0,'TypeError','amount is undefined','v1:checkout',1,[])`,
		projectID, uuid.New(), from.Add(time.Minute), from.Add(time.Minute), sessionID, "visitor-a", uuid.New(),
		projectID, uuid.New(), from.Add(2*time.Minute), from.Add(2*time.Minute), sessionID, "visitor-a", uuid.New(),
		projectID, uuid.New(), from.Add(3*time.Minute), from.Add(3*time.Minute), sessionID, "visitor-a", uuid.New(),
		projectID, uuid.New(), from.Add(4*time.Minute), from.Add(4*time.Minute), sessionID, "visitor-a", uuid.New(),
	)
	if err != nil {
		t.Fatal(err)
	}
	result, err := NewEventRepository(database).ListSession(ctx, SessionTimelineFilters{
		ProjectID: projectID, SessionID: sessionID, From: from, To: from.Add(time.Hour),
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Events) != 4 || result.Events[1].Kind != "click" || result.Events[2].APIStatus != 500 || result.Events[3].Fingerprint != "v1:checkout" {
		t.Fatalf("timeline=%+v", result)
	}
	clicks, err := NewEventRepository(database).ListSession(ctx, SessionTimelineFilters{
		ProjectID: projectID, SessionID: sessionID, From: from, To: from.Add(time.Hour), Kinds: []string{"click"},
	})
	if err != nil || len(clicks.Events) != 1 || clicks.Events[0].Kind != "click" {
		t.Fatalf("click timeline=%+v error=%v", clicks, err)
	}
}

func TestSessionTimelinePagesMoreThanTwoHundredEventsWithoutDuplicates(t *testing.T) {
	database := openClickHouseIntegrationDatabase(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := migrate.ClickHouseUp(ctx, database, migrations.Files); err != nil {
		t.Fatal(err)
	}
	projectID, sessionID := uuid.New(), uuid.New()
	from := time.Date(2026, 10, 6, 8, 0, 0, 0, time.UTC)
	for index := range 205 {
		// Repeated timestamps prove the (timestamp,event_id) cursor does not skip
		// or duplicate events that share the same clock value.
		at := from.Add(time.Duration(index/3) * time.Millisecond)
		userID := ""
		if index == 204 {
			userID = "customer-42"
		}
		_, err := database.ExecContext(ctx, `INSERT INTO rum_events
			(project_id,event_id,event_type,timestamp,received_at,environment,session_id,anonymous_user_id,user_id,page_id,
			page_url_normalized,route,navigation_type,sample_rate,ingest_flags)
			VALUES (?,?, 'page_view',?,?, 'production',?,?,?,?, '/catalog','/catalog','navigate',1,[])`,
			projectID, uuid.New(), at, at, sessionID, "visitor-42", userID, uuid.New())
		if err != nil {
			t.Fatal(err)
		}
	}
	cursor := ""
	seen := map[uuid.UUID]bool{}
	pageSizes := make([]int, 0, 3)
	for {
		page, err := NewEventRepository(database).ListSession(ctx, SessionTimelineFilters{
			ProjectID: projectID, SessionID: sessionID, From: from, To: from.Add(time.Hour), Cursor: cursor, Limit: 100,
		})
		if err != nil {
			t.Fatal(err)
		}
		if page.Session.UserID != "customer-42" {
			t.Fatalf("latest user id=%q", page.Session.UserID)
		}
		pageSizes = append(pageSizes, len(page.Events))
		for _, event := range page.Events {
			if seen[event.EventID] {
				t.Fatalf("duplicate event %s", event.EventID)
			}
			seen[event.EventID] = true
		}
		cursor = page.NextCursor
		if cursor == "" {
			break
		}
	}
	if len(seen) != 205 || len(pageSizes) != 3 || pageSizes[0] != 100 || pageSizes[1] != 100 || pageSizes[2] != 5 {
		t.Fatalf("events=%d page sizes=%v", len(seen), pageSizes)
	}
}
