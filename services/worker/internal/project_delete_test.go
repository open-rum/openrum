package internal

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
)

type deletionStoreFixture struct {
	deletion  ProjectDeletion
	found     bool
	retries   int
	completed int
	confirmed bool
}

func (store *deletionStoreFixture) Claim(context.Context) (ProjectDeletion, bool, error) {
	return store.deletion, store.found, nil
}
func (store *deletionStoreFixture) Retry(context.Context, ProjectDeletion, error) error {
	store.retries++
	return nil
}
func (store *deletionStoreFixture) ResetEmpty(context.Context, ProjectDeletion) error { return nil }
func (store *deletionStoreFixture) ConfirmEmpty(context.Context, ProjectDeletion) (bool, error) {
	return store.confirmed, nil
}
func (store *deletionStoreFixture) Complete(context.Context, ProjectDeletion) error {
	store.completed++
	return nil
}

type analyticsDeletionFixture struct {
	remaining uint64
	err       error
	deleted   int
}

func (fixture *analyticsDeletionFixture) DeleteProject(context.Context, uuid.UUID) error {
	fixture.deleted++
	return fixture.err
}
func (fixture *analyticsDeletionFixture) CountProject(context.Context, uuid.UUID) (uint64, error) {
	return fixture.remaining, fixture.err
}

type objectDeletionFixture struct {
	keys []string
	err  error
}

func (fixture *objectDeletionFixture) Delete(_ context.Context, key string) error {
	fixture.keys = append(fixture.keys, key)
	return fixture.err
}

func TestProjectDeletionCompletesOnlyAfterAnalyticsAndObjectsAreGone(t *testing.T) {
	deletion := ProjectDeletion{ProjectID: uuid.New(), DeadlineAt: time.Now().Add(time.Hour), OSSKeys: []string{"a.map", "b.map"}}
	store := &deletionStoreFixture{deletion: deletion, found: true, confirmed: true}
	analytics := &analyticsDeletionFixture{}
	objects := &objectDeletionFixture{}
	processed, err := NewProjectDeletionJob(store, analytics, objects).RunOne(t.Context())
	if err != nil || !processed || analytics.deleted != 1 || store.completed != 1 || store.retries != 0 || len(objects.keys) != 2 {
		t.Fatalf("processed=%v analytics=%d completed=%d retries=%d keys=%v err=%v", processed, analytics.deleted, store.completed, store.retries, objects.keys, err)
	}
}

func TestProjectDeletionRetriesWithoutCompletingPartialCleanup(t *testing.T) {
	deletion := ProjectDeletion{ProjectID: uuid.New(), DeadlineAt: time.Now().Add(time.Hour), OSSKeys: []string{"a.map"}}
	for _, fixture := range []struct {
		name      string
		analytics *analyticsDeletionFixture
		objects   *objectDeletionFixture
	}{
		{"analytics failure", &analyticsDeletionFixture{err: errors.New("clickhouse unavailable")}, &objectDeletionFixture{}},
		{"rows remain", &analyticsDeletionFixture{remaining: 1}, &objectDeletionFixture{}},
		{"object failure", &analyticsDeletionFixture{}, &objectDeletionFixture{err: errors.New("oss unavailable")}},
	} {
		t.Run(fixture.name, func(t *testing.T) {
			store := &deletionStoreFixture{deletion: deletion, found: true, confirmed: true}
			processed, err := NewProjectDeletionJob(store, fixture.analytics, fixture.objects).RunOne(t.Context())
			if err == nil || !processed || store.retries != 1 || store.completed != 0 {
				t.Fatalf("processed=%v retries=%d completed=%d err=%v", processed, store.retries, store.completed, err)
			}
		})
	}
}

func TestProjectDeletionWithoutObjectStorageOnlyBlocksExistingArtifacts(t *testing.T) {
	for _, test := range []struct {
		name      string
		keys      []string
		completed int
		retries   int
		wantErr   bool
	}{
		{name: "no artifacts", completed: 1},
		{name: "existing artifacts", keys: []string{"a.map"}, retries: 1, wantErr: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			store := &deletionStoreFixture{
				deletion: ProjectDeletion{ProjectID: uuid.New(), DeadlineAt: time.Now().Add(time.Hour), OSSKeys: test.keys},
				found:    true, confirmed: true,
			}
			processed, err := NewProjectDeletionJob(store, &analyticsDeletionFixture{}, nil).RunOne(t.Context())
			if !processed || (err != nil) != test.wantErr || store.completed != test.completed || store.retries != test.retries {
				t.Fatalf("processed=%v completed=%d retries=%d err=%v", processed, store.completed, store.retries, err)
			}
		})
	}
}

// forbiddenObjectError is a provider 403 for a credential without delete rights.
type forbiddenObjectError struct{}

func (forbiddenObjectError) Error() string       { return "AccessDenied" }
func (forbiddenObjectError) HTTPStatusCode() int { return 403 }

func TestProjectDeletionCompletesWhenStorageForbidsDeletes(t *testing.T) {
	deletion := ProjectDeletion{ProjectID: uuid.New(), DeadlineAt: time.Now().Add(time.Hour), OSSKeys: []string{"a.map", "b.map"}}
	store := &deletionStoreFixture{deletion: deletion, found: true, confirmed: true}
	objects := &objectDeletionFixture{err: forbiddenObjectError{}}
	processed, err := NewProjectDeletionJob(store, &analyticsDeletionFixture{}, objects).RunOne(t.Context())
	if err != nil || !processed || store.completed != 1 || store.retries != 0 || len(objects.keys) != 2 {
		t.Fatalf("processed=%v completed=%d retries=%d keys=%v err=%v", processed, store.completed, store.retries, objects.keys, err)
	}
}
