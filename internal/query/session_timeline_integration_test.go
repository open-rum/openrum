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
	result, err := NewEventRepository(database).ListSession(ctx, projectID, sessionID, from, from.Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Events) != 4 || result.Events[1].Kind != "click" || result.Events[2].APIStatus != 500 || result.Events[3].Fingerprint != "v1:checkout" {
		t.Fatalf("timeline=%+v", result)
	}
}
