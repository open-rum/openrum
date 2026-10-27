//go:build integration

package query

import (
	"context"
	"errors"
	"sort"
	"testing"
	"time"

	"github.com/google/uuid"

	"openrum/internal/metadata"
	"openrum/internal/migrate"
	"openrum/internal/search"
	"openrum/migrations"
)

type noIssueStates struct{}

func (noIssueStates) ListIssueStates(context.Context, uuid.UUID, []string) (map[string]metadata.IssueState, error) {
	return map[string]metadata.IssueState{}, nil
}

// TestSharedSearchAcrossPages runs the same search language against every page's real query,
// on one fixture, and checks each page answers what the condition says.
func TestSharedSearchAcrossPages(t *testing.T) {
	database := openClickHouseIntegrationDatabase(t)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	if err := migrate.ClickHouseUp(ctx, database, migrations.Files); err != nil {
		t.Fatal(err)
	}
	projectID, otherProject := uuid.New(), uuid.New()
	// Raw events expire after 14 days, so the fixture sits in the last few hours.
	at := time.Now().UTC().Truncate(time.Minute).Add(-2 * time.Hour)
	from, to := at.Add(-time.Hour), at.Add(time.Hour)
	p := projectID.String()
	errorEvent := func(fingerprint, errorType, message string, fields map[string]any) map[string]any {
		row := map[string]any{"fingerprint": fingerprint, "fingerprint_version": 1, "error_type": errorType, "error_message": message}
		for key, value := range fields {
			row[key] = value
		}
		return metricsEvent(p, "error", at, row)
	}
	rows := []map[string]any{
		metricsEvent(p, "log", at, map[string]any{"log_level": "info", "log_message": "payment ok", "log_logger": "checkout", "trace_id": "trace-1"}),
		metricsEvent(p, "log", at, map[string]any{"log_level": "error", "log_message": "payment failed", "log_logger": "cart"}),
		metricsEvent(p, "log", at, map[string]any{"log_level": "debug", "log_message": "noise", "log_logger": "checkout", "trace_id": "trace-2"}),

		errorEvent("fp-a", "TypeError", "Cannot read total", map[string]any{"session_id": "s1", "route": "/checkout", "user_id": "alice"}),
		errorEvent("fp-a", "TypeError", "Cannot read total", map[string]any{"session_id": "s1", "route": "/checkout", "user_id": "alice"}),
		errorEvent("fp-b", "NetworkError", "Request timeout", map[string]any{"session_id": "s2", "route": "/cart", "browser": "Safari"}),

		metricsEvent(p, "page_view", at, map[string]any{"session_id": "s1", "route": "/checkout"}),
		metricsEvent(p, "page_view", at, map[string]any{"session_id": "s2", "route": "/cart"}),
		metricsEvent(p, "page_view", at, map[string]any{"session_id": "s3", "route": "/home"}),

		metricsEvent(p, "api", at, map[string]any{"session_id": "s1", "api_method": "GET", "api_url_normalized": "/api/cart", "api_status": 200, "duration_ms": 30.0}),
		metricsEvent(p, "api", at, map[string]any{"session_id": "s1", "api_method": "POST", "api_url_normalized": "/api/pay", "api_status": 500, "duration_ms": 2500.0}),
		metricsEvent(p, "api", at, map[string]any{"session_id": "s2", "api_method": "POST", "api_url_normalized": "/api/pay", "api_status": 201, "duration_ms": 120.0}),

		metricsEvent(p, "custom", at, map[string]any{"custom_name": "checkout", "attributes": map[string]string{"plan": "pro", "region": "eu"}}),
		metricsEvent(p, "custom", at, map[string]any{"custom_name": "checkout", "attributes": map[string]string{"plan": "pro", "region": "us"}, "country": "US"}),
		metricsEvent(p, "custom", at, map[string]any{"custom_name": "checkout", "attributes": map[string]string{"plan": "free", "region": "eu"}}),
		// Another project's event must never show up.
		metricsEvent(otherProject.String(), "custom", at, map[string]any{"custom_name": "checkout", "attributes": map[string]string{"plan": "pro", "region": "eu"}}),
	}
	insert := "INSERT INTO rum_events SETTINGS insert_distributed_sync=1,date_time_input_format='best_effort' FORMAT JSONEachRow\n" + encodeMetricsRows(t, rows)
	if _, err := database.ExecContext(ctx, insert); err != nil {
		t.Fatal(err)
	}

	t.Run("logs", func(t *testing.T) {
		repository := NewLogRepository(database)
		for q, want := range map[string][]string{
			`!level:[debug,trace] has:trace_id`: {"payment ok"},
			`logger:car*`:                       {"payment failed"},
			`payment !failed`:                   {"payment ok"},
			`!has:trace_id`:                     {"payment failed"},
		} {
			page, err := repository.List(ctx, LogFilters{ProjectID: projectID, From: from, To: to, Query: q})
			if err != nil {
				t.Fatalf("%q: %v", q, err)
			}
			got := make([]string, 0, len(page.Items))
			for _, item := range page.Items {
				got = append(got, item.Message)
			}
			if !equalStrings(got, want) {
				t.Errorf("%q: got %v want %v", q, got, want)
			}
		}
	})

	t.Run("issues on the rollup and on raw events", func(t *testing.T) {
		repository := NewIssuesRepository(database, noIssueStates{})
		for q, want := range map[string][]string{
			`browser:Safari`:           {"fp-b"},
			`!error.type:NetworkError`: {"fp-a"},
			`timeout`:                  {"fp-b"},
			`route:/check*`:            {"fp-a"},
			`user.id:alice`:            {"fp-a"}, // not in the rollup: reads raw events
			`!has:user.id`:             {"fp-b"},
			`browser:[Chrome,Safari]`:  {"fp-a", "fp-b"},
		} {
			if q == `user.id:alice` && !issueUsesRawEvents(IssueFilters{Query: q}) {
				t.Fatal("user.id should need raw events")
			}
			page, err := repository.List(ctx, IssueFilters{ProjectID: projectID, From: from, To: to, Query: q})
			if err != nil {
				t.Fatalf("%q: %v", q, err)
			}
			got := make([]string, 0, len(page.Issues))
			for _, issue := range page.Issues {
				got = append(got, issue.Fingerprint)
			}
			if !equalStrings(got, want) {
				t.Errorf("%q: got %v want %v", q, got, want)
			}
		}
	})

	t.Run("sessions", func(t *testing.T) {
		repository := NewSessionRepository(database)
		count := func(q string) int {
			page, err := repository.List(ctx, SessionFilters{ProjectID: projectID, From: from, To: to, Query: q})
			if err != nil {
				t.Fatalf("%q: %v", q, err)
			}
			return len(page.Sessions)
		}
		for q, want := range map[string]int{
			`route:/checkout`:     1,
			`!route:/checkout`:    3, // s2, s3 and the session the logs and custom events share
			`errors:>0`:           2,
			`errors:>=2`:          1,
			`browser:Safari`:      1,
			`user.id:alice`:       1,
			`events:>100`:         0,
			`route:[/cart,/home]`: 2,
		} {
			if got := count(q); got != want {
				t.Errorf("%q: got %d sessions want %d", q, got, want)
			}
		}
	})

	t.Run("API list and samples", func(t *testing.T) {
		repository := NewAPIRepository(database)
		result, err := repository.Get(ctx, APIFilters{ProjectID: projectID, From: from, To: to, Query: `endpoint:*pay*`})
		if err != nil {
			t.Fatal(err)
		}
		if len(result.Endpoints) != 1 || result.Endpoints[0].URL != "/api/pay" {
			t.Fatalf("endpoints=%+v", result.Endpoints)
		}
		// status lives only on raw events: the list refuses it, the samples answer it.
		if _, err := NormalizeAPIFilters(APIFilters{ProjectID: projectID, From: from, To: to, Query: `status:>=500`}); !errors.Is(err, search.ErrInvalid) {
			t.Fatalf("list accepted a raw-only field: %v", err)
		}
		for q, want := range map[string]int{`status:>=500 duration:>2s`: 1, `status:<500`: 1, `!status:[500,201]`: 0} {
			samples, err := repository.Samples(ctx, APIFilters{ProjectID: projectID, From: from, To: to, Method: "POST", URL: "/api/pay", Query: q})
			if err != nil {
				t.Fatalf("%q: %v", q, err)
			}
			if len(samples.Samples) != want {
				t.Errorf("%q: got %d samples want %d", q, len(samples.Samples), want)
			}
		}
	})

	t.Run("events filtered by a property", func(t *testing.T) {
		repository := NewBehaviorRepository(database)
		get := func(dimension, q string) BehaviorAnalytics {
			result, err := repository.Get(ctx, BehaviorFilters{ProjectID: projectID, From: from, To: to, EventName: "checkout", Dimension: dimension, Query: q})
			if err != nil {
				t.Fatalf("%s %q: %v", dimension, q, err)
			}
			return result
		}
		rollup := get("property:plan", `attributes.plan:pro`)
		if behaviorUsesRawEvents(BehaviorFilters{Dimension: "property:plan", Query: `attributes.plan:pro`}) {
			t.Fatal("a single property split by itself should read the rollup")
		}
		raw := get("country", `attributes.plan:pro`)
		if rollup.Totals.Events != 2 || raw.Totals.Events != 2 {
			t.Fatalf("plan=pro: rollup=%d raw=%d, want 2", rollup.Totals.Events, raw.Totals.Events)
		}
		if len(rollup.Breakdown) != 1 || rollup.Breakdown[0].Value != "pro" {
			t.Fatalf("rollup breakdown=%+v", rollup.Breakdown)
		}
		countries := map[string]uint64{}
		for _, item := range raw.Breakdown {
			countries[item.Value] = item.Metric.Events
		}
		if countries["CN"] != 1 || countries["US"] != 1 {
			t.Fatalf("raw breakdown=%+v", raw.Breakdown)
		}
		if both := get("property:region", `attributes.plan:pro attributes.region:eu`); both.Totals.Events != 1 {
			t.Fatalf("two properties: %d", both.Totals.Events)
		}
		if none := get("property:plan", `!attributes.plan:pro`); none.Totals.Events != 1 {
			t.Fatalf("not pro: %d", none.Totals.Events)
		}
		// Country, device and browser are rollup dimensions too; a route is not.
		if behaviorUsesRawEvents(BehaviorFilters{Dimension: "country", Query: `country:us`}) {
			t.Fatal("a country split by country should read the rollup")
		}
		if !behaviorUsesRawEvents(BehaviorFilters{Dimension: "country", Query: `route:/`}) {
			t.Fatal("a route should read raw events")
		}
		for q, dimensions := range map[string][]string{
			`country:us`:                  {"country", "property:plan"},
			`country:[CN,US]`:             {"country", "browser"},
			`browser:Chrome`:              {"browser", "country"},
			`device:desktop`:              {"device", "country"},
			`route:/`:                     {"country"},
			`route:/ attributes.plan:pro`: {"country"},
		} {
			want := map[string]uint64{`country:us`: 1, `country:[CN,US]`: 3, `browser:Chrome`: 3, `device:desktop`: 3,
				`route:/`: 3, `route:/ attributes.plan:pro`: 2}[q]
			for _, dimension := range dimensions {
				if got := get(dimension, q).Totals.Events; got != want {
					t.Fatalf("%s split by %s: %d, want %d", q, dimension, got, want)
				}
			}
		}
		if other := get("country", `route:/checkout`); other.Totals.Events != 0 {
			t.Fatalf("route:/checkout: %d", other.Totals.Events)
		}
		samples, err := repository.ListSamples(ctx, BehaviorFilters{ProjectID: projectID, From: from, To: to, EventName: "checkout", Query: `attributes.plan:pro`})
		if err != nil || len(samples.Samples) != 2 {
			t.Fatalf("samples=%d err=%v", len(samples.Samples), err)
		}
		for _, sample := range samples.Samples {
			if sample.Attributes["plan"] != "pro" {
				t.Fatalf("sample outside the search: %+v", sample.Attributes)
			}
		}
	})

	t.Run("value suggestions", func(t *testing.T) {
		repository := NewSearchValueRepository(database)
		values := func(filters SearchValueFilters) map[string]uint64 {
			filters.ProjectID, filters.From, filters.To = projectID, from, to
			result, err := repository.Values(ctx, filters)
			if err != nil {
				t.Fatalf("%+v: %v", filters, err)
			}
			found := map[string]uint64{}
			for _, value := range result {
				found[value.Value] = value.Count
			}
			return found
		}
		if names := values(SearchValueFilters{Dataset: "events", Field: "attributes", Event: "checkout"}); names["plan"] != 3 || names["region"] != 3 {
			t.Fatalf("property names=%v", names)
		}
		// Three of this project's checkouts; the other project's pro is not counted.
		if plans := values(SearchValueFilters{Dataset: "events", Field: "attributes.plan", Event: "checkout"}); plans["pro"] != 2 || plans["free"] != 1 {
			t.Fatalf("plan values=%v", plans)
		}
		if loggers := values(SearchValueFilters{Dataset: "logs", Field: "logger", Contains: "CHE"}); len(loggers) != 1 || loggers["checkout"] != 2 {
			t.Fatalf("loggers=%v", loggers)
		}
		for _, bad := range []SearchValueFilters{
			{Dataset: "nope", Field: "route"}, {Dataset: "apis", Field: "status"}, {Dataset: "logs", Field: "attributes.bad key"},
		} {
			bad.ProjectID, bad.From, bad.To = projectID, from, to
			if _, err := repository.Values(ctx, bad); !errors.Is(err, ErrInvalidSearchValues) {
				t.Errorf("%+v accepted: %v", bad, err)
			}
		}
	})
}

func equalStrings(got, want []string) bool {
	got, want = append([]string(nil), got...), append([]string(nil), want...)
	sort.Strings(got)
	sort.Strings(want)
	if len(got) != len(want) {
		return false
	}
	for index := range got {
		if got[index] != want[index] {
			return false
		}
	}
	return true
}
