package avatar

import (
	"bytes"
	"encoding/binary"
	"errors"
	"hash/crc32"
	"image"
	"image/color"
	"image/gif"
	"image/jpeg"
	"image/png"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func square(size int) *image.RGBA {
	picture := image.NewRGBA(image.Rect(0, 0, size, size))
	for x := 0; x < size; x++ {
		for y := 0; y < size; y++ {
			picture.Set(x, y, color.RGBA{R: uint8(x), G: uint8(y), B: 120, A: 255})
		}
	}
	return picture
}

func encodePNG(t *testing.T, picture image.Image) []byte {
	t.Helper()
	var buffer bytes.Buffer
	if err := png.Encode(&buffer, picture); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func TestValidateGeneratedAcceptsOnlyKnownStylesAndPlainSeeds(t *testing.T) {
	for _, value := range []string{"dicebear:lorelei:abc123", "dicebear:shapes:A_b-9", "dicebear:thumbs:" + strings.Repeat("x", 40)} {
		if err := ValidateGenerated(value); err != nil {
			t.Errorf("%q rejected: %v", value, err)
		}
	}
	for _, value := range []string{
		"", "lorelei:abc", "dicebear:", "dicebear:lorelei", "dicebear:lorelei:",
		"dicebear:fun-emoji:abc", // a real style, but one that needs attribution
		"dicebear:lorelei:" + strings.Repeat("x", 41),
		"dicebear:lorelei:a b", "dicebear:lorelei:a/b", "dicebear:lorelei:a?x=1", "dicebear:lorelei:a&b",
		"dicebear:lorelei:person@example.com", // a seed is never an email
		"dicebear:lorelei:<script>", "dicebear:lorelei:a:b",
		"upload:" + strings.Repeat("a", 32), "https://api.dicebear.com/10.x/lorelei/svg?seed=a",
	} {
		if err := ValidateGenerated(value); !errors.Is(err, ErrInvalid) {
			t.Errorf("%q accepted (err=%v)", value, err)
		}
	}
}

func TestUploadReferences(t *testing.T) {
	hash := strings.Repeat("ab", 16)
	if got, ok := ParseUpload(UploadValue(hash)); !ok || got != hash {
		t.Fatalf("round trip = %q %v", got, ok)
	}
	for _, value := range []string{"", "upload:", "upload:short", "upload:" + strings.Repeat("A", 32), "upload:../" + hash[:28], "dicebear:lorelei:a"} {
		if _, ok := ParseUpload(value); ok {
			t.Errorf("%q parsed as an upload", value)
		}
	}
	id := uuid.MustParse("018f4d9c-83a1-76c9-81c2-3020ab667092")
	if key := ObjectKey(id, hash); key != "users/018f4d9c-83a1-76c9-81c2-3020ab667092/avatar/"+hash+".png" {
		t.Fatalf("key = %q", key)
	}
}

func TestNormalizeReencodesAValidPicture(t *testing.T) {
	clean, hash, err := Normalize(encodePNG(t, square(256)))
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := ParseUpload(UploadValue(hash)); !ok {
		t.Fatalf("hash %q is not a valid reference", hash)
	}
	decoded, err := png.Decode(bytes.NewReader(clean))
	if err != nil || decoded.Bounds().Dx() != 256 || decoded.Bounds().Dy() != 256 {
		t.Fatalf("decoded=%v err=%v", decoded, err)
	}
	// The same pixels hash the same, so uploading twice does not make two objects.
	_, again, _ := Normalize(encodePNG(t, square(256)))
	if again != hash {
		t.Fatalf("hash changed between identical uploads: %s %s", hash, again)
	}
}

func TestNormalizeDropsEverythingButThePixels(t *testing.T) {
	original := encodePNG(t, square(64))
	smuggled := append(append([]byte{}, original...), []byte("<script>alert(1)</script>")...)
	clean, _, err := Normalize(smuggled)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(clean, []byte("<script>")) {
		t.Fatal("trailing data survived re-encoding")
	}
}

func TestNormalizeRefusesWhatIsNotAUsablePNG(t *testing.T) {
	var jpegBytes, gifBytes bytes.Buffer
	if err := jpeg.Encode(&jpegBytes, square(64), nil); err != nil {
		t.Fatal(err)
	}
	if err := gif.Encode(&gifBytes, square(64), nil); err != nil {
		t.Fatal(err)
	}
	for name, body := range map[string][]byte{
		"jpeg": jpegBytes.Bytes(),
		"gif":  gifBytes.Bytes(),
		"svg":  []byte(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><script>alert(1)</script></svg>`),
		"html": []byte("<html></html>"),
	} {
		if _, _, err := Normalize(body); !errors.Is(err, ErrNotPNG) {
			t.Errorf("%s: err=%v, want ErrNotPNG", name, err)
		}
	}
	for name, body := range map[string][]byte{
		"empty":     nil,
		"truncated": encodePNG(t, square(64))[:40],
		"too small": encodePNG(t, square(MinDimension-1)),
		"too large": encodePNG(t, square(MaxDimension+1)),
		"oversized": append(encodePNG(t, square(64)), make([]byte, MaxUploadBytes)...),
	} {
		if _, _, err := Normalize(body); !errors.Is(err, ErrBadImage) {
			t.Errorf("%s: err=%v, want ErrBadImage", name, err)
		}
	}
}

func TestNormalizeRefusesAHugeCanvasBeforeDecodingIt(t *testing.T) {
	// A header that claims 60000x60000 is a few dozen bytes; it must be refused from the
	// header alone, not by allocating the pixels.
	header := encodePNG(t, square(64))
	copy(header[16:20], []byte{0x00, 0x00, 0xEA, 0x60})
	copy(header[20:24], []byte{0x00, 0x00, 0xEA, 0x60})
	// Keep the chunk checksum valid, so the refusal is about the size and not the damage.
	binary.BigEndian.PutUint32(header[29:33], crc32.ChecksumIEEE(header[12:29]))
	if config, err := png.DecodeConfig(bytes.NewReader(header)); err != nil || config.Width != 60000 {
		t.Fatalf("test header is not a valid 60000-pixel PNG header: %+v %v", config, err)
	}
	if _, _, err := Normalize(header); !errors.Is(err, ErrBadImage) {
		t.Fatalf("err=%v", err)
	}
}
