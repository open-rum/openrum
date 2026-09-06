package ingest

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

func TestRedisConnectionStatusStagesAdvanceIndependently(t *testing.T) {
	address := os.Getenv("TEST_REDIS_ADDR")
	if address == "" {
		t.Skip("TEST_REDIS_ADDR is not set")
	}
	client := redis.NewClient(&redis.Options{Addr: address, DB: 14})
	defer func() { _ = client.Close() }()
	tracker := NewRedisConnectionStatus(client)
	projectID := uuid.New()
	key := connectionStatusKey(projectID)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	defer func() { _ = client.Del(context.WithoutCancel(ctx), key).Err() }()

	base := time.Date(2026, 9, 2, 8, 30, 0, 123_000_000, time.UTC)
	assertConnectionStatus(t, tracker, ctx, projectID, ConnectionStatus{})
	if err := tracker.MarkSDKSeen(ctx, projectID, base); err != nil {
		t.Fatal(err)
	}
	assertConnectionStatus(t, tracker, ctx, projectID, ConnectionStatus{LastSDKSeenAt: &base})

	received := base.Add(time.Second)
	if err := tracker.MarkEventReceived(ctx, projectID, received); err != nil {
		t.Fatal(err)
	}
	assertConnectionStatus(t, tracker, ctx, projectID, ConnectionStatus{LastSDKSeenAt: &base, LastEventReceivedAt: &received})

	queryable := base.Add(2 * time.Second)
	if err := tracker.MarkEventQueryable(ctx, projectID, queryable); err != nil {
		t.Fatal(err)
	}
	assertConnectionStatus(t, tracker, ctx, projectID, ConnectionStatus{LastSDKSeenAt: &base, LastEventReceivedAt: &received, LastEventQueryableAt: &queryable})

	rejectAt := base.Add(3 * time.Second)
	reason := RejectOriginRejected
	if err := tracker.MarkRejected(ctx, projectID, rejectAt, reason); err != nil {
		t.Fatal(err)
	}
	assertConnectionStatus(t, tracker, ctx, projectID, ConnectionStatus{
		LastSDKSeenAt: &base, LastEventReceivedAt: &received, LastEventQueryableAt: &queryable,
		LastRejectReason: &reason, LastRejectAt: &rejectAt,
	})

	if err := tracker.MarkEventReceived(ctx, projectID, base.Add(-time.Hour)); err != nil {
		t.Fatal(err)
	}
	if err := tracker.MarkRejected(ctx, projectID, base, RejectRateLimited); err != nil {
		t.Fatal(err)
	}
	assertConnectionStatus(t, tracker, ctx, projectID, ConnectionStatus{
		LastSDKSeenAt: &base, LastEventReceivedAt: &received, LastEventQueryableAt: &queryable,
		LastRejectReason: &reason, LastRejectAt: &rejectAt,
	})

	ttl, err := client.PTTL(ctx, key).Result()
	if err != nil || ttl <= 29*24*time.Hour || ttl > defaultConnectionStatusTTL {
		t.Fatalf("ttl=%s err=%v", ttl, err)
	}
}

func TestRedisConnectionStatusRejectReasonIsBounded(t *testing.T) {
	client := redis.NewClient(&redis.Options{Addr: "127.0.0.1:1"})
	defer func() { _ = client.Close() }()
	tracker := NewRedisConnectionStatus(client)
	err := tracker.MarkRejected(context.Background(), uuid.New(), time.Now(), RejectReason("arbitrary diagnostic detail"))
	if err == nil || !errors.Is(err, ErrInvalidRejectReason) {
		t.Fatalf("error=%v", err)
	}
}

func assertConnectionStatus(t *testing.T, tracker *RedisConnectionStatus, ctx context.Context, projectID uuid.UUID, want ConnectionStatus) {
	t.Helper()
	got, err := tracker.GetConnectionStatus(ctx, projectID)
	if err != nil {
		t.Fatal(err)
	}
	assertOptionalTime(t, "last SDK seen", got.LastSDKSeenAt, want.LastSDKSeenAt)
	assertOptionalTime(t, "last event received", got.LastEventReceivedAt, want.LastEventReceivedAt)
	assertOptionalTime(t, "last event queryable", got.LastEventQueryableAt, want.LastEventQueryableAt)
	assertOptionalTime(t, "last reject", got.LastRejectAt, want.LastRejectAt)
	if (got.LastRejectReason == nil) != (want.LastRejectReason == nil) ||
		got.LastRejectReason != nil && *got.LastRejectReason != *want.LastRejectReason {
		t.Fatalf("last reject reason=%v want=%v", got.LastRejectReason, want.LastRejectReason)
	}
}

func assertOptionalTime(t *testing.T, name string, got, want *time.Time) {
	t.Helper()
	if got == nil && want == nil {
		return
	}
	if got == nil || want == nil || !got.Equal(*want) {
		t.Fatalf("%s=%v want=%v", name, got, want)
	}
}
