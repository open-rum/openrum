package auth

import "testing"

func TestValidatePasswordRule(t *testing.T) {
	for _, password := range []string{"Abcdef1!", "Str0ng-pass", "密码Abc!def", "Longer passphrase, With Symbols"} {
		if err := ValidatePassword(password); err != nil {
			t.Errorf("%q refused: %v", password, err)
		}
	}
	for name, password := range map[string]string{
		"too short":    "Ab1!xyz",
		"no upper":     "abcdef1!",
		"no lower":     "ABCDEF1!",
		"no symbol":    "Abcdefg1",
		"only digits":  "12345678",
		"empty":        "",
		"far too long": string(make([]rune, maximumPasswordLength+1)),
	} {
		if err := ValidatePassword(password); err == nil {
			t.Errorf("%s: %q was accepted", name, password)
		}
	}
}

// The login manager hashes a fixed password at start-up. If the password rule ever rejects
// it, the API would refuse to start, so this builds one without a database.
func TestNewLoginManagerStarts(t *testing.T) {
	if _, err := NewLoginManager(nil, nil); err != nil {
		t.Fatalf("login manager cannot start: %v", err)
	}
}
