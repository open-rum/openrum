package consumerservice

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/segmentio/kafka-go"

	"openrum/internal/event"
	"openrum/internal/fingerprint"
)

const DeadLetterSchemaVersion = "1.0"

type MessageSource interface {
	FetchMessage(context.Context) (kafka.Message, error)
	CommitMessages(context.Context, ...kafka.Message) error
	Close() error
}

type EventSink interface {
	WriteEvents(context.Context, []event.CanonicalEvent) error
}

type DeadLetterSink interface {
	WriteDeadLetters(context.Context, []DeadLetter) error
}

type DeadLetter struct {
	SchemaVersion string    `json:"schema_version"`
	SourceTopic   string    `json:"source_topic"`
	Partition     int       `json:"partition"`
	Offset        int64     `json:"offset"`
	EventID       string    `json:"event_id,omitempty"`
	Reason        string    `json:"reason"`
	PayloadSHA256 string    `json:"payload_sha256"`
	PayloadBytes  int       `json:"payload_bytes"`
	FailedAt      time.Time `json:"failed_at"`
}

type Consumer struct {
	source      MessageSource
	events      EventSink
	deadLetters DeadLetterSink
	now         func() time.Time
	metrics     *Metrics
	fingerprint errorFingerprinter
	retention   RetentionPolicyProvider
}

type ConsumerOption func(*Consumer)

func WithMetrics(metrics *Metrics) ConsumerOption {
	return func(consumer *Consumer) { consumer.metrics = metrics }
}

func WithRetentionPolicies(provider RetentionPolicyProvider) ConsumerOption {
	return func(consumer *Consumer) { consumer.retention = provider }
}

func NewConsumer(source MessageSource, events EventSink, deadLetters DeadLetterSink, options ...ConsumerOption) *Consumer {
	consumer := &Consumer{source: source, events: events, deadLetters: deadLetters, now: time.Now, fingerprint: fingerprint.Compute}
	for _, option := range options {
		option(consumer)
	}
	return consumer
}

func NewKafkaMessageSource(brokers []string, topic, groupID string) MessageSource {
	return kafka.NewReader(kafka.ReaderConfig{
		Brokers:        brokers,
		Topic:          topic,
		GroupID:        groupID,
		MinBytes:       1,
		MaxBytes:       2 * 1024 * 1024,
		MaxWait:        250 * time.Millisecond,
		CommitInterval: 0,
	})
}

func (consumer *Consumer) Run(ctx context.Context) error {
	fetchBackoff := 100 * time.Millisecond
	for {
		message, err := consumer.source.FetchMessage(ctx)
		if err != nil {
			if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
				return nil
			}
			if consumer.metrics != nil {
				consumer.metrics.observeRetry()
			}
			if !waitForRetry(ctx, fetchBackoff) {
				return nil
			}
			fetchBackoff = min(fetchBackoff*2, 5*time.Second)
			continue
		}
		fetchBackoff = 100 * time.Millisecond
		backoff := 100 * time.Millisecond
		for {
			err = consumer.processMessage(ctx, message)
			if err == nil {
				break
			}
			if consumer.metrics != nil {
				consumer.metrics.observeRetry()
			}
			if !waitForRetry(ctx, backoff) {
				return nil
			}
			backoff = min(backoff*2, 5*time.Second)
		}
	}
}

func (consumer *Consumer) ConsumeOne(ctx context.Context) error {
	message, err := consumer.source.FetchMessage(ctx)
	if err != nil {
		return fmt.Errorf("fetch Kafka message: %w", err)
	}
	return consumer.processMessage(ctx, message)
}

func (consumer *Consumer) processMessage(ctx context.Context, message kafka.Message) error {
	started := time.Now()
	if consumer.metrics != nil {
		consumer.metrics.observeFetched(message.Time)
	}
	normalized, failures, normalizeErr := event.NormalizeQueuedEnvelope(message.Value)
	deadLetters := make([]DeadLetter, 0, max(1, len(failures)))
	if normalizeErr != nil {
		deadLetters = append(deadLetters, consumer.deadLetter(message, "INVALID_ENVELOPE", ""))
	} else {
		for _, failure := range failures {
			deadLetters = append(deadLetters, consumer.deadLetter(message, failure.Code, failure.EventID))
		}
	}
	if len(normalized) > 0 {
		if consumer.retention == nil {
			return fmt.Errorf("resolve event retention: no retention policy provider configured")
		}
		policy, err := consumer.retention.Get(ctx, normalized[0].ProjectID)
		if err != nil {
			return fmt.Errorf("resolve event retention: %w", err)
		}
		if err := applyRetentionPolicy(normalized, policy); err != nil {
			return fmt.Errorf("apply event retention: %w", err)
		}
		enrichErrorEvents(normalized, consumer.fingerprint)
		if err := consumer.events.WriteEvents(ctx, normalized); err != nil {
			return fmt.Errorf("write canonical events: %w", err)
		}
	}
	if len(deadLetters) > 0 {
		if err := consumer.deadLetters.WriteDeadLetters(ctx, deadLetters); err != nil {
			return fmt.Errorf("write dead letters: %w", err)
		}
	}
	if err := consumer.source.CommitMessages(ctx, message); err != nil {
		return fmt.Errorf("commit Kafka message: %w", err)
	}
	if consumer.metrics != nil {
		consumer.metrics.observeProcessed(normalized, deadLetters, started)
	}
	return nil
}

func waitForRetry(ctx context.Context, duration time.Duration) bool {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

func (consumer *Consumer) Close() error { return consumer.source.Close() }

func (consumer *Consumer) deadLetter(message kafka.Message, reason, eventID string) DeadLetter {
	digest := sha256.Sum256(message.Value)
	return DeadLetter{
		SchemaVersion: DeadLetterSchemaVersion,
		SourceTopic:   boundedValue(message.Topic, 249),
		Partition:     message.Partition,
		Offset:        message.Offset,
		EventID:       boundedEventID(eventID),
		Reason:        boundedReason(reason),
		PayloadSHA256: fmt.Sprintf("%x", digest[:]),
		PayloadBytes:  len(message.Value),
		FailedAt:      consumer.now().UTC(),
	}
}

type KafkaDeadLetterSink struct {
	writer *kafka.Writer
}

func NewKafkaDeadLetterSink(brokers []string, topic string) *KafkaDeadLetterSink {
	return &KafkaDeadLetterSink{writer: &kafka.Writer{
		Addr: kafka.TCP(brokers...), Topic: topic, Balancer: &kafka.Hash{}, RequiredAcks: kafka.RequireAll,
		Async: false, MaxAttempts: 3, BatchSize: 100, BatchBytes: 1024 * 1024, BatchTimeout: 5 * time.Millisecond,
		AllowAutoTopicCreation: false,
		ReadTimeout:            2 * time.Second, WriteTimeout: 2 * time.Second,
	}}
}

func (sink *KafkaDeadLetterSink) WriteDeadLetters(ctx context.Context, letters []DeadLetter) error {
	messages := make([]kafka.Message, 0, len(letters))
	for _, letter := range letters {
		value, err := json.Marshal(letter)
		if err != nil {
			return fmt.Errorf("marshal dead letter: %w", err)
		}
		key := fmt.Sprintf("%s:%d:%d:%s", letter.SourceTopic, letter.Partition, letter.Offset, letter.EventID)
		messages = append(messages, kafka.Message{Key: []byte(key), Value: value, Time: letter.FailedAt})
	}
	if err := sink.writer.WriteMessages(ctx, messages...); err != nil {
		return fmt.Errorf("publish dead letters: %w", err)
	}
	return nil
}

func (sink *KafkaDeadLetterSink) Close() error { return sink.writer.Close() }

func boundedReason(value string) string {
	switch value {
	case "INVALID_ENVELOPE", "INVALID_EVENT", "UNSUPPORTED_SCHEMA":
		return value
	default:
		return "OTHER"
	}
}

func boundedEventID(value string) string {
	if len(value) > 64 {
		return ""
	}
	return value
}

func boundedValue(value string, maximum int) string {
	if len(value) > maximum {
		return value[:maximum]
	}
	return value
}
