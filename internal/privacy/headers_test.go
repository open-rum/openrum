package privacy

import (
	"reflect"
	"strings"
	"testing"
)

func TestSensitiveHeader(t *testing.T) {
	for _, name := range []string{
		"authorization", "Proxy-Authorization", "cookie", "set-cookie", "x-api-key", "X_API_KEY", "x-auth-token",
		"x-csrf-token", "x-xsrf-token", "x-amz-security-token", "x-signature", "x-forwarded-for", "x-real-ip",
		"x-session-id", "x-user-email", "x-client-ip",
	} {
		if !SensitiveHeader(name) {
			t.Errorf("%s must be sensitive", name)
		}
	}
	for _, name := range []string{
		"content-type", "cache-control", "etag", "x-request-id", "traceparent", "x-ratelimit-remaining",
		"access-control-allow-origin", "accept", "content-length", "retry-after", "vary", "server-timing",
	} {
		if SensitiveHeader(name) {
			t.Errorf("%s must not be sensitive", name)
		}
	}
}

func TestValidHeaderName(t *testing.T) {
	for name, want := range map[string]bool{
		"etag": true, "x-request-id": true, "a1": true, "": false, "-x": false, "X-Id": false,
		"x_id": false, "x id": false, strings.Repeat("a", MaxHeaderNameLength): true, strings.Repeat("a", MaxHeaderNameLength+1): false,
	} {
		if got := ValidHeaderName(name); got != want {
			t.Errorf("ValidHeaderName(%q) = %v, want %v", name, got, want)
		}
	}
}

func TestScrubHeaders(t *testing.T) {
	got, changed := ScrubHeaders(map[string]string{
		"Content-Type":  " application/json ",
		"Authorization": "Bearer abc.def",
		"Set-Cookie":    "sid=1",
		"x-contact":     "ops@example.com",
		"x-token-ish":   "v",
		"bad name":      "v",
		"x-long":        strings.Repeat("a", MaxHeaderValueLength+50),
	})
	if !changed {
		t.Fatal("dropping and rewriting must report a change")
	}
	if got["content-type"] != "application/json" {
		t.Errorf("content-type = %q", got["content-type"])
	}
	for _, name := range []string{"authorization", "set-cookie", "x-token-ish", "bad name"} {
		if _, kept := got[name]; kept {
			t.Errorf("%s must be dropped", name)
		}
	}
	if got["x-contact"] != "[REDACTED_EMAIL]" {
		t.Errorf("email value = %q, want redacted", got["x-contact"])
	}
	if len(got["x-long"]) != MaxHeaderValueLength {
		t.Errorf("long value length = %d, want %d", len(got["x-long"]), MaxHeaderValueLength)
	}
}

func TestScrubHeadersBoundsCountDeterministically(t *testing.T) {
	input := map[string]string{}
	for index := 0; index < MaxHeaders+10; index++ {
		input["x-h"+string(rune('a'+index%26))+string(rune('a'+index/26))] = "v"
	}
	first, changed := ScrubHeaders(input)
	second, _ := ScrubHeaders(input)
	if !changed || len(first) != MaxHeaders || !reflect.DeepEqual(first, second) {
		t.Fatalf("count = %d changed = %v deterministic = %v", len(first), changed, reflect.DeepEqual(first, second))
	}
}

func TestScrubHeadersEmpty(t *testing.T) {
	if got, changed := ScrubHeaders(nil); got != nil || changed {
		t.Fatalf("nil input = %v, %v", got, changed)
	}
	if got, changed := ScrubHeaders(map[string]string{"cookie": "x"}); got != nil || !changed {
		t.Fatalf("only sensitive = %v, %v", got, changed)
	}
}
