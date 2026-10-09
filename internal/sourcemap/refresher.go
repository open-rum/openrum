package sourcemap

import (
	"context"
	"errors"
	"sync"
	"time"

	"openrum/internal/config"
	"openrum/internal/metadata"
)

// StorageRefreshInterval bounds how long a replica keeps using a replaced
// managed storage configuration.
const StorageRefreshInterval = 30 * time.Second

// ManagedStorageSource reads the Console-managed object storage secret.
type ManagedStorageSource interface {
	GetObjectStorage(context.Context) (metadata.ManagedObjectStorage, metadata.InstanceSecret, error)
	ObjectStorageVersion(context.Context) (int64, error)
}

// LoadedStorage is one resolved storage client and where it came from.
type LoadedStorage struct {
	Storage Storage
	Prober  Prober
	// Managed is set, with the secret access key cleared, when the client was
	// built from the Console-managed row rather than deployment configuration.
	Managed *metadata.ManagedObjectStorage
	Version int64
	// Configured is true when some storage is intended, even if the client
	// could not be built; it separates "not configured" from "unavailable".
	Configured bool
}

type managedStorageBuilder func(context.Context, metadata.ManagedObjectStorage) (Storage, Prober, error)
type configuredStorageBuilder func(context.Context, config.Config) (Storage, Prober, error)

// LoadStorage prefers the managed configuration and otherwise falls back to the
// deployment environment. secrets may be nil when managed secrets are disabled.
func LoadStorage(ctx context.Context, configuration config.Config, secrets ManagedStorageSource) (LoadedStorage, error) {
	return loadStorage(ctx, configuration, secrets, NewManagedStorage, NewConfiguredStorage)
}

func loadStorage(
	ctx context.Context,
	configuration config.Config,
	secrets ManagedStorageSource,
	buildManaged managedStorageBuilder,
	buildConfigured configuredStorageBuilder,
) (LoadedStorage, error) {
	if secrets != nil {
		managed, secret, err := secrets.GetObjectStorage(ctx)
		switch {
		case err == nil:
			storage, prober, buildErr := buildManaged(ctx, managed)
			managed.SecretAccessKey = ""
			loaded := LoadedStorage{Managed: &managed, Version: secret.Version, Configured: true}
			if buildErr != nil {
				return loaded, buildErr
			}
			loaded.Storage, loaded.Prober = storage, prober
			return loaded, nil
		case !errors.Is(err, metadata.ErrNotFound):
			// The row may exist; without reading it we cannot claim storage
			// is absent, so report it as configured but unusable.
			return LoadedStorage{Configured: true}, err
		}
	}
	configured := configuration.ObjectStorageProvider != config.ObjectStorageProviderNone && configuration.ObjectStorageProvider != ""
	storage, prober, err := buildConfigured(ctx, configuration)
	if err != nil {
		return LoadedStorage{Configured: configured}, err
	}
	return LoadedStorage{Storage: storage, Prober: prober, Configured: configured && storage != nil}, nil
}

// StorageRefresher keeps a SwitchableStorage in step with the managed storage
// row. Only the replica that saved a new configuration swaps immediately; every
// other API and Worker replica catches up on its next poll.
type StorageRefresher struct {
	mutex           sync.Mutex
	switcher        *SwitchableStorage
	configuration   config.Config
	secrets         ManagedStorageSource
	buildManaged    managedStorageBuilder
	buildConfigured configuredStorageBuilder
	onChange        func(LoadedStorage)
	loaded          bool
	version         int64
}

func NewStorageRefresher(switcher *SwitchableStorage, configuration config.Config, secrets ManagedStorageSource) *StorageRefresher {
	return &StorageRefresher{
		switcher: switcher, configuration: configuration, secrets: secrets,
		buildManaged: NewManagedStorage, buildConfigured: NewConfiguredStorage,
	}
}

// OnChange registers a callback invoked after each successful swap, for status
// views that describe the active configuration.
func (refresher *StorageRefresher) OnChange(callback func(LoadedStorage)) {
	refresher.mutex.Lock()
	defer refresher.mutex.Unlock()
	refresher.onChange = callback
}

// Refresh rebuilds the client when the managed row version differs from the
// one last applied. A failed build leaves the version unrecorded so the next
// poll retries it; an existing working client is kept meanwhile.
func (refresher *StorageRefresher) Refresh(ctx context.Context) (bool, error) {
	refresher.mutex.Lock()
	defer refresher.mutex.Unlock()
	version := int64(0)
	if refresher.secrets != nil {
		current, err := refresher.secrets.ObjectStorageVersion(ctx)
		if err != nil {
			return false, err
		}
		version = current
	}
	if refresher.loaded && version == refresher.version {
		return false, nil
	}
	loaded, err := loadStorage(ctx, refresher.configuration, refresher.secrets, refresher.buildManaged, refresher.buildConfigured)
	if err != nil {
		if loaded.Configured && !refresher.switcher.Available() {
			refresher.switcher.SetUnavailable()
		}
		return false, err
	}
	refresher.switcher.Swap(loaded.Storage, loaded.Prober)
	if loaded.Managed != nil && loaded.Managed.DeleteForbidden {
		refresher.switcher.SetDeleteForbidden(true)
	}
	refresher.loaded, refresher.version = true, version
	if refresher.onChange != nil {
		refresher.onChange(loaded)
	}
	return true, nil
}

// Run polls until ctx ends. onError receives failed refreshes for logging.
func (refresher *StorageRefresher) Run(ctx context.Context, interval time.Duration, onError func(error)) {
	if interval <= 0 {
		interval = StorageRefreshInterval
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
		refreshCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
		_, err := refresher.Refresh(refreshCtx)
		cancel()
		if err != nil && !errors.Is(err, context.Canceled) && onError != nil {
			onError(err)
		}
	}
}
