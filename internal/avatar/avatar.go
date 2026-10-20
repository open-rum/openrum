// Package avatar defines what a profile picture reference looks like and how an uploaded
// picture is checked. The reference is stored in users.avatar; image bytes never are.
package avatar

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	"image/png"
	"regexp"
	"strings"

	"github.com/google/uuid"
)

const (
	// MaxUploadBytes bounds the request body. The Console sends a 256-pixel square, which is
	// far smaller; the allowance is for other clients and for poorly compressed PNGs.
	MaxUploadBytes = 512 << 10
	// MaxDimension is the longest side an uploaded picture may have.
	MaxDimension = 512
	// MinDimension keeps out pictures too small to be a profile picture.
	MinDimension = 32

	generatedPrefix = "dicebear:"
	uploadPrefix    = "upload:"
	// ContentType is what an uploaded picture is stored and served as.
	ContentType = "image/png"
)

// Styles are the generated looks a person may pick. Every one is licensed CC0, so no
// attribution is owed. A reference naming any other style is refused.
var Styles = []string{"lorelei", "notionists", "thumbs", "shapes"}

var (
	ErrInvalid  = errors.New("avatar is invalid")
	ErrNotPNG   = errors.New("avatar must be a PNG image")
	ErrBadImage = errors.New("avatar image is not usable")

	seedPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,40}$`)
	hashPattern = regexp.MustCompile(`^[0-9a-f]{32}$`)
)

// ValidateGenerated accepts only "dicebear:<known style>:<plain seed>". A seed is an opaque
// random string chosen in the browser; it is never derived from a name or an email.
func ValidateGenerated(value string) error {
	rest, ok := strings.CutPrefix(value, generatedPrefix)
	if !ok {
		return ErrInvalid
	}
	style, seed, ok := strings.Cut(rest, ":")
	if !ok || !seedPattern.MatchString(seed) {
		return ErrInvalid
	}
	for _, known := range Styles {
		if style == known {
			return nil
		}
	}
	return ErrInvalid
}

// UploadValue is the reference stored for an uploaded picture with the given content hash.
func UploadValue(hash string) string { return uploadPrefix + hash }

// ParseUpload returns the content hash of an uploaded-picture reference.
func ParseUpload(value string) (string, bool) {
	hash, ok := strings.CutPrefix(value, uploadPrefix)
	if !ok || !hashPattern.MatchString(hash) {
		return "", false
	}
	return hash, true
}

// ObjectKey is where an uploaded picture lives in object storage.
func ObjectKey(userID uuid.UUID, hash string) string {
	return fmt.Sprintf("users/%s/avatar/%s.png", userID, hash)
}

// Normalize checks an uploaded picture and returns it re-encoded with its content hash.
// Only PNG is accepted, and the picture is decoded and written out again, so anything
// beyond the pixels (metadata, trailing data, a polyglot payload) does not survive.
func Normalize(body []byte) (clean []byte, hash string, err error) {
	if len(body) == 0 || len(body) > MaxUploadBytes {
		return nil, "", ErrBadImage
	}
	if !bytes.HasPrefix(body, []byte("\x89PNG\r\n\x1a\n")) {
		return nil, "", ErrNotPNG
	}
	config, err := png.DecodeConfig(bytes.NewReader(body))
	if err != nil {
		return nil, "", ErrBadImage
	}
	// Dimensions are read before decoding, so a small file cannot ask for a huge canvas.
	if config.Width < MinDimension || config.Height < MinDimension ||
		config.Width > MaxDimension || config.Height > MaxDimension {
		return nil, "", ErrBadImage
	}
	decoded, err := png.Decode(bytes.NewReader(body))
	if err != nil {
		return nil, "", ErrBadImage
	}
	return encode(decoded)
}

func encode(picture image.Image) ([]byte, string, error) {
	var buffer bytes.Buffer
	if err := png.Encode(&buffer, picture); err != nil {
		return nil, "", ErrBadImage
	}
	digest := sha256.Sum256(buffer.Bytes())
	return buffer.Bytes(), hex.EncodeToString(digest[:16]), nil
}
