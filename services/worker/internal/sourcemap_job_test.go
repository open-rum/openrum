package internal

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"openrum/internal/sourcemap"
)

type fakeMappings struct {
	events []PendingEvent
	saved  []sourcemap.MappedStack
}

func (mapping *fakeMappings) NextBatch(context.Context, int) ([]PendingEvent, error) {
	return mapping.events, nil
}
func (mapping *fakeMappings) Save(_ context.Context, _ PendingEvent, result sourcemap.MappedStack) error {
	mapping.saved = append(mapping.saved, result)
	return nil
}

type isolatingMapper struct{ calls int }

func (mapper *isolatingMapper) MapStack(_ context.Context, _ uuid.UUID, _, _, stack string) sourcemap.MappedStack {
	mapper.calls++
	if stack == "corrupt" {
		return sourcemap.MappedStack{Raw: stack, Status: "failed", Failure: sourcemap.FailureInvalidMap}
	}
	return sourcemap.MappedStack{Raw: stack, Status: "mapped"}
}

func TestJobPersistsFailureAndContinuesBatch(t *testing.T) {
	events := &fakeMappings{events: []PendingEvent{{EventID: uuid.New(), Stack: "corrupt"}, {EventID: uuid.New(), Stack: "valid"}}}
	mapper := &isolatingMapper{}
	processed, err := NewSourceMapJob(events, mapper).RunBatch(t.Context(), 2)
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
	if processed, err := NewSourceMapJob(events, &isolatingMapper{}).RunBatch(t.Context(), 1); err == nil || processed != 0 {
		t.Fatalf("processed=%d err=%v", processed, err)
	}
}
