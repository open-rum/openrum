package consumerservice

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/segmentio/kafka-go"

	"openrum/internal/event"
	"openrum/internal/ingest"
	"openrum/internal/metadata"
)

type fakeSource struct {
	message   kafka.Message
	fetchErr  error
	commitErr error
	commits   int
	closed    bool
}

func (source *fakeSource) FetchMessage(context.Context) (kafka.Message, error) {
	return source.message, source.fetchErr
}
func (source *fakeSource) CommitMessages(context.Context, ...kafka.Message) error {
	if source.commitErr == nil {
		source.commits++
	}
	return source.commitErr
}
func (source *fakeSource) Close() error { source.closed = true; return nil }

type fakeEventSink struct {
	events []event.CanonicalEvent
	err    error
}

func (sink *fakeEventSink) WriteEvents(_ context.Context, events []event.CanonicalEvent) error {
	if sink.err == nil {
		sink.events = append(sink.events, events...)
	}
	return sink.err
}

type fakeDeadLetterSink struct {
	letters []DeadLetter
	err     error
}

type fixedRetentionPolicies struct {
	policy metadata.ProjectRetentionPolicy
	err    error
}

func (policies fixedRetentionPolicies) Get(context.Context, uuid.UUID) (metadata.ProjectRetentionPolicy, error) {
	return policies.policy, policies.err
}

func (sink *fakeDeadLetterSink) WriteDeadLetters(_ context.Context, letters []DeadLetter) error {
	if sink.err == nil {
		sink.letters = append(sink.letters, letters...)
	}
	return sink.err
}

func TestConsumerWritesValidEventsBeforeCommitting(t *testing.T) {
	source, events, deadLetters, consumer := testConsumer(t, validQueuePayload(t))
	if err := consumer.ConsumeOne(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(events.events) != 5 || len(deadLetters.letters) != 0 || source.commits != 1 {
		t.Fatalf("events=%d deadLetters=%d commits=%d", len(events.events), len(deadLetters.letters), source.commits)
	}
	for _, current := range events.events {
		if !current.RawExpiresAt.Equal(current.Timestamp.AddDate(0, 0, 14)) ||
			!current.AggregateExpiresAt.Equal(current.Timestamp.AddDate(0, 0, 90)) {
			t.Fatalf("event expiry raw=%s aggregate=%s timestamp=%s", current.RawExpiresAt, current.AggregateExpiresAt, current.Timestamp)
		}
	}
	if err := consumer.Close(); err != nil || !source.closed {
		t.Fatalf("close=%v closed=%v", err, source.closed)
	}
}

func TestConsumerIsolatesMalformedSiblingAndEmitsMetadataOnlyDLQ(t *testing.T) {
	payload := validQueuePayload(t)
	var queued map[string]json.RawMessage
	if err := json.Unmarshal(payload, &queued); err != nil {
		t.Fatal(err)
	}
	var envelope map[string]json.RawMessage
	if err := json.Unmarshal(queued["envelope"], &envelope); err != nil {
		t.Fatal(err)
	}
	var events []json.RawMessage
	if err := json.Unmarshal(envelope["events"], &events); err != nil {
		t.Fatal(err)
	}
	events[0] = json.RawMessage(`{"event_id":"018f4d9c-83a1-76c9-81c2-3020ab667001","type":"unknown"}`)
	envelope["events"], _ = json.Marshal(events)
	queued["envelope"], _ = json.Marshal(envelope)
	payload, _ = json.Marshal(queued)

	source, canonical, deadLetters, consumer := testConsumer(t, payload)
	if err := consumer.ConsumeOne(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(canonical.events) != 4 || len(deadLetters.letters) != 1 || source.commits != 1 {
		t.Fatalf("events=%d deadLetters=%+v commits=%d", len(canonical.events), deadLetters.letters, source.commits)
	}
	letter := deadLetters.letters[0]
	if letter.Reason != "INVALID_EVENT" || letter.PayloadSHA256 == "" || letter.PayloadBytes != len(payload) {
		t.Fatalf("dead letter=%+v", letter)
	}
	encoded, _ := json.Marshal(letter)
	if string(encoded) == string(payload) {
		t.Fatal("DLQ must not copy the untrusted payload")
	}
}

func TestConsumerDoesNotCommitWhenDLQOrEventSinkFails(t *testing.T) {
	for _, test := range []struct {
		name      string
		payload   []byte
		configure func(*fakeEventSink, *fakeDeadLetterSink)
	}{
		{name: "event sink", payload: validQueuePayload(t), configure: func(events *fakeEventSink, _ *fakeDeadLetterSink) { events.err = errors.New("ClickHouse unavailable") }},
		{name: "dead letter sink", payload: []byte("invalid"), configure: func(_ *fakeEventSink, deadLetters *fakeDeadLetterSink) {
			deadLetters.err = errors.New("DLQ unavailable")
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			source, events, deadLetters, consumer := testConsumer(t, test.payload)
			test.configure(events, deadLetters)
			if err := consumer.ConsumeOne(context.Background()); err == nil {
				t.Fatal("expected sink error")
			}
			if source.commits != 0 {
				t.Fatalf("commits=%d", source.commits)
			}
		})
	}
}

func TestConsumerDoesNotCommitWhenRetentionCannotBeResolved(t *testing.T) {
	source, events, deadLetters, consumer := testConsumer(t, validQueuePayload(t))
	consumer.retention = fixedRetentionPolicies{err: errors.New("Postgres unavailable")}
	if err := consumer.ConsumeOne(context.Background()); err == nil {
		t.Fatal("expected retention resolver error")
	}
	if source.commits != 0 || len(events.events) != 0 || len(deadLetters.letters) != 0 {
		t.Fatalf("commits=%d events=%d deadLetters=%d", source.commits, len(events.events), len(deadLetters.letters))
	}
}

// A Project deleted or stopped while its events sit in Kafka must not stall the
// shared partition: those events are dropped and the offset moves on.
func TestConsumerDropsEventsOfInactiveProjectsAndCommits(t *testing.T) {
	source, events, deadLetters, consumer := testConsumer(t, validQueuePayload(t))
	consumer.retention = fixedRetentionPolicies{err: fmt.Errorf("lookup: %w", metadata.ErrNotFound)}
	if err := consumer.ConsumeOne(context.Background()); err != nil {
		t.Fatal(err)
	}
	if source.commits != 1 || len(events.events) != 0 || len(deadLetters.letters) != 0 {
		t.Fatalf("commits=%d events=%d deadLetters=%d", source.commits, len(events.events), len(deadLetters.letters))
	}
}

func testConsumer(t *testing.T, payload []byte) (*fakeSource, *fakeEventSink, *fakeDeadLetterSink, *Consumer) {
	t.Helper()
	source := &fakeSource{message: kafka.Message{Topic: "rum-events-v1", Partition: 2, Offset: 42, Value: payload}}
	events := &fakeEventSink{}
	deadLetters := &fakeDeadLetterSink{}
	consumer := NewConsumer(source, events, deadLetters, WithRetentionPolicies(fixedRetentionPolicies{
		policy: metadata.ProjectRetentionPolicy{RawDays: 14, AggregateDays: 90},
	}))
	consumer.now = func() time.Time { return time.Date(2026, 9, 2, 10, 0, 0, 0, time.UTC) }
	return source, events, deadLetters, consumer
}

func validQueuePayload(t *testing.T) []byte {
	t.Helper()
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve fixture")
	}
	fixture, err := os.ReadFile(filepath.Join(filepath.Dir(filename), "..", "..", "..", "packages", "protocol", "fixtures", "valid-all-events.json"))
	if err != nil {
		t.Fatal(err)
	}
	envelope, err := event.DecodeEnvelopeV1(fixture)
	if err != nil {
		t.Fatal(err)
	}
	payload, err := json.Marshal(ingest.QueuedEnvelope{
		QueueSchemaVersion: ingest.QueueSchemaVersion,
		ProjectID:          uuid.New(), OrganizationID: uuid.New(), ReceivedAt: time.Now().UTC(),
		UserAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128.0 Safari/537.36",
		Envelope:  envelope,
	})
	if err != nil {
		t.Fatal(err)
	}
	return payload
}
