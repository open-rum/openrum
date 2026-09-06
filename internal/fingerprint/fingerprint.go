package fingerprint

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"
)

const Version uint16 = 1

var ErrInvalidCustomFingerprint = errors.New("invalid custom fingerprint")

type Input struct {
	ErrorType string
	Message   string
	Stack     string
	Custom    []string
	MaxFrames int
}

type Result struct {
	Value   string
	Version uint16
	Custom  bool
}

func Compute(input Input) (Result, error) {
	parts, custom, err := fingerprintParts(input)
	if err != nil {
		return Result{}, err
	}
	digest := sha256.New()
	_, _ = fmt.Fprintf(digest, "openrum-fingerprint-v%d\x00", Version)
	for _, part := range parts {
		_, _ = fmt.Fprintf(digest, "%d:%s\x00", len(part), part)
	}
	return Result{Value: fmt.Sprintf("v%d:%s", Version, hex.EncodeToString(digest.Sum(nil))), Version: Version, Custom: custom}, nil
}

func fingerprintParts(input Input) ([]string, bool, error) {
	if len(input.Custom) > 0 {
		if len(input.Custom) > 10 {
			return nil, false, ErrInvalidCustomFingerprint
		}
		parts := make([]string, 0, len(input.Custom)+1)
		parts = append(parts, "custom")
		for _, value := range input.Custom {
			value = strings.TrimSpace(value)
			if value == "" || !utf8.ValidString(value) || utf8.RuneCountInString(value) > 128 || strings.ContainsAny(value, "\x00\r\n") {
				return nil, false, ErrInvalidCustomFingerprint
			}
			parts = append(parts, value)
		}
		return parts, true, nil
	}
	maximum := input.MaxFrames
	if maximum <= 0 || maximum > 10 {
		maximum = 5
	}
	frames := ParseInAppFrames(input.Stack, maximum)
	if len(frames) == 0 {
		frames = []string{"<no-in-app-frame>"}
	}
	parts := []string{"derived", normalizeToken(input.ErrorType), NormalizeMessage(input.Message)}
	return append(parts, frames...), false, nil
}

func normalizeToken(value string) string {
	return strings.ToLower(strings.Join(strings.Fields(value), " "))
}
