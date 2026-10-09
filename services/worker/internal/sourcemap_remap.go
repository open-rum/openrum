package internal

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"

	"openrum/internal/metadata"
	"openrum/internal/sourcemap"
)

const (
	// RemapWindow and MaxRemapEvents bound one remap pass: a late upload fixes
	// the recent errors people are looking at, not the whole retention period.
	RemapWindow     = 7 * 24 * time.Hour
	MaxRemapEvents  = 2000
	remapSaveChunk  = 500
	remapRetryDelay = time.Minute
)

type RemapQueue interface {
	Claim(context.Context) (metadata.RemapRequest, bool, error)
	Complete(context.Context, metadata.RemapRequest) error
	Retry(context.Context, metadata.RemapRequest, error, time.Duration) error
}

type RemapEvents interface {
	RemapCandidates(context.Context, uuid.UUID, string, string, time.Time, int) ([]PendingEvent, error)
	SaveBatch(context.Context, []MappedEvent) error
}

// SourceMapRemapJob maps recent events of a release again after one of its
// artifacts became ready. New rows supersede older ones in the
// ReplacingMergeTree because they carry a later mapped_at.
type SourceMapRemapJob struct {
	queue   RemapQueue
	events  RemapEvents
	mapper  StackMapper
	storage StorageAvailability
	now     func() time.Time
}

func NewSourceMapRemapJob(queue RemapQueue, events RemapEvents, mapper StackMapper, storage StorageAvailability) *SourceMapRemapJob {
	return &SourceMapRemapJob{queue: queue, events: events, mapper: mapper, storage: storage, now: time.Now}
}

// RunOne processes at most one request and reports how many events it saved.
func (job *SourceMapRemapJob) RunOne(ctx context.Context) (bool, int, error) {
	if job.storage != nil && !job.storage.Available() {
		return false, 0, nil
	}
	request, found, err := job.queue.Claim(ctx)
	if err != nil || !found {
		return false, 0, err
	}
	saved, err := job.remap(ctx, request)
	if err != nil {
		return true, saved, errors.Join(err, job.queue.Retry(ctx, request, err, remapRetryDelay))
	}
	return true, saved, job.queue.Complete(ctx, request)
}

func (job *SourceMapRemapJob) remap(ctx context.Context, request metadata.RemapRequest) (int, error) {
	candidates, err := job.events.RemapCandidates(ctx, request.ProjectID, request.Version, request.Dist, job.now().UTC().Add(-RemapWindow), MaxRemapEvents)
	if err != nil {
		return 0, err
	}
	saved := 0
	batch := make([]MappedEvent, 0, min(len(candidates), remapSaveChunk))
	for _, event := range candidates {
		if err := ctx.Err(); err != nil {
			return saved, err
		}
		mapped, err := job.mapper.MapStack(ctx, event.ProjectID, event.Release, event.Dist, event.Stack)
		if errors.Is(err, sourcemap.ErrRetryable) {
			// Keep what was mapped so far; the retry revisits only events
			// that are still not fully mapped.
			return saved, errors.Join(fmt.Errorf("remap deferred: %w", err), job.flush(ctx, batch, &saved))
		}
		batch = append(batch, MappedEvent{Event: event, Mapped: mapped})
		if len(batch) == remapSaveChunk {
			if err := job.flush(ctx, batch, &saved); err != nil {
				return saved, err
			}
			batch = batch[:0]
		}
	}
	return saved, job.flush(ctx, batch, &saved)
}

func (job *SourceMapRemapJob) flush(ctx context.Context, batch []MappedEvent, saved *int) error {
	if len(batch) == 0 {
		return nil
	}
	if err := job.events.SaveBatch(ctx, batch); err != nil {
		return err
	}
	*saved += len(batch)
	return nil
}
