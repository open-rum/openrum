package internal

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"openrum/internal/metadata"
)

type retentionStoreFixture struct {
	step      metadata.MaintenanceStep
	found     bool
	claimErr  error
	retries   int
	completed int
}

func (store *retentionStoreFixture) ClaimRetentionStep(context.Context) (metadata.MaintenanceStep, bool, error) {
	return store.step, store.found, store.claimErr
}
func (store *retentionStoreFixture) CompleteRetentionStep(context.Context, metadata.MaintenanceStep) error {
	store.completed++
	return nil
}
func (store *retentionStoreFixture) RetryRetentionStep(context.Context, metadata.MaintenanceStep, error) error {
	store.retries++
	return nil
}

type retentionCleanerFixture struct {
	calls int
	err   error
}

func (cleaner *retentionCleanerFixture) Apply(context.Context, metadata.MaintenanceStep) error {
	cleaner.calls++
	return cleaner.err
}

func TestRetentionCleanupCompletesOneBoundedStep(t *testing.T) {
	store := &retentionStoreFixture{found: true, step: metadata.MaintenanceStep{
		ID: 1, JobID: uuid.New(), ProjectID: uuid.New(), Table: "rum_events_local", TimeColumn: "timestamp", Month: 202609, RetentionDays: 14,
	}}
	cleaner := &retentionCleanerFixture{}
	processed, err := NewRetentionCleanupJob(store, cleaner).RunOne(t.Context())
	if err != nil || !processed || cleaner.calls != 1 || store.completed != 1 || store.retries != 0 {
		t.Fatalf("processed=%v calls=%d completed=%d retries=%d err=%v", processed, cleaner.calls, store.completed, store.retries, err)
	}
}

func TestRetentionCleanupRetriesIdempotentStepAfterFailure(t *testing.T) {
	store := &retentionStoreFixture{found: true, step: metadata.MaintenanceStep{ID: 1, JobID: uuid.New()}}
	cleaner := &retentionCleanerFixture{err: errors.New("ClickHouse unavailable")}
	processed, err := NewRetentionCleanupJob(store, cleaner).RunOne(t.Context())
	if err == nil || !processed || cleaner.calls != 1 || store.completed != 0 || store.retries != 1 {
		t.Fatalf("processed=%v calls=%d completed=%d retries=%d err=%v", processed, cleaner.calls, store.completed, store.retries, err)
	}
}

func TestRetentionCleanupIsIdleWithoutClaimableSteps(t *testing.T) {
	store := &retentionStoreFixture{}
	processed, err := NewRetentionCleanupJob(store, &retentionCleanerFixture{}).RunOne(t.Context())
	if err != nil || processed {
		t.Fatalf("processed=%v err=%v", processed, err)
	}
}
