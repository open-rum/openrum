package internal

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"

	"openrum/internal/metadata"
	"openrum/internal/sourcemap"
)

type fakeMappings struct {
	events []PendingEvent
	saved  []sourcemap.MappedStack
	limits []int
}

func (mapping *fakeMappings) NextBatch(_ context.Context, limit int) ([]PendingEvent, error) {
	mapping.limits = append(mapping.limits, limit)
	return mapping.events, nil
}
func (mapping *fakeMappings) Save(_ context.Context, _ PendingEvent, result sourcemap.MappedStack) error {
	mapping.saved = append(mapping.saved, result)
	return nil
}

type isolatingMapper struct{ calls int }

func (mapper *isolatingMapper) MapStack(_ context.Context, _ uuid.UUID, _, _, stack string) (sourcemap.MappedStack, error) {
	mapper.calls++
	switch stack {
	case "corrupt":
		return sourcemap.MappedStack{Raw: stack, Status: "failed", Failure: sourcemap.FailureInvalidMap}, nil
	case "storage-down":
		return sourcemap.MappedStack{Raw: stack, Status: "failed"}, fmt.Errorf("%w: timeout", sourcemap.ErrRetryable)
	}
	return sourcemap.MappedStack{Raw: stack, Status: "mapped"}, nil
}

type fixedAvailability bool

func (available fixedAvailability) Available() bool { return bool(available) }

func TestJobPersistsFailureAndContinuesBatch(t *testing.T) {
	events := &fakeMappings{events: []PendingEvent{{EventID: uuid.New(), Stack: "corrupt"}, {EventID: uuid.New(), Stack: "valid"}}}
	mapper := &isolatingMapper{}
	processed, err := NewSourceMapJob(events, mapper, fixedAvailability(true)).RunBatch(t.Context(), 2)
	if err != nil || processed != 2 || mapper.calls != 2 || len(events.saved) != 2 || events.saved[0].Failure != sourcemap.FailureInvalidMap || events.saved[1].Status != "mapped" {
		t.Fatalf("processed=%d calls=%d saved=%+v err=%v", processed, mapper.calls, events.saved, err)
	}
}

type failingMappings struct{ fakeMappings }

func (mapping *failingMappings) Save(context.Context, PendingEvent, sourcemap.MappedStack) error {
	return errors.New("write failed")
}

func TestJobStopsOnPersistenceFailure(t *testing.T) {
	events := &failingMappings{fakeMappings: fakeMappings{events: []PendingEvent{{EventID: uuid.New(), Stack: "valid"}}}}
	if processed, err := NewSourceMapJob(events, &isolatingMapper{}, nil).RunBatch(t.Context(), 1); err == nil || processed != 0 {
		t.Fatalf("processed=%d err=%v", processed, err)
	}
}

func TestJobSkipsBatchWithoutStorageClient(t *testing.T) {
	events := &fakeMappings{events: []PendingEvent{{EventID: uuid.New(), Stack: "valid"}}}
	mapper := &isolatingMapper{}
	processed, err := NewSourceMapJob(events, mapper, fixedAvailability(false)).RunBatch(t.Context(), 1)
	if err != nil || processed != 0 || mapper.calls != 0 || len(events.limits) != 0 || len(events.saved) != 0 {
		t.Fatalf("processed=%d calls=%d limits=%v err=%v", processed, mapper.calls, events.limits, err)
	}
}

func TestJobDefersTransientFailuresWithoutSaving(t *testing.T) {
	stuck := PendingEvent{EventID: uuid.New(), Stack: "storage-down"}
	events := &fakeMappings{events: []PendingEvent{stuck, {EventID: uuid.New(), Stack: "valid"}}}
	mapper := &isolatingMapper{}
	job := NewSourceMapJob(events, mapper, fixedAvailability(true))
	now := time.Date(2026, 9, 30, 12, 0, 0, 0, time.UTC)
	job.now = func() time.Time { return now }
	processed, err := job.RunBatch(t.Context(), 2)
	if !errors.Is(err, sourcemap.ErrRetryable) || processed != 1 || len(events.saved) != 1 || events.saved[0].Status != "mapped" {
		t.Fatalf("processed=%d saved=%+v err=%v", processed, events.saved, err)
	}
	// Within the backoff the stuck event is skipped, and NextBatch reads one
	// extra row so it cannot crowd out newer events.
	events.events = []PendingEvent{stuck}
	if processed, err := job.RunBatch(t.Context(), 2); err != nil || processed != 0 || mapper.calls != 2 || events.limits[1] != 3 {
		t.Fatalf("processed=%d calls=%d limits=%v err=%v", processed, mapper.calls, events.limits, err)
	}
	now = now.Add(2 * time.Minute)
	if _, err := job.RunBatch(t.Context(), 2); !errors.Is(err, sourcemap.ErrRetryable) || mapper.calls != 3 || job.deferred[stuck.EventID].failures != 2 {
		t.Fatalf("retry calls=%d deferred=%+v err=%v", mapper.calls, job.deferred[stuck.EventID], err)
	}
}

type fakeRemapQueue struct {
	requests  []metadata.RemapRequest
	completed []metadata.RemapRequest
	retried   []error
}

func (queue *fakeRemapQueue) Claim(context.Context) (metadata.RemapRequest, bool, error) {
	if len(queue.requests) == 0 {
		return metadata.RemapRequest{}, false, nil
	}
	request := queue.requests[0]
	queue.requests = queue.requests[1:]
	return request, true, nil
}
func (queue *fakeRemapQueue) Complete(_ context.Context, request metadata.RemapRequest) error {
	queue.completed = append(queue.completed, request)
	return nil
}
func (queue *fakeRemapQueue) Retry(_ context.Context, _ metadata.RemapRequest, cause error, _ time.Duration) error {
	queue.retried = append(queue.retried, cause)
	return nil
}

type fakeRemapEvents struct {
	candidates []PendingEvent
	since      time.Time
	limit      int
	release    string
	saved      [][]MappedEvent
}

func (events *fakeRemapEvents) RemapCandidates(_ context.Context, _ uuid.UUID, release, _ string, since time.Time, limit int) ([]PendingEvent, error) {
	events.release, events.since, events.limit = release, since, limit
	return events.candidates, nil
}
func (events *fakeRemapEvents) SaveBatch(_ context.Context, batch []MappedEvent) error {
	events.saved = append(events.saved, append([]MappedEvent(nil), batch...))
	return nil
}

func TestRemapJobMapsRecentEventsAndCompletesRequest(t *testing.T) {
	now := time.Date(2026, 9, 30, 12, 0, 0, 0, time.UTC)
	queue := &fakeRemapQueue{requests: []metadata.RemapRequest{{ID: uuid.New(), ProjectID: uuid.New(), Version: "web@1", Dist: "browser"}}}
	events := &fakeRemapEvents{candidates: []PendingEvent{{EventID: uuid.New(), Stack: "valid"}, {EventID: uuid.New(), Stack: "corrupt"}}}
	job := NewSourceMapRemapJob(queue, events, &isolatingMapper{}, fixedAvailability(true))
	job.now = func() time.Time { return now }
	processed, saved, err := job.RunOne(t.Context())
	if err != nil || !processed || saved != 2 || len(queue.completed) != 1 || len(events.saved) != 1 ||
		events.release != "web@1" || events.limit != MaxRemapEvents || !events.since.Equal(now.Add(-7*24*time.Hour)) {
		t.Fatalf("processed=%v saved=%d completed=%d events=%+v err=%v", processed, saved, len(queue.completed), events, err)
	}
	if processed, _, err := job.RunOne(t.Context()); processed || err != nil {
		t.Fatalf("empty queue processed=%v err=%v", processed, err)
	}
}

func TestRemapJobRetriesRequestOnTransientFailure(t *testing.T) {
	queue := &fakeRemapQueue{requests: []metadata.RemapRequest{{ID: uuid.New(), ProjectID: uuid.New(), Version: "web@1"}}}
	events := &fakeRemapEvents{candidates: []PendingEvent{{EventID: uuid.New(), Stack: "valid"}, {EventID: uuid.New(), Stack: "storage-down"}}}
	processed, saved, err := NewSourceMapRemapJob(queue, events, &isolatingMapper{}, fixedAvailability(true)).RunOne(t.Context())
	if !processed || saved != 1 || !errors.Is(err, sourcemap.ErrRetryable) || len(queue.retried) != 1 || len(queue.completed) != 0 {
		t.Fatalf("processed=%v saved=%d retried=%d completed=%d err=%v", processed, saved, len(queue.retried), len(queue.completed), err)
	}
	unavailable := NewSourceMapRemapJob(&fakeRemapQueue{requests: []metadata.RemapRequest{{ID: uuid.New()}}}, events, &isolatingMapper{}, fixedAvailability(false))
	if processed, _, err := unavailable.RunOne(t.Context()); processed || err != nil {
		t.Fatalf("unavailable storage processed=%v err=%v", processed, err)
	}
}
