package internal

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"

	"openrum/internal/sourcemap"
)

const MaxBatchSize = 100

type PendingEvent struct {
	ProjectID uuid.UUID
	EventID   uuid.UUID
	Release   string
	Dist      string
	Stack     string
}

type EventMappings interface {
	NextBatch(context.Context, int) ([]PendingEvent, error)
	Save(context.Context, PendingEvent, sourcemap.MappedStack) error
}

type StackMapper interface {
	MapStack(context.Context, uuid.UUID, string, string, string) (sourcemap.MappedStack, error)
}

// StorageAvailability reports whether a storage client exists at all. Without
// one every artifact read would fail, so batches are skipped rather than
// churned through as transient failures.
type StorageAvailability interface {
	Available() bool
}

const (
	// maxDeferredEvents bounds the in-memory retry list, and with it how many
	// extra rows NextBatch reads to look past deferred events.
	maxDeferredEvents = 900
	minTransientDelay = time.Minute
	maxTransientDelay = 15 * time.Minute
)

type deferredEvent struct {
	until    time.Time
	failures int
}

type SourceMapJob struct {
	events   EventMappings
	mapper   StackMapper
	storage  StorageAvailability
	now      func() time.Time
	deferred map[uuid.UUID]deferredEvent
}

func NewSourceMapJob(events EventMappings, mapper StackMapper, storage StorageAvailability) *SourceMapJob {
	return &SourceMapJob{events: events, mapper: mapper, storage: storage, now: time.Now, deferred: make(map[uuid.UUID]deferredEvent)}
}

// RunBatch maps the oldest unmapped events. A retryable mapping failure is not
// saved; the event is deferred with backoff so a few stuck events cannot keep
// newer ones from being processed.
func (job *SourceMapJob) RunBatch(ctx context.Context, limit int) (int, error) {
	if limit < 1 || limit > MaxBatchSize {
		limit = MaxBatchSize
	}
	if job.storage != nil && !job.storage.Available() {
		return 0, nil
	}
	now := job.now()
	for eventID, entry := range job.deferred {
		// Forget events not retried long after their delay: they were
		// mapped elsewhere (a remap) or expired from ClickHouse.
		if now.Sub(entry.until) > maxTransientDelay {
			delete(job.deferred, eventID)
		}
	}
	events, err := job.events.NextBatch(ctx, limit+len(job.deferred))
	if err != nil {
		return 0, err
	}
	processed := 0
	var transient error
	for _, event := range events {
		if processed >= limit {
			break
		}
		if entry, ok := job.deferred[event.EventID]; ok && now.Before(entry.until) {
			continue
		}
		if err := ctx.Err(); err != nil {
			return processed, err
		}
		mapped, err := job.mapper.MapStack(ctx, event.ProjectID, event.Release, event.Dist, event.Stack)
		if errors.Is(err, sourcemap.ErrRetryable) {
			job.deferEvent(event.EventID, now)
			transient = err
			continue
		}
		if err := job.events.Save(ctx, event, mapped); err != nil {
			return processed, err
		}
		delete(job.deferred, event.EventID)
		processed++
	}
	if transient != nil {
		return processed, fmt.Errorf("some source maps were deferred: %w", transient)
	}
	return processed, nil
}

func (job *SourceMapJob) deferEvent(eventID uuid.UUID, now time.Time) {
	entry, known := job.deferred[eventID]
	if !known && len(job.deferred) >= maxDeferredEvents {
		return
	}
	delay := minTransientDelay << min(entry.failures, 4)
	entry.failures++
	entry.until = now.Add(min(delay, maxTransientDelay))
	job.deferred[eventID] = entry
}

type ClickHouseMappings struct{ database *sql.DB }

func NewClickHouseMappings(database *sql.DB) *ClickHouseMappings {
	return &ClickHouseMappings{database: database}
}

func (repository *ClickHouseMappings) NextBatch(ctx context.Context, limit int) ([]PendingEvent, error) {
	rows, err := repository.database.QueryContext(ctx, `SELECT project_id,event_id,release,dist,error_stack
FROM rum_events FINAL
WHERE event_type='error' AND error_stack!=''
  AND event_id GLOBAL NOT IN (SELECT event_id FROM event_stack_mappings FINAL)
ORDER BY received_at LIMIT ?`, limit)
	if err != nil {
		return nil, fmt.Errorf("query unmapped error events: %w", err)
	}
	defer func() { _ = rows.Close() }()
	results := make([]PendingEvent, 0, limit)
	for rows.Next() {
		var event PendingEvent
		if err := rows.Scan(&event.ProjectID, &event.EventID, &event.Release, &event.Dist, &event.Stack); err != nil {
			return nil, err
		}
		results = append(results, event)
	}
	return results, rows.Err()
}

func (repository *ClickHouseMappings) Save(ctx context.Context, event PendingEvent, mapped sourcemap.MappedStack) error {
	contents, err := json.Marshal(mapped)
	if err != nil {
		return err
	}
	_, err = repository.database.ExecContext(ctx,
		`INSERT INTO event_stack_mappings (project_id,event_id,status,failure_code,mapped_stack,mapped_at) VALUES (?,?,?,?,?,?)`,
		event.ProjectID, event.EventID, mapped.Status, mapped.Failure, string(contents), time.Now().UTC())
	if err != nil {
		return fmt.Errorf("save mapped stack: %w", err)
	}
	return nil
}

// MappedEvent pairs an event with its mapping result for a batched insert.
type MappedEvent struct {
	Event  PendingEvent
	Mapped sourcemap.MappedStack
}

// SaveBatch writes many results in one ClickHouse insert, so a remap of
// thousands of events creates one part instead of one per event.
func (repository *ClickHouseMappings) SaveBatch(ctx context.Context, results []MappedEvent) error {
	if len(results) == 0 {
		return nil
	}
	transaction, err := repository.database.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin mapped stack batch: %w", err)
	}
	defer func() { _ = transaction.Rollback() }()
	statement, err := transaction.PrepareContext(ctx,
		`INSERT INTO event_stack_mappings (project_id,event_id,status,failure_code,mapped_stack,mapped_at)`)
	if err != nil {
		return fmt.Errorf("prepare mapped stack batch: %w", err)
	}
	defer func() { _ = statement.Close() }()
	mappedAt := time.Now().UTC()
	for _, result := range results {
		contents, err := json.Marshal(result.Mapped)
		if err != nil {
			return err
		}
		if _, err := statement.ExecContext(ctx, result.Event.ProjectID, result.Event.EventID, result.Mapped.Status,
			string(result.Mapped.Failure), string(contents), mappedAt); err != nil {
			return fmt.Errorf("append mapped stack: %w", err)
		}
	}
	if err := transaction.Commit(); err != nil {
		return fmt.Errorf("save mapped stack batch: %w", err)
	}
	return nil
}

// RemapCandidates lists recent error events of one release build whose latest
// mapping is not fully mapped, including events never mapped at all.
func (repository *ClickHouseMappings) RemapCandidates(ctx context.Context, projectID uuid.UUID, release, dist string, since time.Time, limit int) ([]PendingEvent, error) {
	rows, err := repository.database.QueryContext(ctx, `SELECT project_id,event_id,release,dist,error_stack
FROM rum_events FINAL
WHERE project_id=? AND event_type='error' AND error_stack!='' AND release=? AND dist=? AND timestamp>=?
  AND event_id GLOBAL NOT IN (
    SELECT event_id FROM event_stack_mappings FINAL WHERE project_id=? AND status='mapped'
  )
ORDER BY timestamp DESC LIMIT ?`, projectID, release, dist, since, projectID, limit)
	if err != nil {
		return nil, fmt.Errorf("query remap candidates: %w", err)
	}
	defer func() { _ = rows.Close() }()
	results := make([]PendingEvent, 0)
	for rows.Next() {
		var event PendingEvent
		if err := rows.Scan(&event.ProjectID, &event.EventID, &event.Release, &event.Dist, &event.Stack); err != nil {
			return nil, err
		}
		results = append(results, event)
	}
	return results, rows.Err()
}
