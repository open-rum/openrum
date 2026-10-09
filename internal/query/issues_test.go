//go:build integration

package query

import (
	"context"
	"os"
	"strings"
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
	// Relative to now: raw events expire after 14 days, so a fixed date ages out of rum_events.
	from := time.Now().UTC().Truncate(time.Hour).Add(-24 * time.Hour)
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
	checkoutPage, paymentPage := uuid.New(), uuid.New()
	checkoutOne := makeError("v1:checkout", "production", "Chrome", "user-a", from.Add(5*time.Minute))
	checkoutOne["user_id"], checkoutOne["page_id"], checkoutOne["route"], checkoutOne["country"] = "customer-1", checkoutPage.String(), "/checkout", "US"
	checkoutTwo := makeError("v1:checkout", "production", "Chrome", "user-b", from.Add(10*time.Minute))
	checkoutTwo["user_id"], checkoutTwo["page_id"], checkoutTwo["route"], checkoutTwo["country"] = "customer-1", checkoutPage.String(), "/checkout", "US"
	payment := makeError("v1:payment", "production", "Safari", "user-c", from.Add(15*time.Minute))
	payment["user_id"], payment["page_id"], payment["route"], payment["country"] = "", paymentPage.String(), "/payment", "CN"
	payment["error_type"], payment["error_message"] = "RangeError", "Payment token missing"
	// Earlier sightings outside the range: the production one dates the Issue, the staging one
	// is outside the shared Environment and must not.
	checkoutEarlier := makeError("v1:checkout", "production", "Chrome", "user-e", from.Add(-48*time.Hour))
	checkoutOtherEnvironment := makeError("v1:checkout", "staging", "Chrome", "user-f", from.Add(-72*time.Hour))
	insertOverviewRows(t, ctx, clickhouse, []map[string]any{
		checkoutEarlier,
		checkoutOtherEnvironment,
		checkoutOne,
		checkoutTwo,
		payment,
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
	details := filters
	details.RowDetails = true
	withDetails, err := repository.List(ctx, details)
	if err != nil || len(withDetails.Issues) != 1 || withDetails.TrendIntervalSeconds <= 0 {
		t.Fatalf("row details page=%+v err=%v", withDetails, err)
	}
	var trendTotal uint64
	for _, count := range withDetails.Issues[0].Trend {
		trendTotal += count
	}
	if trendTotal != withDetails.Issues[0].Events || len(withDetails.Issues[0].Trend) < 2 {
		t.Fatalf("trend %v sums to %d, want the issue's %d events", withDetails.Issues[0].Trend, trendTotal, withDetails.Issues[0].Events)
	}
	if first.Issues[0].Trend != nil {
		t.Fatal("trend is only computed for list requests that ask for row details")
	}
	if !first.Issues[0].FirstSeenAt.Equal(from.Add(-48 * time.Hour)) {
		t.Fatalf("first seen=%s, want the earlier production sighting", first.Issues[0].FirstSeenAt)
	}
	filters.Cursor = first.NextCursor
	second, err := repository.List(ctx, filters)
	if err != nil || len(second.Issues) != 1 || second.Issues[0].Fingerprint != "v1:payment" || second.Issues[0].Status != metadata.IssueStatusUnresolved {
		t.Fatalf("second page=%+v err=%v", second, err)
	}
	if !second.Issues[0].FirstSeenAt.Equal(from.Add(15 * time.Minute)) {
		t.Fatalf("payment first seen=%s, want its in-range sighting", second.Issues[0].FirstSeenAt)
	}
	filters.Cursor = ""
	filters.ErrorType, filters.Title = "RangeError", "token"
	filtered, err := repository.List(ctx, filters)
	if err != nil || len(filtered.Issues) != 1 || filtered.Issues[0].Fingerprint != "v1:payment" {
		t.Fatalf("issue-specific filtered page=%+v err=%v", filtered, err)
	}
	filters.ErrorType, filters.Title = "", ""
	filters.UserID = "customer-1"
	userFiltered, err := repository.List(ctx, filters)
	if err != nil || len(userFiltered.Issues) != 1 || userFiltered.Issues[0].Fingerprint != "v1:checkout" || userFiltered.Issues[0].Events != 2 {
		t.Fatalf("user filtered page=%+v err=%v", userFiltered, err)
	}
	filters.UserID = ""
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
	filters.Status = ""
	overview, err := repository.Overview(ctx, filters)
	var overviewEvents, identifiedUsers uint64
	var foundAnonymousOnlyBucket bool
	for _, point := range overview.Trend {
		overviewEvents += point.Events
		identifiedUsers += point.IdentifiedUsers
		paymentAt := from.Add(15 * time.Minute)
		bucketEnd := point.Bucket.Add(time.Duration(overview.IntervalSeconds) * time.Second)
		if !point.Bucket.After(paymentAt) && paymentAt.Before(bucketEnd) && point.IdentifiedUsers == 0 {
			foundAnonymousOnlyBucket = true
		}
	}
	if err != nil || overviewEvents != 3 || identifiedUsers == 0 || !foundAnonymousOnlyBucket || len(overview.ErrorTypes) != 2 || overview.ErrorTypes[0].Value != "TypeError" || overview.ErrorTypes[0].Events != 2 || len(overview.Pages) != 2 || len(overview.Countries) != 2 {
		t.Fatalf("overview=%+v events=%d identified=%d err=%v", overview, overviewEvents, identifiedUsers, err)
	}
	events := NewEventRepository(clickhouse)
	eventFilters := IssueFilters{ProjectID: projectID, From: from, To: from.Add(time.Hour), Limit: 1}
	stackFilters := IssueFilters{ProjectID: projectID, From: from, To: from.Add(time.Hour), Environment: "staging", Fingerprint: "v1:event-detail", Limit: 5, RowDetails: true}
	stackPage, err := repository.List(ctx, stackFilters)
	if err != nil || len(stackPage.Issues) != 1 || stackPage.Issues[0].Culprit == nil ||
		stackPage.Issues[0].Culprit.Function != "submit" || stackPage.Issues[0].Culprit.File != "assets/app.js" {
		t.Fatalf("culprit page=%+v err=%v", stackPage, err)
	}
	eventPage, err := events.ListIssueEvents(ctx, eventFilters, "v1:event-detail")
	if err != nil || len(eventPage.Events) != 1 || eventPage.Events[0].EventID != eventID || eventPage.Events[0].VisitorID != "visitor-pseudonym" {
		t.Fatalf("events=%+v err=%v", eventPage, err)
	}
	// Samples follow the same dimension filters as the Issue's counts.
	eventFilters.Limit, eventFilters.Browser = 10, "Safari"
	samples, err := events.ListIssueEvents(ctx, eventFilters, "v1:checkout")
	if err != nil || len(samples.Events) != 0 {
		t.Fatalf("Safari checkout samples=%+v err=%v", samples, err)
	}
	eventFilters.Browser, eventFilters.Environment = "Chrome", "production"
	samples, err = events.ListIssueEvents(ctx, eventFilters, "v1:checkout")
	if err != nil || len(samples.Events) != 2 {
		t.Fatalf("production Chrome checkout samples=%+v err=%v", samples, err)
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

	// New, assigned and regressed Issues, on the production range from above.
	selection := IssueFilters{ProjectID: projectID, From: from, To: from.Add(time.Hour), Environment: "production", Limit: 10}
	fresh := selection
	fresh.NewOnly = true
	newIssues, err := repository.List(ctx, fresh)
	if err != nil || len(newIssues.Issues) != 1 || newIssues.Issues[0].Fingerprint != "v1:payment" {
		t.Fatalf("only the Issue first seen in range is new: %+v err=%v", newIssues, err)
	}
	if _, err := stateRepository.PutIssueState(ctx, metadata.IssueState{
		ProjectID: projectID, Fingerprint: "v1:checkout", FingerprintVersion: 1, Status: metadata.IssueStatusResolved,
		AssigneeUserID: &ownerID,
	}); err != nil {
		t.Fatal(err)
	}
	unassigned := selection
	unassigned.Assignee = AssigneeNone
	nobody, err := repository.List(ctx, unassigned)
	if err != nil || len(nobody.Issues) != 1 || nobody.Issues[0].Fingerprint != "v1:payment" {
		t.Fatalf("unassigned=%+v err=%v", nobody, err)
	}
	mine := selection
	mine.Assignee = ownerID.String()
	owned, err := repository.List(ctx, mine)
	if err != nil || len(owned.Issues) != 1 || owned.Issues[0].Fingerprint != "v1:checkout" {
		t.Fatalf("assigned to owner=%+v err=%v", owned, err)
	}
	// Resolved between the checkout Issue's two events: the second one is a regression.
	resolvedBetween := from.Add(7 * time.Minute)
	if _, err := stateRepository.PutIssueState(ctx, metadata.IssueState{
		ProjectID: projectID, Fingerprint: "v1:checkout", FingerprintVersion: 1, Status: metadata.IssueStatusResolved,
		ResolvedAt: &resolvedBetween,
	}); err != nil {
		t.Fatal(err)
	}
	regressedFilter := selection
	regressedFilter.Status = metadata.IssueStatusRegressed
	regressed, err := repository.List(ctx, regressedFilter)
	if err != nil || len(regressed.Issues) != 1 || regressed.Issues[0].Fingerprint != "v1:checkout" ||
		regressed.Issues[0].Status != metadata.IssueStatusRegressed {
		t.Fatalf("regressed=%+v err=%v", regressed, err)
	}
	stillResolved := selection
	stillResolved.Status = metadata.IssueStatusResolved
	none, err := repository.List(ctx, stillResolved)
	if err != nil || len(none.Issues) != 0 {
		t.Fatalf("a regressed Issue is no longer resolved: %+v err=%v", none, err)
	}
	resolvedAfter := from.Add(time.Hour)
	if _, err := stateRepository.PutIssueState(ctx, metadata.IssueState{
		ProjectID: projectID, Fingerprint: "v1:checkout", FingerprintVersion: 1, Status: metadata.IssueStatusResolved,
		ResolvedAt: &resolvedAfter,
	}); err != nil {
		t.Fatal(err)
	}
	settled, err := repository.List(ctx, stillResolved)
	if err != nil || len(settled.Issues) != 1 || settled.Issues[0].Status != metadata.IssueStatusResolved {
		t.Fatalf("resolved after the last event stays resolved: %+v err=%v", settled, err)
	}
}

func TestIssueFiltersRejectUnboundedQueriesAndUnsafeCursor(t *testing.T) {
	from := time.Date(2026, 9, 3, 0, 0, 0, 0, time.UTC)
	for _, filters := range []IssueFilters{
		{ProjectID: uuid.New(), From: from, To: from.Add(31 * 24 * time.Hour)},
		{ProjectID: uuid.New(), From: from, To: from.Add(time.Hour), Limit: 101},
		{ProjectID: uuid.New(), From: from, To: from.Add(time.Hour), Cursor: "not-base64"},
		{ProjectID: uuid.New(), From: from, To: from.Add(time.Hour), Title: strings.Repeat("x", 201)},
		{ProjectID: uuid.New(), From: from, To: from.Add(time.Hour), UserID: strings.Repeat("x", 129)},
		{ProjectID: uuid.New(), From: from, To: from.Add(time.Hour), Assignee: "someone"},
		{ProjectID: uuid.New(), From: from, To: from.Add(time.Hour), Status: "archived"},
	} {
		if _, _, err := normalizeIssueFilters(filters); err != ErrInvalidIssueFilters {
			t.Fatalf("filters=%+v err=%v", filters, err)
		}
	}
}
