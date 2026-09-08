package consumerservice

import (
	"context"
	"sync"
	"time"

	"github.com/google/uuid"

	"openrum/internal/event"
	"openrum/internal/filter"
)

// filterModeDryRun labels a match that was counted but not acted on.
//
// Measuring before enforcing is deliberate. Whether crawler or developer
// traffic is noise depends on the project, and the only honest way to answer
// "what would this remove" is to answer it from that project's own data rather
// than from an estimate. It also separates two risks that would otherwise land
// together: while nothing is dropped, a mistake in classification costs an
// inaccurate number instead of missing events.
const (
	filterModeDryRun   = string(filter.ModeDryRun)
	filterModeEnforced = string(filter.ModeEnforced)
)

// FilterSettingsProvider supplies the compiled inbound filter settings for a
// project.
type FilterSettingsProvider interface {
	Get(context.Context, uuid.UUID) (*filter.Compiled, error)
}

type projectFilterRepository interface {
	Get(context.Context, uuid.UUID) (filter.Settings, error)
}

type cachedFilterSettings struct {
	compiled  *filter.Compiled
	expiresAt time.Time
}

// CachedFilterSettingsProvider caches compiled settings for a short window, so
// that a change made in the Console takes effect within one TTL without every
// message costing a database round trip and a pattern compilation.
type CachedFilterSettingsProvider struct {
	repository projectFilterRepository
	ttl        time.Duration
	now        func() time.Time
	mutex      sync.RWMutex
	entries    map[uuid.UUID]cachedFilterSettings
}

func NewCachedFilterSettingsProvider(repository projectFilterRepository, ttl time.Duration) *CachedFilterSettingsProvider {
	if ttl <= 0 {
		ttl = 30 * time.Second
	}
	return &CachedFilterSettingsProvider{
		repository: repository, ttl: ttl, now: time.Now,
		entries: make(map[uuid.UUID]cachedFilterSettings),
	}
}

func (provider *CachedFilterSettingsProvider) Get(ctx context.Context, projectID uuid.UUID) (*filter.Compiled, error) {
	now := provider.now().UTC()
	provider.mutex.RLock()
	entry, ok := provider.entries[projectID]
	provider.mutex.RUnlock()
	if ok && now.Before(entry.expiresAt) {
		return entry.compiled, nil
	}
	settings, err := provider.repository.Get(ctx, projectID)
	if err != nil {
		return nil, err
	}
	compiled, err := filter.Compile(settings)
	if err != nil {
		return nil, err
	}
	provider.mutex.Lock()
	provider.entries[projectID] = cachedFilterSettings{compiled: compiled, expiresAt: now.Add(provider.ttl)}
	provider.mutex.Unlock()
	return compiled, nil
}

// applyInboundFilters counts every match and returns the events that survive.
//
// Counting happens for dry-run and enforced alike, which is what keeps the
// reconciliation in the Kafka runbook exact: accepted equals stored, plus
// dead-lettered, plus the enforced share of this counter. Dry-run matches are
// counted but still stored, so they must not be subtracted.
//
// Per-project figures are deliberately not labelled here, because a project
// identifier as a metric label grows the series count with every project. The
// bot category is also stored on the event as an ingest flag, so a
// project-level share can be read from ClickHouse instead.
func applyInboundFilters(
	events []event.CanonicalEvent,
	compiled *filter.Compiled,
	metrics *Metrics,
) []event.CanonicalEvent {
	if !compiled.Active() {
		return events
	}
	kept := events[:0]
	for _, candidate := range events {
		matches := compiled.Evaluate(candidate)
		drop := filter.Drops(matches)
		for _, match := range matches {
			if metrics != nil {
				metrics.observeFiltered(match.Reason, string(match.Mode))
			}
		}
		if !drop {
			kept = append(kept, candidate)
		}
	}
	return kept
}
