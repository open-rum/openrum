package sourcemap

import (
	"context"
	"sync"
	"time"
)

type SwitchableStorage struct {
	mutex   sync.RWMutex
	storage Storage
	prober  Prober
}

func NewSwitchableStorage(storage Storage, prober Prober) *SwitchableStorage {
	return &SwitchableStorage{storage: storage, prober: prober}
}

func (storage *SwitchableStorage) Swap(next Storage, prober Prober) {
	storage.mutex.Lock()
	defer storage.mutex.Unlock()
	storage.storage, storage.prober = next, prober
}

func (storage *SwitchableStorage) Available() bool {
	storage.mutex.RLock()
	defer storage.mutex.RUnlock()
	return storage.storage != nil
}

func (storage *SwitchableStorage) PresignUpload(ctx context.Context, key string, size int64, digest []byte, ttl time.Duration) (UploadGrant, error) {
	storage.mutex.RLock()
	defer storage.mutex.RUnlock()
	if storage.storage == nil {
		return UploadGrant{}, ErrInvalidStorage
	}
	return storage.storage.PresignUpload(ctx, key, size, digest, ttl)
}

func (storage *SwitchableStorage) Head(ctx context.Context, key string) (ObjectInfo, error) {
	storage.mutex.RLock()
	defer storage.mutex.RUnlock()
	if storage.storage == nil {
		return ObjectInfo{}, ErrInvalidStorage
	}
	return storage.storage.Head(ctx, key)
}

func (storage *SwitchableStorage) Delete(ctx context.Context, key string) error {
	storage.mutex.RLock()
	defer storage.mutex.RUnlock()
	if storage.storage == nil {
		return ErrInvalidStorage
	}
	return storage.storage.Delete(ctx, key)
}

func (storage *SwitchableStorage) Read(ctx context.Context, key string, maximum int64) ([]byte, error) {
	storage.mutex.RLock()
	defer storage.mutex.RUnlock()
	if storage.storage == nil {
		return nil, ErrInvalidStorage
	}
	return storage.storage.Read(ctx, key, maximum)
}

func (storage *SwitchableStorage) Probe(ctx context.Context) StorageProbeResult {
	storage.mutex.RLock()
	defer storage.mutex.RUnlock()
	if storage.prober == nil {
		return StorageProbeResult{StartedAt: time.Now().UTC(), ErrorCode: "not_configured"}
	}
	return storage.prober.Probe(ctx)
}
