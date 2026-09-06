package event

import (
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestNewSyntheticEnvelopeIsProtocolValidAndUnsampled(t *testing.T) {
	at := time.Date(2026, 9, 2, 12, 34, 56, 789_000_000, time.FixedZone("CST", 8*60*60))
	first, err := NewSyntheticEnvelope("production", at)
	if err != nil {
		t.Fatal(err)
	}
	second, err := NewSyntheticEnvelope("production", at)
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(first)
	if err != nil {
		t.Fatal(err)
	}
	if err := ValidateEnvelopeV1(encoded); err != nil {
		t.Fatalf("synthetic envelope is not protocol valid: %v\n%s", err, encoded)
	}
	if first.SDK.Name != SyntheticSDKName || first.Context.Page.Route != SyntheticRoute || len(first.Events) != 1 {
		t.Fatalf("unexpected synthetic envelope: %+v", first)
	}
	current := first.Events[0]
	if current.Type != EventTypePageView || current.SampleRate == nil || *current.SampleRate != 1 ||
		current.EventID == second.Events[0].EventID || first.Context.SessionID == second.Context.SessionID {
		t.Fatalf("synthetic identity or sampling is invalid: first=%+v second=%+v", first, second)
	}
	wantTimestamp := at.UTC().Format(time.RFC3339Nano)
	if first.SentAt != wantTimestamp || current.Timestamp != wantTimestamp {
		t.Fatalf("timestamps sent=%q event=%q want=%q", first.SentAt, current.Timestamp, wantTimestamp)
	}
}

func TestNewSyntheticEnvelopeRejectsIncompleteInput(t *testing.T) {
	if _, err := NewSyntheticEnvelope("", time.Now()); !errors.Is(err, ErrInvalidSyntheticEvent) {
		t.Fatalf("empty environment error=%v", err)
	}
	if _, err := NewSyntheticEnvelope("production", time.Time{}); !errors.Is(err, ErrInvalidSyntheticEvent) {
		t.Fatalf("zero time error=%v", err)
	}
}

func TestNormalizeQueuedEnvelopePreservesTrustedSyntheticMarker(t *testing.T) {
	at := time.Date(2026, 9, 2, 4, 0, 0, 0, time.UTC)
	envelope, err := NewSyntheticEnvelope("production", at)
	if err != nil {
		t.Fatal(err)
	}
	queued := map[string]any{
		"queue_schema_version": QueueSchemaVersion,
		"project_id":           uuid.New(), "organization_id": uuid.New(),
		"received_at": at, "origin": "https://openrum.invalid",
		"client_ip": "", "user_agent": SyntheticSDKName,
		"synthetic": true, "envelope": envelope,
	}
	payload, err := json.Marshal(queued)
	if err != nil {
		t.Fatal(err)
	}
	events, failures, err := NormalizeQueuedEnvelope(payload)
	if err != nil || len(failures) != 0 || len(events) != 1 {
		t.Fatalf("events=%d failures=%+v err=%v", len(events), failures, err)
	}
	if len(events[0].IngestFlags) != 1 || events[0].IngestFlags[0] != "synthetic" {
		t.Fatalf("ingest flags=%v", events[0].IngestFlags)
	}
}
