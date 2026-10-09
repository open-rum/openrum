package devdata

import (
	"sort"
	"strings"
	"testing"
	"time"

	"openrum/internal/event"
)

func storefrontForTest(t *testing.T) ([]Batch, Summary, Scenario) {
	t.Helper()
	from, to := testWindow()
	scenario := PresetScenario("storefront", from, to)
	scenario.Environment = "production"
	scenario.BaseURL = "https://shop.example.com"
	batches, summary, err := Build(scenario)
	if err != nil {
		t.Fatal(err)
	}
	return batches, summary, scenario
}

func TestStorefrontCoversEveryEventTypeInOneRun(t *testing.T) {
	batches, summary, _ := storefrontForTest(t)
	for _, kind := range []event.EventType{event.EventTypePageView, event.EventTypeWebVital, event.EventTypeAPI, event.EventTypeError, event.EventTypeCustom, event.EventTypeLog} {
		if summary.ByType[string(kind)] == 0 {
			t.Fatalf("no %s events: %+v", kind, summary.ByType)
		}
	}
	vitals, clicks, purchases := map[string]bool{}, 0, 0
	for _, batch := range batches {
		for _, ev := range batch.Envelope.Events {
			if ev.Metric != nil {
				vitals[ev.Metric.Name] = true
			}
			if ev.Name == event.BehaviorEventClick && ev.Attributes["element"] != "" {
				clicks++
			}
			if ev.Name == "purchase" {
				purchases++
				if amount := ev.Measurements["amount"]; amount < 79 || amount > 2_400 {
					t.Fatalf("order amount %v outside its range", amount)
				}
			}
		}
	}
	if len(vitals) != 5 || clicks == 0 || purchases == 0 {
		t.Fatalf("vitals=%v clicks=%d purchases=%d", vitals, clicks, purchases)
	}
}

func TestStorefrontVisitorsReturnAndSignIn(t *testing.T) {
	batches, summary, _ := storefrontForTest(t)
	sessions, visitors, users := map[string]bool{}, map[string]bool{}, map[string]bool{}
	sessionUser := map[string]string{}
	for _, batch := range batches {
		context := batch.Envelope.Context
		sessions[context.SessionID] = true
		visitors[context.AnonymousUserID] = true
		if context.UserID != "" {
			users[context.UserID] = true
			if !strings.HasPrefix(context.UserID, "cust_") {
				t.Fatalf("user id %q lacks the prefix", context.UserID)
			}
		}
		if previous, seen := sessionUser[context.SessionID]; seen && previous != context.UserID {
			t.Fatal("a session changed user mid-visit")
		}
		sessionUser[context.SessionID] = context.UserID
	}
	if len(sessions) != summary.Sessions || len(visitors) >= len(sessions) || len(visitors) > 700 {
		t.Fatalf("sessions=%d visitors=%d", len(sessions), len(visitors))
	}
	if len(users) == 0 || len(users) >= len(visitors) {
		t.Fatalf("signed-in users=%d visitors=%d", len(users), len(visitors))
	}
}

func TestExplicitBusinessUserIDsAreUsed(t *testing.T) {
	from, to := testWindow()
	scenario := PresetScenario("storefront", from, to)
	scenario.Environment, scenario.BaseURL, scenario.Sessions = "production", "https://shop.example.com", 200
	scenario.Users = &UserPool{Visitors: 50, SignedIn: 1, IDs: []string{"alice", "bob"}}
	batches, _, err := Build(scenario)
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, batch := range batches {
		seen[batch.Envelope.Context.UserID] = true
	}
	if len(seen) != 2 || !seen["alice"] || !seen["bob"] {
		t.Fatalf("user ids=%v", seen)
	}
}

func TestStorefrontTrafficHasSourcesRhythmFunnelAndIncident(t *testing.T) {
	batches, _, scenario := storefrontForTest(t)
	location, _ := time.LoadLocation("Asia/Shanghai")
	sources, starts := map[string]bool{}, map[string]time.Time{}
	pagesPerSession := map[string]map[string]bool{}
	errorsIn, errorsOut := 0, 0
	incidentFrom := scenario.From.Add(time.Duration(0.71 * float64(scenario.To.Sub(scenario.From))))
	incidentTo := scenario.From.Add(time.Duration(0.75 * float64(scenario.To.Sub(scenario.From))))
	for _, batch := range batches {
		context := batch.Envelope.Context
		if pagesPerSession[context.SessionID] == nil {
			pagesPerSession[context.SessionID] = map[string]bool{}
		}
		pagesPerSession[context.SessionID][context.PageID] = true
		for _, ev := range batch.Envelope.Events {
			at, _ := time.Parse(time.RFC3339Nano, ev.Timestamp)
			if ev.Type == event.EventTypePageView && ev.NavigationType == "navigate" {
				sources[context.Page.Referrer] = true
				starts[context.SessionID] = at
			}
			if ev.Type == event.EventTypeError {
				if !at.Before(incidentFrom) && at.Before(incidentTo) {
					errorsIn++
				} else {
					errorsOut++
				}
			}
		}
	}
	if len(sources) < 5 || !sources[""] {
		t.Fatalf("expected direct and several referrers, got %d", len(sources))
	}
	night, evening := 0, 0
	for _, at := range starts {
		switch hour := at.In(location).Hour(); {
		case hour >= 2 && hour < 6:
			night++
		case hour >= 19 && hour < 23:
			evening++
		}
	}
	if evening <= night*3 {
		t.Fatalf("daily rhythm too flat: evening=%d night=%d", evening, night)
	}
	short := 0
	for _, pages := range pagesPerSession {
		if len(pages) == 1 {
			short++
		}
	}
	if short == 0 || short == len(pagesPerSession) {
		t.Fatalf("funnel drop-off missing: %d of %d sessions bounced", short, len(pagesPerSession))
	}
	// The incident covers 4% of the window; with a 5x multiplier its error density
	// per unit time must clearly exceed the rest of the day.
	if float64(errorsIn)/0.04 < 2*float64(errorsOut)/0.96 {
		t.Fatalf("incident not visible: in=%d out=%d", errorsIn, errorsOut)
	}
}

func TestTrafficValidationReportsBadSettings(t *testing.T) {
	from, to := testWindow()
	scenario := PresetScenario("storefront", from, to)
	scenario.Environment, scenario.BaseURL = "production", "https://shop.example.com"
	scenario.Users = &UserPool{SignedIn: 2}
	scenario.Referrers = []Weight{{Value: "not a url", Weight: 1}}
	scenario.DailyRhythm = &DailyRhythm{TimeZone: "Mars/Base", Hourly: []float64{1}}
	scenario.Incidents = []Incident{{Start: 0.5, End: 0.4}}
	scenario.Journeys[0].Pages[0].Exit = 2
	err := scenario.Validate()
	for _, fragment := range []string{"users.signedIn", "referrers[0]", "dailyRhythm", "incidents[0]", "exit"} {
		if err == nil || !strings.Contains(err.Error(), fragment) {
			t.Fatalf("missing %q in %v", fragment, err)
		}
	}
}

func TestStorefrontVitalsLandInRealisticBands(t *testing.T) {
	batches, _, _ := storefrontForTest(t)
	values := map[string][]float64{}
	for _, batch := range batches {
		for _, ev := range batch.Envelope.Events {
			if ev.Metric != nil {
				values[ev.Metric.Name] = append(values[ev.Metric.Name], ev.Metric.Value)
			}
		}
	}
	p75 := func(samples []float64) float64 {
		sorted := append([]float64(nil), samples...)
		sort.Float64s(sorted)
		return sorted[len(sorted)*3/4]
	}
	// A healthy-but-real storefront: P75s mostly good, with a slow tail present.
	for name, bounds := range map[string][2]float64{"LCP": {1_800, 3_000}, "INP": {120, 260}, "CLS": {0.04, 0.14}} {
		if got := p75(values[name]); got < bounds[0] || got > bounds[1] {
			t.Fatalf("%s P75 = %v, want %v", name, got, bounds)
		}
	}
	slow := 0
	for _, value := range values["LCP"] {
		if value > 4_000 {
			slow++
		}
	}
	if slow == 0 {
		t.Fatal("LCP has no poor tail")
	}
}
