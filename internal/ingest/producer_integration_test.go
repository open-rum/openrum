//go:build integration

package ingest

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/segmentio/kafka-go"

	"openrum/internal/event"
)

func TestKafkaProducerIntegrationPersistsAcknowledgedEnvelope(t *testing.T) {
	brokersValue := os.Getenv("TEST_KAFKA_BROKERS")
	if brokersValue == "" {
		t.Skip("TEST_KAFKA_BROKERS is not set")
	}
	brokers := strings.Split(brokersValue, ",")
	topic := os.Getenv("TEST_KAFKA_TOPIC")
	if topic == "" {
		topic = "rum-events-v1"
	}
	producer := NewKafkaProducer(brokers, topic)
	t.Cleanup(func() { _ = producer.Close() })

	projectID := uuid.New()
	sessionID := uuid.NewString()
	queued := QueuedEnvelope{
		QueueSchemaVersion: QueueSchemaVersion,
		ProjectID:          projectID,
		OrganizationID:     uuid.New(),
		ReceivedAt:         time.Now().UTC(),
		Envelope: event.EnvelopeV1{
			SchemaVersion: "1.0",
			Context:       event.EventContext{SessionID: sessionID},
			Events:        []event.EventV1{{EventID: uuid.NewString(), Type: event.EventTypePageView}},
		},
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := producer.Publish(ctx, queued); err != nil {
		t.Fatal(err)
	}

	reader := kafka.NewReader(kafka.ReaderConfig{
		Brokers: brokers,
		Topic:   topic,
		GroupID: "openrum-producer-integration-" + uuid.NewString(),
	})
	t.Cleanup(func() { _ = reader.Close() })
	wantKey := projectID.String() + ":" + sessionID
	for {
		message, err := reader.ReadMessage(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if string(message.Key) == wantKey {
			break
		}
	}
}
