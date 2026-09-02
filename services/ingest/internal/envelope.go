package ingestservice

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"

	"openrum/internal/event"
	"openrum/internal/ingest"
)

var ErrInvalidEnvelope = errors.New("invalid event envelope")

type EnvelopePublisher interface {
	Publish(context.Context, ingest.QueuedEnvelope) error
}

type KafkaAcceptor struct {
	publisher EnvelopePublisher
}

func NewKafkaAcceptor(publisher EnvelopePublisher) *KafkaAcceptor {
	return &KafkaAcceptor{publisher: publisher}
}

func (acceptor *KafkaAcceptor) Accept(ctx context.Context, accepted AcceptedEnvelope) (Acceptance, error) {
	queued := ingest.QueuedEnvelope{
		QueueSchemaVersion: ingest.QueueSchemaVersion,
		ProjectID:          accepted.Access.Project.ID,
		OrganizationID:     accepted.Access.Project.OrganizationID,
		ReceivedAt:         accepted.ReceivedAt,
		Origin:             accepted.Origin,
		ClientIP:           accepted.ClientIP,
		UserAgent:          accepted.UserAgent,
		Envelope:           accepted.Envelope,
	}
	if err := acceptor.publisher.Publish(ctx, queued); err != nil {
		return Acceptance{}, errors.Join(ErrDurableQueueUnavailable, err)
	}
	return Acceptance{Accepted: len(accepted.Envelope.Events), Rejected: accepted.Rejected}, nil
}

// validateEnvelope isolates invalid sibling events while still validating the
// envelope metadata against the canonical protocol schema. This permits a 207
// response without allowing a bad event to weaken validation of shared context.
func validateEnvelope(body []byte) (event.EnvelopeV1, []Rejection, error) {
	var document map[string]json.RawMessage
	if err := json.Unmarshal(body, &document); err != nil {
		return event.EnvelopeV1{}, nil, fmt.Errorf("%w: decode document: %w", ErrInvalidEnvelope, err)
	}
	eventsRaw, found := document["events"]
	if !found {
		return event.EnvelopeV1{}, nil, fmt.Errorf("%w: events are required", ErrInvalidEnvelope)
	}
	var candidates []json.RawMessage
	if err := json.Unmarshal(eventsRaw, &candidates); err != nil || len(candidates) == 0 || len(candidates) > 100 {
		return event.EnvelopeV1{}, nil, fmt.Errorf("%w: events must contain between 1 and 100 items", ErrInvalidEnvelope)
	}

	document["events"] = json.RawMessage(`[{
		"event_id":"00000000-0000-4000-8000-000000000000",
		"type":"page_view",
		"timestamp":"2026-01-01T00:00:00Z",
		"navigation_type":"navigate"
	}]`)
	metadataCandidate, err := json.Marshal(document)
	if err != nil || event.ValidateEnvelopeV1(metadataCandidate) != nil {
		return event.EnvelopeV1{}, nil, fmt.Errorf("%w: shared metadata does not match schema", ErrInvalidEnvelope)
	}
	validated, err := event.DecodeEnvelopeV1(metadataCandidate)
	if err != nil {
		return event.EnvelopeV1{}, nil, fmt.Errorf("%w: decode shared metadata: %w", ErrInvalidEnvelope, err)
	}
	validated.Events = make([]event.EventV1, 0, len(candidates))
	rejections := make([]Rejection, 0)
	for _, candidate := range candidates {
		document["events"] = marshalSingleEvent(candidate)
		candidateEnvelope, marshalErr := json.Marshal(document)
		if marshalErr != nil || event.ValidateEnvelopeV1(candidateEnvelope) != nil {
			rejections = append(rejections, Rejection{EventID: safeEventID(candidate), Code: "INVALID_EVENT"})
			continue
		}
		decoded, decodeErr := event.DecodeEnvelopeV1(candidateEnvelope)
		if decodeErr != nil || len(decoded.Events) != 1 {
			rejections = append(rejections, Rejection{EventID: safeEventID(candidate), Code: "INVALID_EVENT"})
			continue
		}
		validated.Events = append(validated.Events, decoded.Events[0])
	}
	return validated, rejections, nil
}

func marshalSingleEvent(candidate json.RawMessage) json.RawMessage {
	result := make([]byte, 0, len(candidate)+2)
	result = append(result, '[')
	result = append(result, candidate...)
	result = append(result, ']')
	return result
}

func safeEventID(candidate json.RawMessage) string {
	var value struct {
		EventID string `json:"event_id"`
	}
	if json.Unmarshal(candidate, &value) != nil {
		return ""
	}
	if _, err := uuid.Parse(value.EventID); err != nil {
		return ""
	}
	return value.EventID
}
