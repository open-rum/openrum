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
	"openrum/internal/mailer"
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
	return repository.putSecret(ctx, actorID, ObjectStorageSecretName, value)
}

func (repository *InstanceSecretRepository) GetObjectStorage(ctx context.Context) (ManagedObjectStorage, InstanceSecret, error) {
	var value ManagedObjectStorage
	secret, err := repository.getSecret(ctx, ObjectStorageSecretName, &value)
	if err != nil {
		return ManagedObjectStorage{}, InstanceSecret{}, err
	}
	return value, secret, nil
}

// SMTPSecretName is the row that holds the Console-managed mail server.
const SMTPSecretName = "smtp"

func (repository *InstanceSecretRepository) PutSMTP(ctx context.Context, actorID uuid.UUID, value mailer.Settings) (InstanceSecret, error) {
	return repository.putSecret(ctx, actorID, SMTPSecretName, value)
}

func (repository *InstanceSecretRepository) GetSMTP(ctx context.Context) (mailer.Settings, InstanceSecret, error) {
	var value mailer.Settings
	secret, err := repository.getSecret(ctx, SMTPSecretName, &value)
	if err != nil {
		return mailer.Settings{}, InstanceSecret{}, err
	}
	return value, secret, nil
}

// DeleteSMTP removes the Console-managed mail server. It reports whether a row existed.
func (repository *InstanceSecretRepository) DeleteSMTP(ctx context.Context) (bool, error) {
	result, err := repository.database.ExecContext(ctx, `DELETE FROM instance_secrets WHERE name=$1`, SMTPSecretName)
	if err != nil {
		return false, err
	}
	affected, err := result.RowsAffected()
	return affected > 0, err
}

// putSecret seals any JSON-encodable value under the row name, which is also the AEAD context,
// so a ciphertext cannot be replayed into another row.
func (repository *InstanceSecretRepository) putSecret(ctx context.Context, actorID uuid.UUID, name string, value any) (InstanceSecret, error) {
	if repository.keyring == nil {
		return InstanceSecret{}, errors.New("managed secrets are disabled")
	}
	plaintext, err := json.Marshal(value)
	if err != nil {
		return InstanceSecret{}, err
	}
	encrypted, keyID, err := repository.keyring.Seal(plaintext, []byte(name))
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
		RETURNING name,key_id,version,updated_by,updated_at`, name, encrypted, keyID, actorID).
		Scan(&secret.Name, &secret.KeyID, &secret.Version, &secret.UpdatedBy, &secret.UpdatedAt)
	return secret, err
}

// getSecret decrypts the row into destination. It returns ErrNotFound when the row is absent.
func (repository *InstanceSecretRepository) getSecret(ctx context.Context, name string, destination any) (InstanceSecret, error) {
	if repository.keyring == nil {
		return InstanceSecret{}, errors.New("managed secrets are disabled")
	}
	var secret InstanceSecret
	var encrypted []byte
	err := repository.database.QueryRowContext(ctx, `SELECT name,encrypted_value,key_id,version,updated_by,updated_at
		FROM instance_secrets WHERE name=$1`, name).
		Scan(&secret.Name, &encrypted, &secret.KeyID, &secret.Version, &secret.UpdatedBy, &secret.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return InstanceSecret{}, ErrNotFound
	}
	if err != nil {
		return InstanceSecret{}, err
	}
	plaintext, keyID, err := repository.keyring.Open(encrypted, []byte(name))
	if err != nil {
		return InstanceSecret{}, fmt.Errorf("decrypt %s using key %s: %w", name, keyID, err)
	}
	defer func() {
		for index := range plaintext {
			plaintext[index] = 0
		}
	}()
	if err := json.Unmarshal(plaintext, destination); err != nil {
		return InstanceSecret{}, err
	}
	return secret, nil
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
