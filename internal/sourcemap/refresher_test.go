package sourcemap

import (
	"context"
	"errors"
	"testing"

	"openrum/internal/config"
	"openrum/internal/metadata"
)

type fakeManagedSource struct {
	value   metadata.ManagedObjectStorage
	version int64
	err     error
}

func (source *fakeManagedSource) GetObjectStorage(context.Context) (metadata.ManagedObjectStorage, metadata.InstanceSecret, error) {
	if source.err != nil {
		return metadata.ManagedObjectStorage{}, metadata.InstanceSecret{}, source.err
	}
	if source.version == 0 {
		return metadata.ManagedObjectStorage{}, metadata.InstanceSecret{}, metadata.ErrNotFound
	}
	return source.value, metadata.InstanceSecret{Version: source.version}, nil
}

func (source *fakeManagedSource) ObjectStorageVersion(context.Context) (int64, error) {
	return source.version, nil
}

type namedStorage struct {
	memoryStorage
	name string
}

func testBuilders(built *[]string) (managedStorageBuilder, configuredStorageBuilder) {
	managed := func(_ context.Context, value metadata.ManagedObjectStorage) (Storage, Prober, error) {
		if value.Bucket == "broken" {
			return nil, nil, ErrInvalidStorage
		}
		*built = append(*built, "managed:"+value.Bucket)
		return &namedStorage{name: value.Bucket}, nil, nil
	}
	configured := func(_ context.Context, configuration config.Config) (Storage, Prober, error) {
		if configuration.ObjectStorageProvider == config.ObjectStorageProviderNone {
			return nil, nil, nil
		}
		*built = append(*built, "env:"+configuration.ObjectStorageBucket)
		return &namedStorage{name: configuration.ObjectStorageBucket}, nil, nil
	}
	return managed, configured
}

func TestLoadStoragePrefersManagedAndFallsBackToEnvironment(t *testing.T) {
	var built []string
	managed, configured := testBuilders(&built)
	environment := config.Config{ObjectStorageProvider: config.ObjectStorageProviderS3, ObjectStorageBucket: "env"}
	source := &fakeManagedSource{value: metadata.ManagedObjectStorage{Bucket: "managed", SecretAccessKey: "secret"}, version: 3}
	loaded, err := loadStorage(context.Background(), environment, source, managed, configured)
	if err != nil || loaded.Storage.(*namedStorage).name != "managed" || loaded.Managed == nil || loaded.Managed.SecretAccessKey != "" || loaded.Version != 3 || !loaded.Configured {
		t.Fatalf("loaded=%+v err=%v", loaded, err)
	}
	source.version = 0
	loaded, err = loadStorage(context.Background(), environment, source, managed, configured)
	if err != nil || loaded.Storage.(*namedStorage).name != "env" || loaded.Managed != nil || !loaded.Configured {
		t.Fatalf("fallback loaded=%+v err=%v", loaded, err)
	}
	loaded, err = loadStorage(context.Background(), config.Config{ObjectStorageProvider: config.ObjectStorageProviderNone}, nil, managed, configured)
	if err != nil || loaded.Storage != nil || loaded.Configured {
		t.Fatalf("unconfigured loaded=%+v err=%v", loaded, err)
	}
	source.err = errors.New("decrypt failed")
	if loaded, err = loadStorage(context.Background(), environment, source, managed, configured); err == nil || !loaded.Configured {
		t.Fatalf("unreadable secret loaded=%+v err=%v", loaded, err)
	}
}

func TestStorageRefresherSwapsOnlyWhenVersionChanges(t *testing.T) {
	var built []string
	source := &fakeManagedSource{version: 0}
	switcher := NewSwitchableStorage(nil, nil)
	refresher := NewStorageRefresher(switcher, config.Config{ObjectStorageProvider: config.ObjectStorageProviderNone}, source)
	refresher.buildManaged, refresher.buildConfigured = testBuilders(&built)
	var changes []LoadedStorage
	refresher.OnChange(func(loaded LoadedStorage) { changes = append(changes, loaded) })

	if changed, err := refresher.Refresh(context.Background()); err != nil || !changed || switcher.State() != StorageNotConfigured {
		t.Fatalf("initial changed=%v state=%s err=%v", changed, switcher.State(), err)
	}
	source.value, source.version = metadata.ManagedObjectStorage{Bucket: "first"}, 1
	if changed, err := refresher.Refresh(context.Background()); err != nil || !changed || switcher.State() != StorageReady {
		t.Fatalf("first changed=%v state=%s err=%v", changed, switcher.State(), err)
	}
	if changed, err := refresher.Refresh(context.Background()); err != nil || changed || len(built) != 1 {
		t.Fatalf("unchanged version rebuilt: changed=%v built=%v err=%v", changed, built, err)
	}
	source.value, source.version = metadata.ManagedObjectStorage{Bucket: "broken"}, 2
	if changed, err := refresher.Refresh(context.Background()); err == nil || changed || switcher.State() != StorageReady {
		t.Fatalf("broken version must keep working client: changed=%v state=%s err=%v", changed, switcher.State(), err)
	}
	source.value = metadata.ManagedObjectStorage{Bucket: "second"}
	if changed, err := refresher.Refresh(context.Background()); err != nil || !changed {
		t.Fatalf("retry of failed version changed=%v err=%v", changed, err)
	}
	if len(changes) != 3 || changes[2].Managed == nil || changes[2].Managed.Bucket != "second" || built[len(built)-1] != "managed:second" {
		t.Fatalf("changes=%+v built=%v", changes, built)
	}
}

func TestStorageRefresherMarksUnbuildableManagedStorageUnavailable(t *testing.T) {
	var built []string
	source := &fakeManagedSource{value: metadata.ManagedObjectStorage{Bucket: "broken"}, version: 1}
	switcher := NewSwitchableStorage(nil, nil)
	refresher := NewStorageRefresher(switcher, config.Config{ObjectStorageProvider: config.ObjectStorageProviderNone}, source)
	refresher.buildManaged, refresher.buildConfigured = testBuilders(&built)
	if _, err := refresher.Refresh(context.Background()); err == nil || switcher.State() != StorageUnavailable {
		t.Fatalf("state=%s err=%v", switcher.State(), err)
	}
}
