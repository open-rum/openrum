package metadata

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"

	openrumcrypto "openrum/internal/crypto"
)

const ObjectStorageSecretName = "object-storage"

type ManagedObjectStorage struct {
	Provider        string `json:"provider"`
	Endpoint        string `json:"endpoint"`
	Bucket          string `json:"bucket"`
	Region          string `json:"region"`
	ForcePathStyle  bool   `json:"forcePathStyle"`
	AccessKeyID     string `json:"accessKeyId"`
	SecretAccessKey string `json:"secretAccessKey"`
	// DeleteForbidden records that the save-time probe could write and read but
	// not delete. Storage still works; deletions then leave objects behind.
	DeleteForbidden bool `json:"deleteForbidden,omitempty"`
}

type InstanceSecret struct {
	Name      string
	KeyID     string
	Version   int64
	UpdatedBy *uuid.UUID
	UpdatedAt time.Time
}

type InstanceSecretRepository struct {
	database *sql.DB
	keyring  *openrumcrypto.Keyring
}

func NewInstanceSecretRepository(database *sql.DB, keyring *openrumcrypto.Keyring) *InstanceSecretRepository {
	return &InstanceSecretRepository{database: database, keyring: keyring}
}

func (repository *InstanceSecretRepository) PutObjectStorage(ctx context.Context, actorID uuid.UUID, value ManagedObjectStorage) (InstanceSecret, error) {
	if repository.keyring == nil {
		return InstanceSecret{}, errors.New("managed secrets are disabled")
	}
	plaintext, err := json.Marshal(value)
	if err != nil {
		return InstanceSecret{}, err
	}
	encrypted, keyID, err := repository.keyring.Seal(plaintext, []byte(ObjectStorageSecretName))
	for index := range plaintext {
		plaintext[index] = 0
	}
	if err != nil {
		return InstanceSecret{}, err
	}
	var secret InstanceSecret
	err = repository.database.QueryRowContext(ctx, `INSERT INTO instance_secrets
		(name,encrypted_value,key_id,updated_by) VALUES ($1,$2,$3,$4)
		ON CONFLICT (name) DO UPDATE SET encrypted_value=EXCLUDED.encrypted_value,key_id=EXCLUDED.key_id,
		version=instance_secrets.version+1,updated_by=EXCLUDED.updated_by,updated_at=now()
		RETURNING name,key_id,version,updated_by,updated_at`, ObjectStorageSecretName, encrypted, keyID, actorID).
		Scan(&secret.Name, &secret.KeyID, &secret.Version, &secret.UpdatedBy, &secret.UpdatedAt)
	return secret, err
}

func (repository *InstanceSecretRepository) GetObjectStorage(ctx context.Context) (ManagedObjectStorage, InstanceSecret, error) {
	if repository.keyring == nil {
		return ManagedObjectStorage{}, InstanceSecret{}, errors.New("managed secrets are disabled")
	}
	var secret InstanceSecret
	var encrypted []byte
	err := repository.database.QueryRowContext(ctx, `SELECT name,encrypted_value,key_id,version,updated_by,updated_at
		FROM instance_secrets WHERE name=$1`, ObjectStorageSecretName).
		Scan(&secret.Name, &encrypted, &secret.KeyID, &secret.Version, &secret.UpdatedBy, &secret.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return ManagedObjectStorage{}, InstanceSecret{}, ErrNotFound
	}
	if err != nil {
		return ManagedObjectStorage{}, InstanceSecret{}, err
	}
	plaintext, keyID, err := repository.keyring.Open(encrypted, []byte(ObjectStorageSecretName))
	if err != nil {
		return ManagedObjectStorage{}, InstanceSecret{}, fmt.Errorf("decrypt managed object storage using key %s: %w", keyID, err)
	}
	defer func() {
		for index := range plaintext {
			plaintext[index] = 0
		}
	}()
	var value ManagedObjectStorage
	if err := json.Unmarshal(plaintext, &value); err != nil {
		return ManagedObjectStorage{}, InstanceSecret{}, err
	}
	return value, secret, nil
}

// ObjectStorageVersion returns the managed storage row version, or 0 when no
// managed configuration exists. Every process polls it so a Console change
// reaches all replicas without decrypting the secret on each check.
func (repository *InstanceSecretRepository) ObjectStorageVersion(ctx context.Context) (int64, error) {
	var version int64
	err := repository.database.QueryRowContext(ctx, `SELECT version FROM instance_secrets WHERE name=$1`, ObjectStorageSecretName).Scan(&version)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil
	}
	return version, err
}
