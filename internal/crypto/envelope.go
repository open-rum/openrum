package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
)

var (
	ErrUnknownKey      = errors.New("unknown encryption key")
	ErrInvalidEnvelope = errors.New("invalid encrypted envelope")
)

type Key struct {
	ID       string
	Material []byte
}

type Keyring struct {
	active string
	keys   map[string][]byte
	random io.Reader
}

type envelope struct {
	Version    int    `json:"v"`
	KeyID      string `json:"kid"`
	Nonce      string `json:"nonce"`
	Ciphertext string `json:"ciphertext"`
}

func NewKeyring(activeKeyID string, keys ...Key) (*Keyring, error) {
	keyring := &Keyring{active: activeKeyID, keys: make(map[string][]byte), random: rand.Reader}
	for _, key := range keys {
		if key.ID == "" || len(key.Material) != 32 {
			return nil, errors.New("envelope keys require a non-empty ID and 32 bytes of material")
		}
		if _, exists := keyring.keys[key.ID]; exists {
			return nil, errors.New("envelope key IDs must be unique")
		}
		keyring.keys[key.ID] = append([]byte(nil), key.Material...)
	}
	if _, ok := keyring.keys[activeKeyID]; !ok {
		return nil, fmt.Errorf("active key %q: %w", activeKeyID, ErrUnknownKey)
	}
	return keyring, nil
}

func (keyring *Keyring) Seal(plaintext, additionalData []byte) ([]byte, string, error) {
	material := keyring.keys[keyring.active]
	block, err := aes.NewCipher(material)
	if err != nil {
		return nil, "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(keyring.random, nonce); err != nil {
		return nil, "", fmt.Errorf("generate envelope nonce: %w", err)
	}
	encoded, err := json.Marshal(envelope{
		Version: 1, KeyID: keyring.active,
		Nonce:      base64.RawStdEncoding.EncodeToString(nonce),
		Ciphertext: base64.RawStdEncoding.EncodeToString(gcm.Seal(nil, nonce, plaintext, additionalData)),
	})
	if err != nil {
		return nil, "", err
	}
	return encoded, keyring.active, nil
}

func (keyring *Keyring) Open(encoded, additionalData []byte) ([]byte, string, error) {
	var value envelope
	if len(encoded) > 32<<10 || json.Unmarshal(encoded, &value) != nil || value.Version != 1 || value.KeyID == "" {
		return nil, "", ErrInvalidEnvelope
	}
	material, ok := keyring.keys[value.KeyID]
	if !ok {
		return nil, value.KeyID, ErrUnknownKey
	}
	nonce, nonceErr := base64.RawStdEncoding.DecodeString(value.Nonce)
	ciphertext, ciphertextErr := base64.RawStdEncoding.DecodeString(value.Ciphertext)
	block, blockErr := aes.NewCipher(material)
	if nonceErr != nil || ciphertextErr != nil || blockErr != nil {
		return nil, value.KeyID, ErrInvalidEnvelope
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil || len(nonce) != gcm.NonceSize() {
		return nil, value.KeyID, ErrInvalidEnvelope
	}
	plaintext, err := gcm.Open(nil, nonce, ciphertext, additionalData)
	if err != nil {
		return nil, value.KeyID, ErrInvalidEnvelope
	}
	return plaintext, value.KeyID, nil
}

func (keyring *Keyring) Rotate(encoded, additionalData []byte) ([]byte, string, bool, error) {
	plaintext, previousKeyID, err := keyring.Open(encoded, additionalData)
	if err != nil {
		return nil, "", false, err
	}
	if previousKeyID == keyring.active {
		return append([]byte(nil), encoded...), previousKeyID, false, nil
	}
	rotated, keyID, err := keyring.Seal(plaintext, additionalData)
	return rotated, keyID, true, err
}
