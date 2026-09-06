//go:build integration

package query

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"

	"openrum/internal/metadata"
	"openrum/internal/migrate"
	"openrum/migrations"
)

func TestIssuesRepositoryJoinsStateFiltersFacetsTrendAndCursor(t *testing.T) {
	clickhouse := openClickHouseIntegrationDatabase(t)
	postgresDSN := os.Getenv("TEST_POSTGRES_DSN")
	if postgresDSN == "" {
		t.Skip("TEST_POSTGRES_DSN is not set")
	}
	postgres, err := metadata.OpenPostgres(context.Background(), postgresDSN)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = postgres.Close() }()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := migrate.PostgresUp(ctx, postgres, migrations.Files); err != nil {
		t.Fatal(err)
	}
	if err := migrate.ClickHouseUp(ctx, clickhouse, migrations.Files); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"rum_events_local", "issue_metrics_5m_local", "event_stack_mappings_local"} {
		if _, err := clickhouse.ExecContext(ctx, "TRUNCATE TABLE "+table); err != nil {
			t.Fatal(err)
		}
	}

	ownerID, organizationID, projectID := uuid.New(), uuid.New(), uuid.New()
	if _, err := postgres.ExecContext(ctx, `INSERT INTO users (id,email,display_name,password_hash) VALUES ($1,$2,'Issue Query Owner','hash')`, ownerID, ownerID.String()+"@example.test"); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.ExecContext(ctx, `INSERT INTO organizations (id,name,slug,created_by) VALUES ($1,'Issue Query Org',$2,$3)`, organizationID, "query-"+organizationID.String(), ownerID); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.ExecContext(ctx, `INSERT INTO projects (id,organization_id,name,slug) VALUES ($1,$2,'Issue Query Project',$3)`, projectID, organizationID, "query-"+projectID.String()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = postgres.ExecContext(context.Background(), "DELETE FROM organizations WHERE id=$1", organizationID)
		_, _ = postgres.ExecContext(context.Background(), "DELETE FROM users WHERE id=$1", ownerID)
	})

	fixture := readProtocolFixture(t)
	from := time.Date(2026, 9, 3, 0, 0, 0, 0, time.UTC)
	makeError := func(fingerprint, environment, browser, user string, at time.Time) map[string]any {
		row := fixtureRow(t, fixture, fixture.Events[1], at)
		row["project_id"] = projectID.String()
		row["event_id"] = uuid.NewString()
		row["session_id"] = uuid.NewString()
		row["anonymous_user_id"] = user
		row["environment"] = environment
		row["browser"] = browser
		row["fingerprint"] = fingerprint
		row["fingerprint_version"] = 1
		row["error_message"] = "Cannot submit checkout"
		return row
	}
	insertOverviewRows(t, ctx, clickhouse, []map[string]any{
		makeError("v1:checkout", "production", "Chrome", "user-a", from.Add(5*time.Minute)),
		makeError("v1:checkout", "production", "Chrome", "user-b", from.Add(10*time.Minute)),
		makeError("v1:payment", "production", "Safari", "user-c", from.Add(15*time.Minute)),
		makeError("v1:staging", "staging", "Firefox", "user-d", from.Add(20*time.Minute)),
	})
	eventID, sessionID := uuid.New(), uuid.New()
	detailError := makeError("v1:event-detail", "staging", "Chrome", "visitor-pseudonym", from.Add(25*time.Minute))
	detailError["event_id"], detailError["session_id"] = eventID.String(), sessionID.String()
	detailError["release"], detailError["error_stack"] = "checkout@2.0.0", "at submit (https://shop.example/assets/app.js:4:8)"
	detailError["breadcrumbs"] = []string{"click:button#pay"}
	detailAPI := fixtureRow(t, fixture, fixture.Events[3], from.Add(24*time.Minute))
	detailAPI["project_id"], detailAPI["event_id"], detailAPI["session_id"] = projectID.String(), uuid.NewString(), sessionID.String()
	detailAPI["api_url_normalized"], detailAPI["api_status"], detailAPI["api_failure"] = "https://api.example/orders", 503, "http"
	insertOverviewRows(t, ctx, clickhouse, []map[string]any{detailError, detailAPI})
	stateRepository := metadata.NewIssueRepository(postgres)
	if _, err := stateRepository.PutIssueState(ctx, metadata.IssueState{
		ProjectID: projectID, Fingerprint: "v1:checkout", FingerprintVersion: 1, Status: metadata.IssueStatusResolved,
	}); err != nil {
		t.Fatal(err)
	}
	repository := NewIssuesRepository(clickhouse, stateRepository)
	filters := IssueFilters{ProjectID: projectID, From: from, To: from.Add(time.Hour), Environment: "production", Limit: 1}
	first, err := repository.List(ctx, filters)
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Issues) != 1 || first.Issues[0].Fingerprint != "v1:checkout" || first.Issues[0].Events != 2 ||
		first.Issues[0].Users != 2 || first.Issues[0].Status != metadata.IssueStatusResolved || first.NextCursor == "" {
		t.Fatalf("first page=%+v", first)
	}
	filters.Cursor = first.NextCursor
	second, err := repository.List(ctx, filters)
	if err != nil || len(second.Issues) != 1 || second.Issues[0].Fingerprint != "v1:payment" || second.Issues[0].Status != metadata.IssueStatusUnresolved {
		t.Fatalf("second page=%+v err=%v", second, err)
	}
	filters.Cursor = ""
	filters.Status = metadata.IssueStatusResolved
	resolved, err := repository.List(ctx, filters)
	if err != nil || len(resolved.Issues) != 1 || resolved.Issues[0].Fingerprint != "v1:checkout" {
		t.Fatalf("resolved=%+v err=%v", resolved, err)
	}
	if len(resolved.Facets.Environments) != 1 || resolved.Facets.Environments[0].Value != "production" || len(resolved.Facets.Browsers) != 2 {
		t.Fatalf("facets=%+v", resolved.Facets)
	}
	trend, err := repository.Trend(ctx, filters, "v1:checkout")
	if err != nil || len(trend) != 2 || trend[0].Events != 1 || trend[1].Events != 1 {
		t.Fatalf("trend=%+v err=%v", trend, err)
	}
	events := NewEventRepository(clickhouse)
	eventPage, err := events.ListIssueEvents(ctx, projectID, "v1:event-detail", from, from.Add(time.Hour), 1, "")
	if err != nil || len(eventPage.Events) != 1 || eventPage.Events[0].EventID != eventID || eventPage.Events[0].VisitorID != "visitor-pseudonym" {
		t.Fatalf("events=%+v err=%v", eventPage, err)
	}
	if _, err := clickhouse.ExecContext(ctx,
		`INSERT INTO event_stack_mappings (project_id,event_id,status,failure_code,mapped_stack,mapped_at) VALUES (?,?,?,?,?,?)`,
		projectID, eventID, "mapped", "", `{"raw":"original","status":"mapped","frames":[]}`, from.Add(30*time.Minute)); err != nil {
		t.Fatal(err)
	}
	detail, err := events.Get(ctx, eventID)
	if err != nil || !detail.Availability.Stack || !detail.Availability.Breadcrumbs || !detail.Availability.Release ||
		len(detail.RelatedAPIs) != 1 || detail.RelatedAPIs[0].Status != 503 || detail.RelatedAPIs[0].URL != "https://api.example/orders" ||
		detail.MappedStack == nil || detail.MappedStack.Status != "mapped" {
		t.Fatalf("detail=%+v err=%v", detail, err)
	}
}

func TestIssueFiltersRejectUnboundedQueriesAndUnsafeCursor(t *testing.T) {
	from := time.Date(2026, 9, 3, 0, 0, 0, 0, time.UTC)
	for _, filters := range []IssueFilters{
		{ProjectID: uuid.New(), From: from, To: from.Add(31 * 24 * time.Hour)},
		{ProjectID: uuid.New(), From: from, To: from.Add(time.Hour), Limit: 101},
		{ProjectID: uuid.New(), From: from, To: from.Add(time.Hour), Cursor: "not-base64"},
	} {
		if _, _, err := normalizeIssueFilters(filters); err != ErrInvalidIssueFilters {
			t.Fatalf("filters=%+v err=%v", filters, err)
		}
	}
}
