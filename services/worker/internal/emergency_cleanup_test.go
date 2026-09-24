package internal

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"openrum/internal/metadata"
)

type emergencyCleanupStoreFixture struct {
	step      metadata.EmergencyCleanupJobStep
	found     bool
	completed bool
	retried   bool
}

func (fixture *emergencyCleanupStoreFixture) ClaimStep(context.Context) (metadata.EmergencyCleanupJobStep, bool, error) {
	return fixture.step, fixture.found, nil
}

func (fixture *emergencyCleanupStoreFixture) CompleteStep(context.Context, metadata.EmergencyCleanupJobStep) error {
	fixture.completed = true
	return nil
}

func (fixture *emergencyCleanupStoreFixture) RetryStep(context.Context, metadata.EmergencyCleanupJobStep, error) error {
	fixture.retried = true
	return nil
}

type emergencyPartitionCleanerFixture struct{ err error }

func (fixture emergencyPartitionCleanerFixture) Drop(context.Context, metadata.EmergencyCleanupJobStep) error {
	return fixture.err
}

func TestEmergencyCleanupJobCompletesDroppedPartition(t *testing.T) {
	store := &emergencyCleanupStoreFixture{found: true, step: metadata.EmergencyCleanupJobStep{
		ID: 1, JobID: uuid.New(), Table: "rum_events_local", PartitionID: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
	}}
	processed, err := NewEmergencyCleanupJob(store, emergencyPartitionCleanerFixture{}).RunOne(t.Context())
	if err != nil || !processed || !store.completed || store.retried {
		t.Fatalf("processed=%v completed=%v retried=%v err=%v", processed, store.completed, store.retried, err)
	}
}

func TestEmergencyCleanupJobRetriesFailedPartition(t *testing.T) {
	store := &emergencyCleanupStoreFixture{found: true, step: metadata.EmergencyCleanupJobStep{
		ID: 1, JobID: uuid.New(), Table: "rum_events_local", PartitionID: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
	}}
	processed, err := NewEmergencyCleanupJob(store, emergencyPartitionCleanerFixture{err: errors.New("disk unavailable")}).RunOne(t.Context())
	if !processed || err == nil || store.completed || !store.retried {
		t.Fatalf("processed=%v completed=%v retried=%v err=%v", processed, store.completed, store.retried, err)
	}
}

func TestEmergencyPartitionIDValidation(t *testing.T) {
	if !validEmergencyPartitionID("0123456789abcdef0123456789abcdef") {
		t.Fatal("valid partition id was rejected")
	}
	for _, value := range []string{"", "abc", "0123456789abcdef0123456789abcdeg", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"} {
		if validEmergencyPartitionID(value) {
			t.Fatalf("invalid partition id %q was accepted", value)
		}
	}
}
