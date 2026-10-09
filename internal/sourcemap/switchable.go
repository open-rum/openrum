package sourcemap

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"time"
)

// StorageState is what non-administrators may learn about source map storage:
// whether uploads can work, without exposing provider details.
type StorageState string

const (
	StorageReady         StorageState = "ready"
	StorageNotConfigured StorageState = "not_configured"
	StorageUnavailable   StorageState = "unavailable"
)

// SwitchableStorage lets every process replace its storage client when the
// managed configuration changes, without restarting request handlers or jobs
// that already hold a reference to it.
type SwitchableStorage struct {
	mutex      sync.RWMutex
	storage    Storage
	prober     Prober
	configured bool
	// failing records whether the latest call reached a broken backend. It is
	// updated under the read lock, so it is atomic rather than mutex-guarded.
	failing atomic.Bool
	// deleteForbidden records that the backend refuses deletes (HTTP 403) while
	// writes and reads work. It is a capability, not an outage, so it never marks
	// storage unavailable; deletions keep going and leave the objects behind.
	deleteForbidden atomic.Bool
}

func NewSwitchableStorage(storage Storage, prober Prober) *SwitchableStorage {
	return &SwitchableStorage{storage: storage, prober: prober, configured: storage != nil}
}

func (storage *SwitchableStorage) Swap(next Storage, prober Prober) {
	storage.mutex.Lock()
	defer storage.mutex.Unlock()
	storage.storage, storage.prober, storage.configured = next, prober, next != nil
	storage.failing.Store(false)
	storage.deleteForbidden.Store(false)
}

// SetDeleteForbidden applies what a probe learned about delete permission, so a
// replica can warn before its first delete attempt.
func (storage *SwitchableStorage) SetDeleteForbidden(forbidden bool) {
	storage.deleteForbidden.Store(forbidden)
}

// DeleteAllowed is false once the backend has refused a delete.
func (storage *SwitchableStorage) DeleteAllowed() bool {
	return !storage.deleteForbidden.Load()
}

// SetUnavailable records that storage is configured but no usable client could
// be built (for example a managed secret that cannot be decrypted).
func (storage *SwitchableStorage) SetUnavailable() {
	storage.mutex.Lock()
	defer storage.mutex.Unlock()
	storage.storage, storage.prober, storage.configured = nil, nil, true
	storage.failing.Store(false)
}

func (storage *SwitchableStorage) Available() bool {
	storage.mutex.RLock()
	defer storage.mutex.RUnlock()
	return storage.storage != nil
}

// State reports readiness from the live client without issuing a probe write.
func (storage *SwitchableStorage) State() StorageState {
	storage.mutex.RLock()
	defer storage.mutex.RUnlock()
	switch {
	case !storage.configured:
		return StorageNotConfigured
	case storage.storage == nil || storage.failing.Load():
		return StorageUnavailable
	default:
		return StorageReady
	}
}

func (storage *SwitchableStorage) observe(err error) {
	if err == nil {
		storage.failing.Store(false)
	} else if IsAvailabilityError(err) {
		storage.failing.Store(true)
	}
}

func (storage *SwitchableStorage) PresignUpload(ctx context.Context, key string, size int64, digest []byte, ttl time.Duration) (UploadGrant, error) {
	storage.mutex.RLock()
	defer storage.mutex.RUnlock()
	if storage.storage == nil {
		return UploadGrant{}, ErrInvalidStorage
	}
	grant, err := storage.storage.PresignUpload(ctx, key, size, digest, ttl)
	storage.observe(err)
	return grant, err
}

func (storage *SwitchableStorage) Head(ctx context.Context, key string) (ObjectInfo, error) {
	storage.mutex.RLock()
	defer storage.mutex.RUnlock()
	if storage.storage == nil {
		return ObjectInfo{}, ErrInvalidStorage
	}
	info, err := storage.storage.Head(ctx, key)
	storage.observe(err)
	return info, err
}

func (storage *SwitchableStorage) Delete(ctx context.Context, key string) error {
	storage.mutex.RLock()
	defer storage.mutex.RUnlock()
	if storage.storage == nil {
		return ErrInvalidStorage
	}
	err := storage.storage.Delete(ctx, key)
	switch {
	case err == nil:
		storage.deleteForbidden.Store(false)
		storage.failing.Store(false)
	case IsForbidden(err):
		storage.deleteForbidden.Store(true)
	default:
		storage.observe(err)
	}
	return err
}

func (storage *SwitchableStorage) Read(ctx context.Context, key string, maximum int64) ([]byte, error) {
	storage.mutex.RLock()
	defer storage.mutex.RUnlock()
	if storage.storage == nil {
		return nil, ErrInvalidStorage
	}
	contents, err := storage.storage.Read(ctx, key, maximum)
	storage.observe(err)
	return contents, err
}

func (storage *SwitchableStorage) Probe(ctx context.Context) StorageProbeResult {
	storage.mutex.RLock()
	defer storage.mutex.RUnlock()
	if storage.prober == nil {
		return StorageProbeResult{StartedAt: time.Now().UTC(), ErrorCode: "not_configured"}
	}
	return storage.prober.Probe(ctx)
}

// IsObjectNotFound reports a provider response saying the object is absent.
// Both SDKs expose the HTTP status, under slightly different method names.
func IsObjectNotFound(err error) bool {
	return storageHTTPStatus(err) == 404
}

// IsAvailabilityError separates failures of the storage backend itself
// (network, credentials, 5xx, missing client) from answers about one object or
// one input, which say nothing about whether storage as a whole works.
func IsAvailabilityError(err error) bool {
	if err == nil || errors.Is(err, context.Canceled) || errors.Is(err, ErrObjectMismatch) {
		return false
	}
	var resolveError *ResolveError
	if errors.As(err, &resolveError) {
		return false
	}
	switch status := storageHTTPStatus(err); {
	case status == 401 || status == 403 || status == 408 || status == 429:
		return true
	case status >= 400 && status < 500:
		return false
	}
	return true
}

func storageHTTPStatus(err error) int {
	var ossError interface{ HttpStatusCode() int }
	if errors.As(err, &ossError) {
		return ossError.HttpStatusCode()
	}
	var s3Error interface{ HTTPStatusCode() int }
	if errors.As(err, &s3Error) {
		return s3Error.HTTPStatusCode()
	}
	return 0
}
