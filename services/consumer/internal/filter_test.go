package consumerservice

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/prometheus/client_golang/prometheus"
	dto "github.com/prometheus/client_model/go"

	"openrum/internal/event"
	"openrum/internal/filter"
)

func sampleEvents() []event.CanonicalEvent {
	return []event.CanonicalEvent{
		{EventID: uuid.New(), EventType: event.EventTypePageView, PageURLNormalized: "https://shop.example.com/"},
		{
			EventID: uuid.New(), EventType: event.EventTypePageView,
			PageURLNormalized: "https://shop.example.com/", IngestFlags: []string{"bot"},
		},
		{
			EventID: uuid.New(), EventType: event.EventTypeError,
			PageURLNormalized: "http://localhost:5173/",
			ErrorStack:        "at handler (chrome-extension://abcdef/content.js:1:1)",
		},
	}
}

func TestApplyInboundFiltersKeepsEverythingWhileMeasuring(t *testing.T) {
	registry := prometheus.NewRegistry()
	metrics, err := NewMetrics(collectorRegisterer{registry})
	if err != nil {
		t.Fatal(err)
	}
	compiled, err := filter.Compile(filter.Settings{Builtin: map[filter.Reason]filter.Mode{
		filter.ReasonBot:       filter.ModeDryRun,
		filter.ReasonExtension: filter.ModeDryRun,
		filter.ReasonLocalhost: filter.ModeDryRun,
	}})
	if err != nil {
		t.Fatal(err)
	}
	events := sampleEvents()

	kept := applyInboundFilters(events, compiled, metrics)

	// The whole point of the mode is that measuring changes nothing.
	if len(kept) != 3 {
		t.Fatalf("kept %d events, want 3", len(kept))
	}
	counts := filteredCounts(t, registry)
	for reason, want := range map[string]float64{"bot": 1, "extension": 1, "localhost": 1} {
		if got := counts[reason]; got != want {
			t.Fatalf("filtered_total{reason=%q} = %v, want %v (all: %v)", reason, got, want, counts)
		}
	}
	for _, mode := range modesSeen(t, registry) {
		if mode != filterModeDryRun {
			t.Fatalf("unexpected mode %q while only measuring", mode)
		}
	}
}

func TestApplyInboundFiltersDropsOnlyEnforcedMatches(t *testing.T) {
	registry := prometheus.NewRegistry()
	metrics, err := NewMetrics(collectorRegisterer{registry})
	if err != nil {
		t.Fatal(err)
	}
	compiled, err := filter.Compile(filter.Settings{Builtin: map[filter.Reason]filter.Mode{
		filter.ReasonBot:       filter.ModeEnforced,
		filter.ReasonLocalhost: filter.ModeDryRun,
	}})
	if err != nil {
		t.Fatal(err)
	}
	events := sampleEvents()

	kept := applyInboundFilters(events, compiled, metrics)

	// The bot event goes; the localhost one is only measured, so it stays.
	if len(kept) != 2 {
		t.Fatalf("kept %d events, want 2", len(kept))
	}
	for _, candidate := range kept {
		for _, flag := range candidate.IngestFlags {
			if flag == "bot" {
				t.Fatal("an enforced category must not survive")
			}
		}
	}
	counts := filteredCounts(t, registry)
	if counts["bot"] != 1 || counts["localhost"] != 1 {
		t.Fatalf("counts = %v", counts)
	}
	// Both modes must be reported, or the runbook reconciliation cannot tell
	// how many of the matches actually removed an event.
	modes := map[string]bool{}
	for _, mode := range modesSeen(t, registry) {
		modes[mode] = true
	}
	if !modes[filterModeEnforced] || !modes[filterModeDryRun] {
		t.Fatalf("modes = %v, want both", modes)
	}
}

func TestApplyInboundFiltersSkipsUnconfiguredProjects(t *testing.T) {
	compiled, err := filter.Compile(filter.Settings{})
	if err != nil {
		t.Fatal(err)
	}
	events := sampleEvents()
	if kept := applyInboundFilters(events, compiled, nil); len(kept) != 3 {
		t.Fatalf("kept %d events, want all 3 untouched", len(kept))
	}
}

type stubFilterRepository struct {
	settings filter.Settings
	calls    int
}

func (repository *stubFilterRepository) Get(context.Context, uuid.UUID) (filter.Settings, error) {
	repository.calls++
	return repository.settings, nil
}

func TestCachedFilterSettingsProviderCompilesOncePerWindow(t *testing.T) {
	repository := &stubFilterRepository{settings: filter.Settings{
		Builtin: map[filter.Reason]filter.Mode{filter.ReasonBot: filter.ModeEnforced},
	}}
	provider := NewCachedFilterSettingsProvider(repository, time.Minute)
	current := time.Now()
	provider.now = func() time.Time { return current }
	projectID := uuid.New()

	for range 3 {
		compiled, err := provider.Get(context.Background(), projectID)
		if err != nil {
			t.Fatal(err)
		}
		if !compiled.Active() {
			t.Fatal("expected active settings")
		}
	}
	if repository.calls != 1 {
		t.Fatalf("repository calls = %d, want 1", repository.calls)
	}

	// A change made in the Console has to take effect once the window passes.
	current = current.Add(2 * time.Minute)
	if _, err := provider.Get(context.Background(), projectID); err != nil {
		t.Fatal(err)
	}
	if repository.calls != 2 {
		t.Fatalf("repository calls after expiry = %d, want 2", repository.calls)
	}
}

func gatherFamilies(t *testing.T, registry *prometheus.Registry) []*dto.MetricFamily {
	t.Helper()
	families, err := registry.Gather()
	if err != nil {
		t.Fatal(err)
	}
	return families
}

func filteredCounts(t *testing.T, registry *prometheus.Registry) map[string]float64 {
	t.Helper()
	counts := map[string]float64{}
	for _, family := range gatherFamilies(t, registry) {
		if family.GetName() != "openrum_consumer_filtered_total" {
			continue
		}
		for _, metric := range family.Metric {
			for _, label := range metric.Label {
				if label.GetName() == "reason" {
					counts[label.GetValue()] += metric.GetCounter().GetValue()
				}
			}
		}
	}
	return counts
}

func modesSeen(t *testing.T, registry *prometheus.Registry) []string {
	t.Helper()
	var modes []string
	for _, family := range gatherFamilies(t, registry) {
		if family.GetName() != "openrum_consumer_filtered_total" {
			continue
		}
		for _, metric := range family.Metric {
			for _, label := range metric.Label {
				if label.GetName() == "mode" {
					modes = append(modes, label.GetValue())
				}
			}
		}
	}
	return modes
}
