//go:build integration

package metadata

import (
	"bytes"
	"context"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	openrumcrypto "openrum/internal/crypto"
)

func TestInstanceSecretSurvivesRestartAndRotatesKeyVersion(t *testing.T) {
	database := openIntegrationDatabase(t)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	actorID := uuid.New()
	if _, err := database.ExecContext(ctx,
		"INSERT INTO users (id,email,display_name,password_hash) VALUES ($1,$2,'Secret Owner','hash')",
		actorID, actorID.String()+"@example.test"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = database.ExecContext(context.Background(), "DELETE FROM instance_secrets WHERE name=$1", ObjectStorageSecretName)
		_, _ = database.ExecContext(context.Background(), "DELETE FROM users WHERE id=$1", actorID)
	})

	oldKey := openrumcrypto.Key{ID: "old-key", Material: bytes.Repeat([]byte{0x11}, 32)}
	newKey := openrumcrypto.Key{ID: "new-key", Material: bytes.Repeat([]byte{0x22}, 32)}
	oldKeyring, err := openrumcrypto.NewKeyring(oldKey.ID, oldKey)
	if err != nil {
		t.Fatal(err)
	}
	value := ManagedObjectStorage{
		Provider: "s3", Endpoint: "https://objects.example.test", Bucket: "telemetry",
		Region: "us-east-1", AccessKeyID: "integration-access", SecretAccessKey: "integration-secret",
	}

	first, err := NewInstanceSecretRepository(database, oldKeyring).PutObjectStorage(ctx, actorID, value)
	if err != nil {
		t.Fatal(err)
	}
	if first.KeyID != oldKey.ID || first.Version != 1 {
		t.Fatalf("unexpected first secret metadata: %+v", first)
	}

	// Reconstructing the repository models a process restart: only the database
	// envelope and configured keyring remain available.
	restarted := NewInstanceSecretRepository(database, oldKeyring)
	reloaded, metadata, err := restarted.GetObjectStorage(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if reloaded != value || metadata.KeyID != oldKey.ID || metadata.Version != 1 {
		t.Fatalf("restart did not restore the managed value: value=%+v metadata=%+v", reloaded, metadata)
	}

	rotatingKeyring, err := openrumcrypto.NewKeyring(newKey.ID, oldKey, newKey)
	if err != nil {
		t.Fatal(err)
	}
	rotatingRepository := NewInstanceSecretRepository(database, rotatingKeyring)
	if _, _, err := rotatingRepository.GetObjectStorage(ctx); err != nil {
		t.Fatalf("new keyring must decrypt an envelope written by the old key: %v", err)
	}
	rotated, err := rotatingRepository.PutObjectStorage(ctx, actorID, value)
	if err != nil {
		t.Fatal(err)
	}
	if rotated.KeyID != newKey.ID || rotated.Version != 2 {
		t.Fatalf("rotation did not advance key and version: %+v", rotated)
	}

	var encrypted string
	if err := database.QueryRowContext(ctx,
		"SELECT encode(encrypted_value, 'escape') FROM instance_secrets WHERE name=$1",
		ObjectStorageSecretName).Scan(&encrypted); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(encrypted, value.AccessKeyID) || strings.Contains(encrypted, value.SecretAccessKey) {
		t.Fatal("database envelope contains plaintext credentials")
	}
}
