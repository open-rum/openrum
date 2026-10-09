//go:build integration

package consumerservice

import (
	"context"
	"encoding/json"
	"openrum/internal/event"
	"openrum/internal/migrate"
	"openrum/internal/query"
	"openrum/migrations"
	"testing"
	"time"

	"github.com/google/uuid"
)

// Runs the real normalizer -> native batch writer -> SQL log query in an isolated _test DB.
func TestLogsIngestionQueryAndIsolation(t *testing.T) {
	dsn := safeClickHouseIntegrationDSN(t)
	db, err := migrate.OpenClickHouse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	if err = migrate.ClickHouseUp(ctx, db, migrations.Files); err != nil {
		t.Fatal(err)
	}
	var queued map[string]json.RawMessage
	if err = json.Unmarshal(validQueuePayload(t), &queued); err != nil {
		t.Fatal(err)
	}
	var envelope event.EnvelopeV1
	if err = json.Unmarshal(queued["envelope"], &envelope); err != nil {
		t.Fatal(err)
	}
	projectID := uuid.New()
	now := time.Now().UTC().Truncate(time.Millisecond)
	queued["project_id"], _ = json.Marshal(projectID)
	queued["received_at"], _ = json.Marshal(now)
	envelope.Context.UserID = "customer-123"
	envelope.Context.AnonymousUserID = "visitor-abc"
	envelope.Events = []event.EventV1{{EventID: uuid.NewString(), Type: event.EventTypeLog, Timestamp: now.Format(time.RFC3339Nano), Level: "error", Message: "payment failed person@example.com", Logger: "payment", Attributes: map[string]string{"order.id": "demo123", "password": "private"}}}
	queued["envelope"], _ = json.Marshal(envelope)
	payload, _ := json.Marshal(queued)
	canonical, failures, err := event.NormalizeQueuedEnvelope(payload)
	if err != nil || len(failures) != 0 || len(canonical) != 1 {
		t.Fatalf("%v %v", err, failures)
	}
	base := canonical[0]
	base.RawExpiresAt = now.Add(24 * time.Hour)
	base.AggregateExpiresAt = now.Add(24 * time.Hour)
	other := base
	other.EventID = uuid.New()
	other.Timestamp = now.Add(-time.Second)
	other.LogLevel = "info"
	other.UserID = "customer-456"
	foreign := base
	foreign.EventID = uuid.New()
	foreign.ProjectID = uuid.New()
	expired := base
	expired.EventID = uuid.New()
	expired.RawExpiresAt = now.Add(-time.Hour)
	writer, err := OpenBufferedClickHouseWriter(ctx, dsn, ClickHouseWriterOptions{})
	if err != nil {
		t.Fatal(err)
	}
	defer writer.Close()
	if err = writer.WriteEvents(ctx, []event.CanonicalEvent{base, other, foreign, expired}); err != nil {
		t.Fatal(err)
	}
	repository := query.NewLogRepository(db)
	filters := query.LogFilters{ProjectID: projectID, From: now.Add(-time.Hour), To: now.Add(time.Minute), Limit: 1}
	page, err := repository.List(ctx, filters)
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 2 || len(page.Items) != 1 || page.NextCursor == "" || page.Items[0].EventID != base.EventID {
		t.Fatalf("first page=%+v", page)
	}
	if page.Items[0].Attributes["password"] != "" || page.Items[0].Message == envelope.Events[0].Message {
		t.Fatal("log privacy floor missing")
	}
	if page.Items[0].UserID != "customer-123" || page.Items[0].AnonymousUserID != "visitor-abc" {
		t.Fatalf("user context missing: %+v", page.Items[0])
	}
	filters.Cursor = page.NextCursor
	page, err = repository.List(ctx, filters)
	if err != nil || page.Total != 2 || len(page.Items) != 1 || page.Items[0].EventID != other.EventID || page.NextCursor != "" {
		t.Fatalf("second page=%+v error=%v", page, err)
	}
	filters.Cursor = ""
	filters.Query = `severity:error order.id:demo123 message:"payment failed"`
	page, err = repository.List(ctx, filters)
	if err != nil || page.Total != 1 || len(page.Items) != 1 {
		t.Fatalf("search=%+v error=%v", page, err)
	}
	for _, search := range []string{`user.id:customer-123`, `user_id:customer-123`, `userId:customer-123 severity:error`} {
		filters.Query = search
		page, err = repository.List(ctx, filters)
		if err != nil || page.Total != 1 || len(page.Items) != 1 || page.Items[0].EventID != base.EventID {
			t.Fatalf("user search %q=%+v error=%v", search, page, err)
		}
	}
	filters.Query = `anonymous_user_id:visitor-abc`
	page, err = repository.List(ctx, filters)
	if err != nil || page.Total != 2 {
		t.Fatalf("visitor search=%+v error=%v", page, err)
	}
	filters.Query = `user.id:unknown-user`
	page, err = repository.List(ctx, filters)
	if err != nil || page.Total != 0 {
		t.Fatalf("unknown user=%+v error=%v", page, err)
	}
	filters.Query = `message:"' OR 1=1 --"`
	page, err = repository.List(ctx, filters)
	if err != nil || page.Total != 0 {
		t.Fatalf("injection=%+v error=%v", page, err)
	}
	timeline, err := query.NewEventRepository(db).ListSession(ctx, query.SessionTimelineFilters{
		ProjectID: projectID, SessionID: base.SessionID, From: filters.From, To: filters.To,
	})
	if err != nil || len(timeline.Events) != 2 || timeline.Events[0].Kind != "log" {
		t.Fatalf("timeline=%+v error=%v", timeline, err)
	}
}
