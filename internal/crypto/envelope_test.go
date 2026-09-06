package crypto

import (
	"bytes"
	"errors"
	"testing"
)

func TestEnvelopeEncryptionAuthenticationAndRotation(t *testing.T) {
	oldKey := Key{ID: "2026-01", Material: bytes.Repeat([]byte{1}, 32)}
	newKey := Key{ID: "2026-09", Material: bytes.Repeat([]byte{2}, 32)}
	oldRing, err := NewKeyring(oldKey.ID, oldKey)
	if err != nil {
		t.Fatal(err)
	}
	aad := []byte("channel:018f")
	encrypted, keyID, err := oldRing.Seal([]byte(`{"url":"https://hooks.example.test/secret"}`), aad)
	if err != nil || keyID != oldKey.ID || bytes.Contains(encrypted, []byte("hooks.example")) {
		t.Fatalf("key=%q encrypted=%q err=%v", keyID, encrypted, err)
	}
	ring, err := NewKeyring(newKey.ID, oldKey, newKey)
	if err != nil {
		t.Fatal(err)
	}
	rotated, rotatedKeyID, changed, err := ring.Rotate(encrypted, aad)
	if err != nil || !changed || rotatedKeyID != newKey.ID {
		t.Fatalf("key=%q changed=%v err=%v", rotatedKeyID, changed, err)
	}
	plaintext, openedKeyID, err := ring.Open(rotated, aad)
	if err != nil || openedKeyID != newKey.ID || string(plaintext) != `{"url":"https://hooks.example.test/secret"}` {
		t.Fatalf("key=%q plaintext=%q err=%v", openedKeyID, plaintext, err)
	}
	if _, _, err := ring.Open(rotated, []byte("channel:other")); !errors.Is(err, ErrInvalidEnvelope) {
		t.Fatalf("tampered AAD error=%v", err)
	}
}

func TestEnvelopeRejectsUnknownKeyAndInvalidMaterial(t *testing.T) {
	if _, err := NewKeyring("missing", Key{ID: "bad", Material: []byte("short")}); err == nil {
		t.Fatal("expected invalid key material")
	}
	oldKey := Key{ID: "old", Material: bytes.Repeat([]byte{3}, 32)}
	oldRing, _ := NewKeyring(oldKey.ID, oldKey)
	encrypted, _, _ := oldRing.Seal([]byte("secret"), nil)
	newRing, _ := NewKeyring("new", Key{ID: "new", Material: bytes.Repeat([]byte{4}, 32)})
	if _, _, err := newRing.Open(encrypted, nil); !errors.Is(err, ErrUnknownKey) {
		t.Fatalf("unknown key error=%v", err)
	}
}
