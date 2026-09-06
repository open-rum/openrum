package consumerservice

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	"openrum/internal/config"
	"openrum/internal/event"
	"openrum/internal/metadata"
)

type fakeProjectRetentionRepository struct {
	policy metadata.ProjectRetentionPolicy
	err    error
	calls  int
}

func (repository *fakeProjectRetentionRepository) GetRetentionPolicy(
	context.Context,
	uuid.UUID,
	[]config.SystemSettingDefinition,
) (metadata.ProjectRetentionPolicy, error) {
	repository.calls++
	return repository.policy, repository.err
}

func TestCachedRetentionPolicyProviderCachesUntilTTL(t *testing.T) {
	repository := &fakeProjectRetentionRepository{policy: metadata.ProjectRetentionPolicy{RawDays: 7, AggregateDays: 180}}
	provider := NewCachedRetentionPolicyProvider(repository, nil, time.Minute)
	now := time.Date(2026, 9, 4, 10, 0, 0, 0, time.UTC)
	provider.now = func() time.Time { return now }
	projectID := uuid.New()

	first, err := provider.Get(context.Background(), projectID)
	if err != nil || first != repository.policy {
		t.Fatalf("first policy=%+v err=%v", first, err)
	}
	repository.policy = metadata.ProjectRetentionPolicy{RawDays: 30, AggregateDays: 365}
	second, err := provider.Get(context.Background(), projectID)
	if err != nil || second != first || repository.calls != 1 {
		t.Fatalf("cached policy=%+v calls=%d err=%v", second, repository.calls, err)
	}
	now = now.Add(time.Minute)
	third, err := provider.Get(context.Background(), projectID)
	if err != nil || third != repository.policy || repository.calls != 2 {
		t.Fatalf("refreshed policy=%+v calls=%d err=%v", third, repository.calls, err)
	}
}

func TestCachedRetentionPolicyProviderDoesNotCacheFailures(t *testing.T) {
	repository := &fakeProjectRetentionRepository{err: errors.New("database unavailable")}
	provider := NewCachedRetentionPolicyProvider(repository, nil, time.Minute)
	projectID := uuid.New()
	if _, err := provider.Get(context.Background(), projectID); err == nil {
		t.Fatal("expected repository error")
	}
	repository.err = nil
	repository.policy = metadata.ProjectRetentionPolicy{RawDays: 14, AggregateDays: 90}
	if _, err := provider.Get(context.Background(), projectID); err != nil || repository.calls != 2 {
		t.Fatalf("retry calls=%d err=%v", repository.calls, err)
	}
}

func TestApplyRetentionPolicyUsesEventClock(t *testing.T) {
	timestamp := time.Date(2026, 3, 1, 23, 30, 0, 0, time.FixedZone("CST", 8*60*60))
	events := []event.CanonicalEvent{{Timestamp: timestamp}}
	if err := applyRetentionPolicy(events, metadata.ProjectRetentionPolicy{RawDays: 7, AggregateDays: 180}); err != nil {
		t.Fatal(err)
	}
	wantTimestamp := timestamp.UTC()
	if !events[0].RawExpiresAt.Equal(wantTimestamp.AddDate(0, 0, 7)) ||
		!events[0].AggregateExpiresAt.Equal(wantTimestamp.AddDate(0, 0, 180)) {
		t.Fatalf("raw=%s aggregate=%s", events[0].RawExpiresAt, events[0].AggregateExpiresAt)
	}
}

func TestApplyRetentionPolicyRejectsOutOfBoundsPolicy(t *testing.T) {
	if err := applyRetentionPolicy([]event.CanonicalEvent{{Timestamp: time.Now()}}, metadata.ProjectRetentionPolicy{RawDays: 0, AggregateDays: 90}); err == nil {
		t.Fatal("expected bounds error")
	}
}
