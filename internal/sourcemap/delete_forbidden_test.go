package sourcemap

import (
	"context"
	"errors"
	"testing"
	"time"
)

type deleteOnlyStorage struct{ deleteErr error }

func (storage deleteOnlyStorage) PresignUpload(context.Context, string, int64, []byte, time.Duration) (UploadGrant, error) {
	return UploadGrant{}, nil
}
func (storage deleteOnlyStorage) Head(context.Context, string) (ObjectInfo, error) {
	return ObjectInfo{}, nil
}
func (storage deleteOnlyStorage) Delete(context.Context, string) error { return storage.deleteErr }
func (storage deleteOnlyStorage) Read(context.Context, string, int64) ([]byte, error) {
	return nil, nil
}

func TestForbiddenDeleteIsACapabilityNotAnOutage(t *testing.T) {
	switcher := NewSwitchableStorage(deleteOnlyStorage{deleteErr: statusError{status: 403}}, nil)
	if err := switcher.Delete(t.Context(), "a.map"); !IsForbidden(err) {
		t.Fatalf("err=%v", err)
	}
	if switcher.DeleteAllowed() || switcher.State() != StorageReady {
		t.Fatalf("deleteAllowed=%v state=%s", switcher.DeleteAllowed(), switcher.State())
	}
	switcher.Swap(deleteOnlyStorage{}, nil)
	if !switcher.DeleteAllowed() {
		t.Fatal("a new client must start without the old delete limit")
	}
}

func TestOtherDeleteFailuresStillMarkStorageUnavailable(t *testing.T) {
	switcher := NewSwitchableStorage(deleteOnlyStorage{deleteErr: errors.New("connection refused")}, nil)
	_ = switcher.Delete(t.Context(), "a.map")
	if !switcher.DeleteAllowed() || switcher.State() != StorageUnavailable {
		t.Fatalf("deleteAllowed=%v state=%s", switcher.DeleteAllowed(), switcher.State())
	}
}

func TestFinishProbeTurnsDeleteFailuresIntoWarnings(t *testing.T) {
	result := StorageProbeResult{}
	finishProbe(&result, StorageProbeStep{Name: "delete", Status: "failed", ErrorCode: "network"})
	if !result.Success || len(result.Warnings) != 1 || result.Warnings[0] != "cleanup_failed" {
		t.Fatalf("result=%+v", result)
	}
}
