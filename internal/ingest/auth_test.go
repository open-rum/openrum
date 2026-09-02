package ingest

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"openrum/internal/metadata"
)

type countingValidator struct {
	mutex  sync.Mutex
	calls  int
	access metadata.ProjectKeyAccess
	err    error
	gate   chan struct{}
}

func (validator *countingValidator) Validate(context.Context, string) (metadata.ProjectKeyAccess, error) {
	if validator.gate != nil {
		<-validator.gate
	}
	validator.mutex.Lock()
	defer validator.mutex.Unlock()
	validator.calls++
	return validator.access, validator.err
}

func (validator *countingValidator) count() int {
	validator.mutex.Lock()
	defer validator.mutex.Unlock()
	return validator.calls
}

func TestCachedAuthenticatorCachesValidAndInvalidKeys(t *testing.T) {
	access := metadata.ProjectKeyAccess{Project: metadata.Project{ID: uuid.New()}}
	validator := &countingValidator{access: access}
	authenticator := NewCachedAuthenticator(validator)
	clock := time.Date(2026, 9, 2, 10, 0, 0, 0, time.UTC)
	authenticator.now = func() time.Time { return clock }
	for range 3 {
		got, err := authenticator.Authenticate(context.Background(), "orr_pk_valid")
		if err != nil || got.Project.ID != access.Project.ID {
			t.Fatalf("Authenticate() = %+v, %v", got, err)
		}
	}
	if validator.count() != 1 {
		t.Fatalf("validations = %d, want 1", validator.count())
	}
	clock = clock.Add(validKeyCacheTTL)
	if _, err := authenticator.Authenticate(context.Background(), "orr_pk_valid"); err != nil {
		t.Fatal(err)
	}
	if validator.count() != 2 {
		t.Fatalf("validations after expiry = %d, want 2", validator.count())
	}

	invalidValidator := &countingValidator{err: metadata.ErrInvalidProjectKey}
	invalidAuthenticator := NewCachedAuthenticator(invalidValidator)
	for range 3 {
		if _, err := invalidAuthenticator.Authenticate(context.Background(), "orr_pk_invalid"); !errors.Is(err, metadata.ErrInvalidProjectKey) {
			t.Fatalf("invalid error = %v", err)
		}
	}
	if invalidValidator.count() != 1 {
		t.Fatalf("invalid validations = %d, want 1", invalidValidator.count())
	}
}

func TestCachedAuthenticatorCollapsesConcurrentMisses(t *testing.T) {
	gate := make(chan struct{})
	validator := &countingValidator{
		access: metadata.ProjectKeyAccess{Project: metadata.Project{ID: uuid.New()}},
		gate:   gate,
	}
	authenticator := NewCachedAuthenticator(validator)
	const callers = 20
	start := make(chan struct{})
	var wait sync.WaitGroup
	wait.Add(callers)
	for range callers {
		go func() {
			defer wait.Done()
			<-start
			if _, err := authenticator.Authenticate(context.Background(), "orr_pk_concurrent"); err != nil {
				t.Errorf("Authenticate() error = %v", err)
			}
		}()
	}
	close(start)
	close(gate)
	wait.Wait()
	if validator.count() != 1 {
		t.Fatalf("validations = %d, want 1", validator.count())
	}
}
