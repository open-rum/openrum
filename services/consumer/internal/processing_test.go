package consumerservice

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/google/uuid"

	"openrum/internal/event"
	"openrum/internal/privacy"
	"openrum/internal/processing"
)

func compileProcessing(t *testing.T, settings processing.Settings) *processing.Compiled {
	t.Helper()
	compiled, err := processing.Compile(settings)
	if err != nil {
		t.Fatal(err)
	}
	return compiled
}

func TestApplyProcessingRulesCollapsesPagesAndRoutesTogether(t *testing.T) {
	compiled := compileProcessing(t, processing.Settings{URL: processing.URLRules{Rules: []processing.Rule{
		{ID: "orders", Target: processing.TargetBoth, Pattern: "/orders/:orderId"},
	}}})
	events := []event.CanonicalEvent{{
		EventID:           uuid.New(),
		EventType:         event.EventTypePageView,
		PageURL:           "https://shop.example.com/orders/8fc1",
		PageURLNormalized: "https://shop.example.com/orders/8fc1",
		Route:             "/orders/8fc1",
	}, {
		EventID:          uuid.New(),
		EventType:        event.EventTypeAPI,
		APIURLNormalized: "https://api.example.com/orders/9ab2",
	}}

	applyProcessingRules(events, compiled, nil)

	if events[0].PageURLNormalized != "https://shop.example.com/orders/:orderId" {
		t.Fatalf("page address is %q", events[0].PageURLNormalized)
	}
	if events[0].Route != "/orders/:orderId" {
		t.Fatalf("route is %q, want it to agree with the page address", events[0].Route)
	}
	// The concrete address is what a support conversation is anchored on, so
	// collapsing must not reach it.
	if events[0].PageURL != "https://shop.example.com/orders/8fc1" {
		t.Fatalf("concrete page URL is %q, want it untouched", events[0].PageURL)
	}
	if events[1].APIURLNormalized != "https://api.example.com/orders/:orderId" {
		t.Fatalf("API address is %q", events[1].APIURLNormalized)
	}
}

func TestApplyProcessingRulesRedactsAndFlags(t *testing.T) {
	compiled := compileProcessing(t, processing.Settings{Scrub: processing.ScrubRules{
		Patterns:      []processing.ScrubPattern{{ID: "order", Expression: `ORD-[0-9]{6}`}},
		SensitiveKeys: []string{"ssn"},
	}})
	events := []event.CanonicalEvent{{
		EventID:      uuid.New(),
		EventType:    event.EventTypeError,
		ErrorMessage: "checkout failed for ORD-123456",
		Attributes:   map[string]string{"tag.user_ssn": "123-45-6789", "tag.page": "checkout"},
		IngestFlags:  []string{},
	}}

	applyProcessingRules(events, compiled, nil)

	if strings.Contains(events[0].ErrorMessage, "123456") {
		t.Fatalf("error message is %q, want the order number gone", events[0].ErrorMessage)
	}
	if _, present := events[0].Attributes["tag.user_ssn"]; present {
		t.Fatal("an attribute the project named was kept")
	}
	if events[0].Attributes["tag.page"] != "checkout" {
		t.Fatal("an unrelated attribute was changed")
	}
	// The flag is how a reader of the stored row knows the text is not what
	// the page produced.
	if !hasFlag(events[0].IngestFlags, "pii_scrubbed") {
		t.Fatalf("ingest flags are %v, want pii_scrubbed", events[0].IngestFlags)
	}
}

func TestLogProjectScrubbingIncludesMessageLoggerAndAttributes(t *testing.T) {
	compiled := compileProcessing(t, processing.Settings{Scrub: processing.ScrubRules{Patterns: []processing.ScrubPattern{{ID: "order", Expression: `ORD-[0-9]{6}`}}, SensitiveKeys: []string{"internal_id"}}})
	events := []event.CanonicalEvent{{EventType: event.EventTypeLog, LogLevel: "error", LogMessage: "failed ORD-123456", LogLogger: "ORD-123456", Attributes: map[string]string{"internal_id": "private", "order": "ORD-123456"}}}
	applyProcessingRules(events, compiled, nil)
	encoded, _ := json.Marshal(events)
	if strings.Contains(string(encoded), "ORD-123456") || strings.Contains(string(encoded), "private") {
		t.Fatalf("unscrubbed log: %s", encoded)
	}
	if events[0].LogLevel != "error" {
		t.Fatal("level must remain queryable")
	}
}

func TestApplyProcessingRulesKeepsBreadcrumbsDecodable(t *testing.T) {
	// Running the pattern over the encoded form could replace the punctuation
	// holding the document together, so the breadcrumb is decoded first.
	compiled := compileProcessing(t, processing.Settings{Scrub: processing.ScrubRules{
		Patterns: []processing.ScrubPattern{{ID: "wide", Expression: `[",]+`}},
	}})
	encoded, err := json.Marshal(event.Breadcrumb{Category: "ui", Message: `clicked "buy"`})
	if err != nil {
		t.Fatal(err)
	}
	events := []event.CanonicalEvent{{
		EventID: uuid.New(), EventType: event.EventTypeError,
		Breadcrumbs: []string{string(encoded)}, IngestFlags: []string{},
	}}

	applyProcessingRules(events, compiled, nil)

	var breadcrumb event.Breadcrumb
	if err := json.Unmarshal([]byte(events[0].Breadcrumbs[0]), &breadcrumb); err != nil {
		t.Fatalf("breadcrumb no longer decodes: %v", err)
	}
	if !strings.Contains(breadcrumb.Message, privacy.Redacted) {
		t.Fatalf("breadcrumb message is %q, want the quotes redacted", breadcrumb.Message)
	}
}

func TestApplyProcessingRulesLeavesUnconfiguredProjectsAlone(t *testing.T) {
	compiled := compileProcessing(t, processing.Settings{})
	events := []event.CanonicalEvent{{
		EventID: uuid.New(), EventType: event.EventTypePageView,
		PageURLNormalized: "https://shop.example.com/orders/8fc1",
		ErrorMessage:      "ORD-123456", IngestFlags: []string{},
	}}

	applyProcessingRules(events, compiled, nil)

	if events[0].PageURLNormalized != "https://shop.example.com/orders/8fc1" ||
		events[0].ErrorMessage != "ORD-123456" || len(events[0].IngestFlags) != 0 {
		t.Fatalf("an unconfigured project had its events rewritten: %+v", events[0])
	}
}

func hasFlag(flags []string, value string) bool {
	for _, flag := range flags {
		if flag == value {
			return true
		}
	}
	return false
}
