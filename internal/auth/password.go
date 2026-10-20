package auth

import (
	"fmt"
	"unicode"
	"unicode/utf8"

	"github.com/alexedwards/argon2id"
)

const (
	minimumPasswordLength = 8
	maximumPasswordLength = 1024
)

func HashPassword(password string) (string, error) {
	if err := ValidatePassword(password); err != nil {
		return "", err
	}
	hash, err := argon2id.CreateHash(password, argon2id.DefaultParams)
	if err != nil {
		return "", fmt.Errorf("create Argon2id hash: %w", err)
	}
	return hash, nil
}

func VerifyPassword(password, hash string) (bool, error) {
	valid, err := argon2id.ComparePasswordAndHash(password, hash)
	if err != nil {
		return false, fmt.Errorf("compare Argon2id hash: %w", err)
	}
	return valid, nil
}

// ValidatePassword enforces the one password rule every sign-up and password change shares:
// at least 8 characters containing an upper-case letter, a lower-case letter and a symbol.
func ValidatePassword(password string) error {
	length := utf8.RuneCountInString(password)
	if length < minimumPasswordLength || length > maximumPasswordLength {
		return &ValidationError{Field: "password"}
	}
	var upper, lower, special bool
	for _, r := range password {
		switch {
		case unicode.IsUpper(r):
			upper = true
		case unicode.IsLower(r):
			lower = true
		case unicode.IsPunct(r) || unicode.IsSymbol(r):
			special = true
		}
	}
	if !upper || !lower || !special {
		return &ValidationError{Field: "password"}
	}
	return nil
}
