package ingestservice

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	"openrum/internal/ingest"
	"openrum/internal/metadata"
)

type recordingPublisher struct {
	queued ingest.QueuedEnvelope
	err    error
	calls  int
}

func (publisher *recordingPublisher) Publish(_ context.Context, queued ingest.QueuedEnvelope) error {
	publisher.calls++
	publisher.queued = queued
	return publisher.err
}

func TestValidateEnvelopeIsolatesMalformedSibling(t *testing.T) {
	body := envelopeWithInvalidEvents(t, 1)
	validated, rejected, err := validateEnvelope(body)
	if err != nil {
		t.Fatal(err)
	}
	if len(validated.Events) != 4 || len(rejected) != 1 {
		t.Fatalf("accepted=%d rejected=%+v", len(validated.Events), rejected)
	}
	if rejected[0].Code != "INVALID_EVENT" || rejected[0].EventID == "" {
		t.Fatalf("rejection=%+v", rejected[0])
	}
}

func TestValidateEnvelopeRejectsInvalidSharedMetadata(t *testing.T) {
	var document map[string]any
	if err := json.Unmarshal(validEnvelope(t), &document); err != nil {
		t.Fatal(err)
	}
	document["unexpected"] = true
	body, err := json.Marshal(document)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := validateEnvelope(body); !errors.Is(err, ErrInvalidEnvelope) {
		t.Fatalf("error=%v", err)
	}
}

func TestKafkaAcceptorPublishesFilteredEnvelope(t *testing.T) {
	publisher := &recordingPublisher{}
	acceptor := NewKafkaAcceptor(publisher)
	projectID := uuid.New()
	organizationID := uuid.New()
	validated, rejected, err := validateEnvelope(envelopeWithInvalidEvents(t, 1))
	if err != nil {
		t.Fatal(err)
	}
	receivedAt := time.Date(2026, 9, 2, 12, 0, 0, 0, time.UTC)
	result, err := acceptor.Accept(context.Background(), AcceptedEnvelope{
		Access:   metadata.ProjectKeyAccess{Project: metadata.Project{ID: projectID, OrganizationID: organizationID}},
		Envelope: validated, Origin: "https://shop.example.com", ClientIP: "203.0.113.10", ReceivedAt: receivedAt, Rejected: rejected,
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Accepted != 4 || len(result.Rejected) != 1 || publisher.calls != 1 {
		t.Fatalf("result=%+v calls=%d", result, publisher.calls)
	}
	if publisher.queued.ProjectID != projectID || publisher.queued.OrganizationID != organizationID || len(publisher.queued.Envelope.Events) != 4 {
		t.Fatalf("queued=%+v", publisher.queued)
	}

	publisher.err = errors.New("broker unavailable")
	if _, err := acceptor.Accept(context.Background(), AcceptedEnvelope{Access: metadata.ProjectKeyAccess{Project: metadata.Project{ID: projectID}}, Envelope: validated}); !errors.Is(err, ErrDurableQueueUnavailable) {
		t.Fatalf("error=%v", err)
	}
}

func envelopeWithInvalidEvents(t testing.TB, invalidCount int) []byte {
	t.Helper()
	var document struct {
		Events []map[string]any `json:"events"`
	}
	body := validEnvelope(t)
	if err := json.Unmarshal(body, &document); err != nil {
		t.Fatal(err)
	}
	for index := 0; index < invalidCount && index < len(document.Events); index++ {
		document.Events[index]["unexpected"] = true
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(body, &raw); err != nil {
		t.Fatal(err)
	}
	events, err := json.Marshal(document.Events)
	if err != nil {
		t.Fatal(err)
	}
	raw["events"] = events
	result, err := json.Marshal(raw)
	if err != nil {
		t.Fatal(err)
	}
	return result
}
