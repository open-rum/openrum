package sourcemap

import (
	"context"
	"errors"
	"testing"
)

func TestSwitchableStorageStartsUnavailableAndSwapsAtomically(t *testing.T) {
	router := NewSwitchableStorage(nil, nil)
	if router.Available() || router.State() != StorageNotConfigured {
		t.Fatalf("new switchable storage available=%v state=%s", router.Available(), router.State())
	}
	if result := router.Probe(context.Background()); result.ErrorCode != "not_configured" {
		t.Fatalf("probe error code = %q", result.ErrorCode)
	}
	memory := &memoryStorage{}
	router.Swap(memory, nil)
	if !router.Available() || router.State() != StorageReady {
		t.Fatalf("swapped storage available=%v state=%s", router.Available(), router.State())
	}
	if _, err := router.Read(context.Background(), "missing", 16); err != nil {
		t.Fatalf("delegated read: %v", err)
	}
}

func TestSwitchableStorageStateFollowsBackendHealth(t *testing.T) {
	memory := &memoryStorage{err: statusError{status: 404}}
	router := NewSwitchableStorage(memory, nil)
	_, _ = router.Read(context.Background(), "gone", 16)
	if router.State() != StorageReady {
		t.Fatalf("missing object must not mark storage unavailable: %s", router.State())
	}
	memory.err = errors.New("dial tcp: connection refused")
	_, _ = router.Read(context.Background(), "key", 16)
	if router.State() != StorageUnavailable {
		t.Fatalf("network failure state=%s", router.State())
	}
	memory.err = nil
	_, _ = router.Read(context.Background(), "key", 16)
	if router.State() != StorageReady {
		t.Fatalf("recovered state=%s", router.State())
	}
	router.SetUnavailable()
	if router.Available() || router.State() != StorageUnavailable {
		t.Fatalf("unbuildable client available=%v state=%s", router.Available(), router.State())
	}
	if _, err := router.Read(context.Background(), "key", 16); !errors.Is(err, ErrInvalidStorage) {
		t.Fatalf("read without client err=%v", err)
	}
}

func TestIsAvailabilityErrorSeparatesObjectAnswers(t *testing.T) {
	for _, err := range []error{nil, context.Canceled, ErrObjectMismatch, &ResolveError{Code: FailureResourceLimit}, statusError{status: 404}, statusError{status: 412}} {
		if IsAvailabilityError(err) {
			t.Fatalf("%v unexpectedly counted as unavailable", err)
		}
	}
	for _, err := range []error{errors.New("timeout"), statusError{status: 403}, statusError{status: 503}, ErrInvalidStorage} {
		if !IsAvailabilityError(err) {
			t.Fatalf("%v unexpectedly counted as available", err)
		}
	}
}
