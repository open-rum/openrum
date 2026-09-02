package ingest

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/segmentio/kafka-go"

	"openrum/internal/event"
)

type recordingMessageWriter struct {
	messages []kafka.Message
	err      error
	writes   int
	closed   bool
}

func (writer *recordingMessageWriter) WriteMessages(_ context.Context, messages ...kafka.Message) error {
	writer.writes++
	if writer.err != nil {
		return writer.err
	}
	writer.messages = append(writer.messages, messages...)
	return nil
}

func (writer *recordingMessageWriter) Close() error {
	writer.closed = true
	return nil
}

func TestKafkaProducerPublishesOnePartitionedEnvelopeAfterAck(t *testing.T) {
	writer := &recordingMessageWriter{}
	producer := NewKafkaProducerWithWriter(writer)
	projectID := uuid.New()
	receivedAt := time.Date(2026, 9, 2, 12, 0, 0, 0, time.UTC)
	queued := QueuedEnvelope{
		QueueSchemaVersion: QueueSchemaVersion,
		ProjectID:          projectID,
		OrganizationID:     uuid.New(),
		ReceivedAt:         receivedAt,
		Origin:             "https://shop.example.com",
		ClientIP:           "203.0.113.10",
		Envelope: event.EnvelopeV1{
			SchemaVersion: "1.0",
			Context:       event.EventContext{SessionID: uuid.NewString()},
			Events:        []event.EventV1{{EventID: uuid.NewString(), Type: event.EventTypePageView}},
		},
	}
	if err := producer.Publish(context.Background(), queued); err != nil {
		t.Fatal(err)
	}
	if writer.writes != 1 || len(writer.messages) != 1 {
		t.Fatalf("writes=%d messages=%d", writer.writes, len(writer.messages))
	}
	message := writer.messages[0]
	if got, want := string(message.Key), projectID.String()+":"+queued.Envelope.Context.SessionID; got != want {
		t.Fatalf("partition key=%q want=%q", got, want)
	}
	if !message.Time.Equal(receivedAt) {
		t.Fatalf("message time=%s", message.Time)
	}
	var decoded QueuedEnvelope
	if err := json.Unmarshal(message.Value, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.ProjectID != projectID || len(decoded.Envelope.Events) != 1 {
		t.Fatalf("decoded queue record=%+v", decoded)
	}
	if err := producer.Close(); err != nil || !writer.closed {
		t.Fatalf("close error=%v closed=%v", err, writer.closed)
	}
}

func TestKafkaProducerReportsFailureAndAllowsCallerRetry(t *testing.T) {
	writer := &recordingMessageWriter{err: errors.New("broker unavailable")}
	producer := NewKafkaProducerWithWriter(writer)
	queued := QueuedEnvelope{ProjectID: uuid.New(), Envelope: event.EnvelopeV1{Context: event.EventContext{SessionID: uuid.NewString()}}}
	if err := producer.Publish(context.Background(), queued); err == nil {
		t.Fatal("expected broker failure")
	}
	writer.err = nil
	if err := producer.Publish(context.Background(), queued); err != nil {
		t.Fatalf("retry failed: %v", err)
	}
	if writer.writes != 2 || len(writer.messages) != 1 {
		t.Fatalf("writes=%d messages=%d", writer.writes, len(writer.messages))
	}
}

func TestKafkaProducerUsesSynchronousISRDurability(t *testing.T) {
	producer := NewKafkaProducer([]string{"127.0.0.1:9092"}, "rum-events-v1")
	writer, ok := producer.writer.(*kafka.Writer)
	if !ok {
		t.Fatalf("writer type=%T", producer.writer)
	}
	if writer.Async || writer.RequiredAcks != kafka.RequireAll || writer.AllowAutoTopicCreation {
		t.Fatalf("unsafe writer configuration: async=%v acks=%v autoCreate=%v", writer.Async, writer.RequiredAcks, writer.AllowAutoTopicCreation)
	}
}
