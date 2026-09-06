package security_test

import (
	"bytes"
	"compress/gzip"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"

	"openrum/internal/ingest"
	"openrum/internal/privacy"
)

func TestPrivacyScrubberRemovesSensitiveKeysAndValues(t *testing.T) {
	attributes, changed := privacy.ScrubAttributes(map[string]string{
		"Authorization": "Bearer top-secret-token",
		"contact":       "operator@example.com",
		"payment":       "4242 4242 4242 4242",
		"plan":          "pro",
	}, 20)
	serialized := strings.Join([]string{attributes["Authorization"], attributes["contact"], attributes["payment"]}, " ")
	if !changed || attributes["plan"] != "pro" || strings.Contains(serialized, "top-secret") ||
		strings.Contains(serialized, "operator@example.com") || strings.Contains(serialized, "4242 4242") {
		t.Fatalf("scrubbed attributes=%v changed=%v", attributes, changed)
	}
}

func TestIngestRejectsDecompressionBomb(t *testing.T) {
	var compressed bytes.Buffer
	writer := gzip.NewWriter(&compressed)
	if _, err := writer.Write(bytes.Repeat([]byte("x"), int(ingest.MaxRawBodyBytes)+1)); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest("POST", "/ingest/v1/envelope", bytes.NewReader(compressed.Bytes()))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Content-Encoding", "gzip")
	if _, err := ingest.ReadEnvelopeBody(request); !errors.Is(err, ingest.ErrPayloadTooLarge) {
		t.Fatalf("decompression bomb error=%v", err)
	}
}
