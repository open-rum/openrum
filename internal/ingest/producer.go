package ingest

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/segmentio/kafka-go"

	"openrum/internal/event"
)

const QueueSchemaVersion = event.QueueSchemaVersion
const PreviousQueueSchemaVersion = event.PreviousQueueSchemaVersion

type QueuedEnvelope struct {
	QueueSchemaVersion string    `json:"queue_schema_version"`
	ProjectID          uuid.UUID `json:"project_id"`
	OrganizationID     uuid.UUID `json:"organization_id"`
	ReceivedAt         time.Time `json:"received_at"`
	Origin             string    `json:"origin"`
	ClientIP           string    `json:"client_ip"`
	// ClientCountry is resolved at the edge, where the trust decision about the
	// proxy can still be made. Messages written before this field existed omit
	// it, which reads as an unknown country rather than a wrong one.
	ClientCountry string           `json:"client_country,omitempty"`
	UserAgent     string           `json:"user_agent"`
	Synthetic     bool             `json:"synthetic,omitempty"`
	Envelope      event.EnvelopeV1 `json:"envelope"`
}

type MessageWriter interface {
	WriteMessages(context.Context, ...kafka.Message) error
	Close() error
}

type KafkaProducer struct {
	writer MessageWriter
}

func NewKafkaProducer(brokers []string, topic string) *KafkaProducer {
	writer := &kafka.Writer{
		Addr:            kafka.TCP(brokers...),
		Topic:           topic,
		Balancer:        &kafka.Hash{},
		MaxAttempts:     3,
		WriteBackoffMin: 50 * time.Millisecond,
		WriteBackoffMax: 500 * time.Millisecond,
		BatchSize:       100,
		// The queue wrapper adds trusted metadata around a body that may itself
		// be 1 MiB, so the broker/topic limit must permit a 2 MiB record.
		BatchBytes:             2 * MaxRawBodyBytes,
		BatchTimeout:           5 * time.Millisecond,
		ReadTimeout:            5 * time.Second,
		WriteTimeout:           5 * time.Second,
		RequiredAcks:           kafka.RequireAll,
		Async:                  false,
		Compression:            kafka.Snappy,
		AllowAutoTopicCreation: false,
	}
	return &KafkaProducer{writer: writer}
}

func NewKafkaProducerWithWriter(writer MessageWriter) *KafkaProducer {
	return &KafkaProducer{writer: writer}
}

func (producer *KafkaProducer) Publish(ctx context.Context, envelope QueuedEnvelope) error {
	value, err := json.Marshal(envelope)
	if err != nil {
		return fmt.Errorf("marshal queued envelope: %w", err)
	}
	partitionKey := envelope.ProjectID.String() + ":" + envelope.Envelope.Context.SessionID
	message := kafka.Message{
		Key:   []byte(partitionKey),
		Value: value,
		Time:  envelope.ReceivedAt,
		Headers: []kafka.Header{
			{Key: "content-type", Value: []byte("application/json")},
			{Key: "openrum-queue-schema", Value: []byte(QueueSchemaVersion)},
		},
	}
	if err := producer.writer.WriteMessages(ctx, message); err != nil {
		return fmt.Errorf("publish queued envelope: %w", err)
	}
	return nil
}

func (producer *KafkaProducer) Close() error {
	return producer.writer.Close()
}
