package internal

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
)

type dataPurgeStoreFixture struct {
	purge     ProjectDataPurge
	found     bool
	retries   int
	completed int
	confirmed bool
}

func (store *dataPurgeStoreFixture) Claim(context.Context) (ProjectDataPurge, bool, error) {
	return store.purge, store.found, nil
}
func (store *dataPurgeStoreFixture) Retry(context.Context, ProjectDataPurge, error) error {
	store.retries++
	return nil
}
func (store *dataPurgeStoreFixture) ResetEmpty(context.Context, ProjectDataPurge) error { return nil }
func (store *dataPurgeStoreFixture) ConfirmEmpty(context.Context, ProjectDataPurge) (bool, error) {
	return store.confirmed, nil
}
func (store *dataPurgeStoreFixture) Complete(context.Context, ProjectDataPurge) error {
	store.completed++
	return nil
}

func TestProjectDataPurgeCompletesAfterAnalyticsAndArtifactsAreGone(t *testing.T) {
	purge := ProjectDataPurge{
		ProjectID: uuid.New(), DeadlineAt: time.Now().Add(time.Hour), OSSKeys: []string{"one.map"},
	}
	store := &dataPurgeStoreFixture{purge: purge, found: true, confirmed: true}
	analytics := &analyticsDeletionFixture{}
	objects := &objectDeletionFixture{}
	processed, err := NewProjectDataPurgeJob(store, analytics, objects).RunOne(t.Context())
	if err != nil || !processed || analytics.deleted != 1 || store.completed != 1 || len(objects.keys) != 1 {
		t.Fatalf("processed=%v deleted=%d completed=%d objects=%v err=%v", processed, analytics.deleted, store.completed, objects.keys, err)
	}
}

func TestProjectDataPurgeRetriesPartialCleanup(t *testing.T) {
	purge := ProjectDataPurge{ProjectID: uuid.New(), DeadlineAt: time.Now().Add(time.Hour)}
	store := &dataPurgeStoreFixture{purge: purge, found: true, confirmed: true}
	processed, err := NewProjectDataPurgeJob(
		store,
		&analyticsDeletionFixture{err: errors.New("clickhouse unavailable")},
		nil,
	).RunOne(t.Context())
	if err == nil || !processed || store.retries != 1 || store.completed != 0 {
		t.Fatalf("processed=%v retries=%d completed=%d err=%v", processed, store.retries, store.completed, err)
	}
}

func TestProjectDataPurgeWaitsForEmptyConfirmationWindow(t *testing.T) {
	store := &dataPurgeStoreFixture{
		purge: ProjectDataPurge{ProjectID: uuid.New(), DeadlineAt: time.Now().Add(time.Hour)},
		found: true,
	}
	processed, err := NewProjectDataPurgeJob(store, &analyticsDeletionFixture{}, nil).RunOne(t.Context())
	if err != nil || !processed || store.completed != 0 || store.retries != 0 {
		t.Fatalf("processed=%v completed=%d retries=%d err=%v", processed, store.completed, store.retries, err)
	}
}
