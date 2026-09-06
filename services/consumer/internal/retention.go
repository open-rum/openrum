package consumerservice

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"

	"openrum/internal/config"
	"openrum/internal/event"
	"openrum/internal/metadata"
)

type RetentionPolicyProvider interface {
	Get(context.Context, uuid.UUID) (metadata.ProjectRetentionPolicy, error)
}

type projectRetentionRepository interface {
	GetRetentionPolicy(context.Context, uuid.UUID, []config.SystemSettingDefinition) (metadata.ProjectRetentionPolicy, error)
}

type cachedRetentionPolicy struct {
	policy    metadata.ProjectRetentionPolicy
	expiresAt time.Time
}

type CachedRetentionPolicyProvider struct {
	repository  projectRetentionRepository
	definitions []config.SystemSettingDefinition
	ttl         time.Duration
	now         func() time.Time
	mutex       sync.RWMutex
	entries     map[uuid.UUID]cachedRetentionPolicy
}

func NewCachedRetentionPolicyProvider(
	repository projectRetentionRepository,
	definitions []config.SystemSettingDefinition,
	ttl time.Duration,
) *CachedRetentionPolicyProvider {
	if ttl <= 0 {
		ttl = 30 * time.Second
	}
	return &CachedRetentionPolicyProvider{
		repository: repository, definitions: append([]config.SystemSettingDefinition(nil), definitions...),
		ttl: ttl, now: time.Now, entries: make(map[uuid.UUID]cachedRetentionPolicy),
	}
}

func (provider *CachedRetentionPolicyProvider) Get(ctx context.Context, projectID uuid.UUID) (metadata.ProjectRetentionPolicy, error) {
	now := provider.now().UTC()
	provider.mutex.RLock()
	entry, ok := provider.entries[projectID]
	provider.mutex.RUnlock()
	if ok && now.Before(entry.expiresAt) {
		return entry.policy, nil
	}
	policy, err := provider.repository.GetRetentionPolicy(ctx, projectID, provider.definitions)
	if err != nil {
		return metadata.ProjectRetentionPolicy{}, err
	}
	provider.mutex.Lock()
	provider.entries[projectID] = cachedRetentionPolicy{policy: policy, expiresAt: now.Add(provider.ttl)}
	provider.mutex.Unlock()
	return policy, nil
}

func applyRetentionPolicy(events []event.CanonicalEvent, policy metadata.ProjectRetentionPolicy) error {
	if policy.RawDays < 1 || policy.RawDays > 90 || policy.AggregateDays < 1 || policy.AggregateDays > 730 {
		return fmt.Errorf("retention policy is outside supported bounds")
	}
	for index := range events {
		timestamp := events[index].Timestamp.UTC()
		events[index].RawExpiresAt = timestamp.AddDate(0, 0, policy.RawDays)
		events[index].AggregateExpiresAt = timestamp.AddDate(0, 0, policy.AggregateDays)
	}
	return nil
}
