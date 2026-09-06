//go:build integration

package consumerservice

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"openrum/internal/event"
	"openrum/internal/ingest"
	"openrum/internal/metadata"
	"openrum/internal/migrate"
	"openrum/migrations"
)

func TestKafkaToClickHousePipelineHasNoSilentLoss(t *testing.T) {
	brokersValue := os.Getenv("TEST_KAFKA_BROKERS")
	if brokersValue == "" {
		t.Skip("TEST_KAFKA_BROKERS is not set")
	}
	brokers := strings.Split(brokersValue, ",")
	topic := os.Getenv("TEST_KAFKA_TOPIC")
	if topic == "" {
		topic = "rum-events-v1"
	}
	dsn := safeClickHouseIntegrationDSN(t)
	database, err := migrate.OpenClickHouse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if err := migrate.ClickHouseUp(ctx, database, migrations.Files); err != nil {
		t.Fatal(err)
	}
	if _, err := database.ExecContext(ctx, "TRUNCATE TABLE rum_events_local"); err != nil {
		t.Fatal(err)
	}

	var queued ingest.QueuedEnvelope
	if err := json.Unmarshal(validQueuePayload(t), &queued); err != nil {
		t.Fatal(err)
	}
	queued.ProjectID = uuid.New()
	queued.OrganizationID = uuid.New()
	queued.ReceivedAt = time.Now().UTC().Truncate(time.Millisecond)
	redisAddress := os.Getenv("TEST_REDIS_ADDR")
	if redisAddress == "" {
		t.Skip("TEST_REDIS_ADDR is not set")
	}
	redisClient := redis.NewClient(&redis.Options{Addr: redisAddress, DB: 14})
	t.Cleanup(func() { _ = redisClient.Close() })
	t.Cleanup(func() {
		_ = redisClient.Del(context.Background(), "openrum:connection:"+queued.ProjectID.String()).Err()
	})
	connectionStatus := ingest.NewRedisConnectionStatus(redisClient)
	if err := connectionStatus.MarkEventReceived(ctx, queued.ProjectID, queued.ReceivedAt); err != nil {
		t.Fatal(err)
	}
	producer := ingest.NewKafkaProducer(brokers, topic)
	if err := producer.Publish(ctx, queued); err != nil {
		t.Fatal(err)
	}
	if err := producer.Close(); err != nil {
		t.Fatal(err)
	}

	writer, err := OpenBufferedClickHouseWriter(ctx, dsn, ClickHouseWriterOptions{
		FlushInterval: 5 * time.Millisecond, ConnectionStatus: connectionStatus,
	})
	if err != nil {
		t.Fatal(err)
	}
	source := NewKafkaMessageSource(brokers, topic, "openrum-pipeline-integration-"+uuid.NewString())
	deadLetters := &fakeDeadLetterSink{}
	consumer := NewConsumer(source, writer, deadLetters, WithRetentionPolicies(fixedRetentionPolicies{
		policy: metadata.ProjectRetentionPolicy{RawDays: 14, AggregateDays: 90},
	}))
	for {
		if err := consumer.ConsumeOne(ctx); err != nil {
			t.Fatal(err)
		}
		var count uint64
		if err := database.QueryRowContext(ctx, "SELECT count() FROM rum_events WHERE project_id = ?", queued.ProjectID).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count == uint64(len(queued.Envelope.Events)) {
			break
		}
	}
	if err := consumer.Close(); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}

	var distinct uint64
	if err := database.QueryRowContext(ctx, "SELECT uniqExact(event_id) FROM rum_events WHERE project_id = ?", queued.ProjectID).Scan(&distinct); err != nil {
		t.Fatal(err)
	}
	if distinct != uint64(len(queued.Envelope.Events)) {
		t.Fatalf("distinct events=%d want=%d", distinct, len(queued.Envelope.Events))
	}
	status, err := connectionStatus.GetConnectionStatus(ctx, queued.ProjectID)
	if err != nil {
		t.Fatal(err)
	}
	if status.LastEventReceivedAt == nil || !status.LastEventReceivedAt.Equal(queued.ReceivedAt) ||
		status.LastEventQueryableAt == nil || !status.LastEventQueryableAt.Equal(queued.ReceivedAt) {
		t.Fatalf("connection status did not follow Kafka and ClickHouse durability: %+v", status)
	}
	for _, expectedType := range []event.EventType{event.EventTypePageView, event.EventTypeError, event.EventTypeWebVital, event.EventTypeAPI, event.EventTypeCustom} {
		var count uint64
		if err := database.QueryRowContext(ctx, "SELECT count() FROM rum_events WHERE project_id = ? AND event_type = ?", queued.ProjectID, string(expectedType)).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count != 1 {
			t.Fatalf("event type %s count=%d", expectedType, count)
		}
	}
}

func TestSyntheticEventTraversesPipelineWithoutOverviewContamination(t *testing.T) {
	brokersValue := os.Getenv("TEST_KAFKA_BROKERS")
	if brokersValue == "" {
		t.Skip("TEST_KAFKA_BROKERS is not set")
	}
	topic := os.Getenv("TEST_KAFKA_TOPIC")
	if topic == "" {
		topic = "rum-events-v1"
	}
	dsn := safeClickHouseIntegrationDSN(t)
	database, err := migrate.OpenClickHouse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if err := migrate.ClickHouseUp(ctx, database, migrations.Files); err != nil {
		t.Fatal(err)
	}

	acceptedAt := time.Now().UTC().Truncate(time.Millisecond)
	envelope, err := event.NewSyntheticEnvelope("production", acceptedAt)
	if err != nil {
		t.Fatal(err)
	}
	queued := ingest.QueuedEnvelope{
		QueueSchemaVersion: ingest.QueueSchemaVersion,
		ProjectID:          uuid.New(), OrganizationID: uuid.New(), ReceivedAt: acceptedAt,
		Origin: "https://openrum.invalid", UserAgent: event.SyntheticSDKName,
		Synthetic: true, Envelope: envelope,
	}
	brokers := strings.Split(brokersValue, ",")
	producer := ingest.NewKafkaProducer(brokers, topic)
	if err := producer.Publish(ctx, queued); err != nil {
		t.Fatal(err)
	}
	if err := producer.Close(); err != nil {
		t.Fatal(err)
	}

	writer, err := OpenBufferedClickHouseWriter(ctx, dsn, ClickHouseWriterOptions{FlushInterval: 5 * time.Millisecond})
	if err != nil {
		t.Fatal(err)
	}
	source := NewKafkaMessageSource(brokers, topic, "openrum-synthetic-integration-"+uuid.NewString())
	consumer := NewConsumer(source, writer, &fakeDeadLetterSink{}, WithRetentionPolicies(fixedRetentionPolicies{
		policy: metadata.ProjectRetentionPolicy{RawDays: 14, AggregateDays: 90},
	}))
	for {
		if err := consumer.ConsumeOne(ctx); err != nil {
			t.Fatal(err)
		}
		var count uint64
		if err := database.QueryRowContext(ctx,
			"SELECT count() FROM rum_events WHERE project_id = ? AND event_id = ? AND has(ingest_flags, 'synthetic')",
			queued.ProjectID, envelope.Events[0].EventID,
		).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count == 1 {
			break
		}
	}
	if err := consumer.Close(); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}

	var overviewRows uint64
	if err := database.QueryRowContext(ctx,
		"SELECT count() FROM project_metrics_1m WHERE project_id = ?", queued.ProjectID,
	).Scan(&overviewRows); err != nil {
		t.Fatal(err)
	}
	if overviewRows != 0 {
		t.Fatalf("synthetic Event created %d overview aggregate rows", overviewRows)
	}
}
