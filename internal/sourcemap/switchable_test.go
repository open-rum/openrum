package sourcemap

import (
	"context"
	"testing"
)

func TestSwitchableStorageStartsUnavailableAndSwapsAtomically(t *testing.T) {
	router := NewSwitchableStorage(nil, nil)
	if router.Available() {
		t.Fatal("new switchable storage unexpectedly available")
	}
	if result := router.Probe(context.Background()); result.ErrorCode != "not_configured" {
		t.Fatalf("probe error code = %q", result.ErrorCode)
	}
	memory := &memoryStorage{}
	router.Swap(memory, nil)
	if !router.Available() {
		t.Fatal("swapped storage unavailable")
	}
	if _, err := router.Read(context.Background(), "missing", 16); err != nil {
		t.Fatalf("delegated read: %v", err)
	}
}
