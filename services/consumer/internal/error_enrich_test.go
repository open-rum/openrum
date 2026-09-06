package consumerservice

import (
	"errors"
	"testing"

	"openrum/internal/event"
	"openrum/internal/fingerprint"
)

func TestEnrichErrorEventsGroupsEquivalentErrors(t *testing.T) {
	events := []event.CanonicalEvent{
		{EventType: event.EventTypeError, ErrorType: "TypeError", ErrorMessage: "Order 42 failed", ErrorStack: "at submit (https://shop.example/app.js:10:2)"},
		{EventType: event.EventTypeError, ErrorType: "TypeError", ErrorMessage: "Order 99 failed", ErrorStack: "at submit (https://shop.example/app.js:80:4)"},
	}
	enrichErrorEvents(events, fingerprint.Compute)
	if events[0].Fingerprint == "" || events[0].Fingerprint != events[1].Fingerprint || events[0].FingerprintVersion != fingerprint.Version {
		t.Fatalf("events=%+v", events)
	}
}

func TestEnrichmentFailureNeverDropsRawError(t *testing.T) {
	events := []event.CanonicalEvent{{EventType: event.EventTypeError, ErrorType: "Error", ErrorMessage: "raw remains"}}
	enrichErrorEvents(events, func(fingerprint.Input) (fingerprint.Result, error) {
		return fingerprint.Result{}, errors.New("fingerprint unavailable")
	})
	if events[0].ErrorMessage != "raw remains" || events[0].Fingerprint != "" || len(events[0].IngestFlags) != 1 || events[0].IngestFlags[0] != "fingerprint_failed" {
		t.Fatalf("event=%+v", events[0])
	}
}

func TestInvalidCustomFingerprintFallsBackToDerived(t *testing.T) {
	events := []event.CanonicalEvent{{
		EventType: event.EventTypeError, ErrorType: "Error", ErrorMessage: "fallback", CustomFingerprint: []string{"bad\nvalue"},
	}}
	enrichErrorEvents(events, fingerprint.Compute)
	if events[0].Fingerprint == "" || events[0].FingerprintVersion != fingerprint.Version || len(events[0].IngestFlags) != 1 || events[0].IngestFlags[0] != "fingerprint_fallback" {
		t.Fatalf("event=%+v", events[0])
	}
}
