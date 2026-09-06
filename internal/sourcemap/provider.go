package sourcemap

import (
	"context"
	"fmt"

	"openrum/internal/config"
	"openrum/internal/metadata"
)

func NewConfiguredStorage(ctx context.Context, configuration config.Config) (Storage, Prober, error) {
	switch configuration.ObjectStorageProvider {
	case config.ObjectStorageProviderNone, "":
		return nil, nil, nil
	case config.ObjectStorageProviderOSS:
		storage, err := NewOSSStorage(configuration.ObjectStorageRegion, configuration.ObjectStorageEndpoint, configuration.ObjectStorageBucket)
		return storage, storage, err
	case config.ObjectStorageProviderS3:
		storage, err := NewS3Storage(ctx, configuration.ObjectStorageRegion, configuration.ObjectStorageEndpoint, configuration.ObjectStorageBucket, configuration.ObjectStorageForcePathStyle)
		return storage, storage, err
	default:
		return nil, nil, fmt.Errorf("unsupported object storage provider %q", configuration.ObjectStorageProvider)
	}
}

func NewManagedStorage(ctx context.Context, value metadata.ManagedObjectStorage) (Storage, Prober, error) {
	switch config.ObjectStorageProvider(value.Provider) {
	case config.ObjectStorageProviderOSS:
		storage, err := NewOSSStorageWithCredentials(value.Region, value.Endpoint, value.Bucket, value.AccessKeyID, value.SecretAccessKey)
		return storage, storage, err
	case config.ObjectStorageProviderS3:
		storage, err := NewS3StorageWithCredentials(ctx, value.Region, value.Endpoint, value.Bucket, value.ForcePathStyle, value.AccessKeyID, value.SecretAccessKey)
		return storage, storage, err
	default:
		return nil, nil, ErrInvalidStorage
	}
}
