package privacy

import (
	"strings"
	"testing"
)

func TestSensitiveBodyKey(t *testing.T) {
	for _, key := range []string{
		"password", "Password", "newPassword", "access_token", "refreshToken", "Authorization", "api-key", "apiKey",
		"cardNumber", "card_number", "creditCard", "cvv", "ssn", "email", "userEmail", "phone", "sessionId", "csrfToken",
		"clientSecret", "signature",
	} {
		if !SensitiveBodyKey(key) {
			t.Errorf("%s must be sensitive", key)
		}
	}
	for _, key := range []string{"author", "authority", "orderId", "items", "sku", "qty", "total", "status", "name", "coupon", "address"} {
		if SensitiveBodyKey(key) {
			t.Errorf("%s must not be sensitive", key)
		}
	}
}

func TestScrubBodyRedactsSensitiveKeysStructurally(t *testing.T) {
	input := `{"items":[{"sku":"A-1","qty":2}],"coupon":"SPRING","contact":{"email":"buyer@example.com","phone":"13800000000"},` +
		`"payment":{"cardNumber":"4242 4242 4242 4242","token":{"value":"tok_abc","nested":["x"]}},"total":199.50,"big":12345678901234567890,"ok":true,"none":null}`
	got, changed := ScrubBody(input)
	if !changed {
		t.Fatal("redaction must be reported")
	}
	for _, leaked := range []string{"buyer@example.com", "13800000000", "4242", "tok_abc", "nested"} {
		if strings.Contains(got, leaked) {
			t.Fatalf("%q survived: %s", leaked, got)
		}
	}
	for _, kept := range []string{`"sku":"A-1"`, `"qty":2`, `"coupon":"SPRING"`, `"total":199.50`, `12345678901234567890`, `"ok":true`, `"none":null`} {
		if !strings.Contains(got, kept) {
			t.Fatalf("%q lost: %s", kept, got)
		}
	}
	if strings.Index(got, `"items"`) > strings.Index(got, `"contact"`) || strings.Index(got, `"contact"`) > strings.Index(got, `"payment"`) {
		t.Fatalf("key order must be preserved: %s", got)
	}
	if !strings.Contains(got, `"email":"[REDACTED]"`) || !strings.Contains(got, `"token":"[REDACTED]"`) {
		t.Fatalf("values must be replaced by the marker: %s", got)
	}
}

func TestScrubBodyLeavesCleanJSONUntouched(t *testing.T) {
	input := "{\n  \"orderId\": \"o-1\",\n  \"status\": \"created\"\n}"
	got, changed := ScrubBody(input)
	if changed || got != input {
		t.Fatalf("a body with nothing to redact must come back as it was: changed=%v %q", changed, got)
	}
}

func TestScrubBodyRedactsPatternsInsideStrings(t *testing.T) {
	got, changed := ScrubBody(`{"note":"contact ops@example.com or use Bearer abc.def.ghi","html":"<b>a & b</b>"}`)
	if !changed || strings.Contains(got, "ops@example.com") || strings.Contains(got, "abc.def.ghi") {
		t.Fatalf("got %s", got)
	}
	if !strings.Contains(got, "<b>a & b</b>") {
		t.Fatalf("readable characters must not be HTML-escaped: %s", got)
	}
}

func TestScrubBodyHandlesFormEncodedBodies(t *testing.T) {
	got, changed := ScrubBody("user=alice&password=hunter2&note=mail%20me%40example.com&page=3")
	if !changed {
		t.Fatal("redaction must be reported")
	}
	if strings.Contains(got, "hunter2") || strings.Contains(got, "example.com") {
		t.Fatalf("got %s", got)
	}
	if !strings.Contains(got, "user=alice") || !strings.Contains(got, "page=3") || !strings.Contains(got, "password=%5BREDACTED%5D") {
		t.Fatalf("got %s", got)
	}
}

// A body can be cut by a client, or forged so that it does not parse. Scalar values under
// sensitive keys are still redacted.
func TestScrubBodyFallsBackForTextThatIsNotCompleteJSON(t *testing.T) {
	for _, input := range []string{
		`{"user":"a","password":"hunter2","items":[1,2`,
		`prefix {"api_key": "sk-live-123", "n": 4} suffix`,
		`{"a":1,"token":99999 trailing garbage`,
	} {
		got, changed := ScrubBody(input)
		if !changed || strings.Contains(got, "hunter2") || strings.Contains(got, "sk-live-123") || strings.Contains(got, "99999") {
			t.Errorf("input %q -> %q (changed=%v)", input, got, changed)
		}
	}
}

func TestScrubBodyRejectsPathologicalNesting(t *testing.T) {
	deep := strings.Repeat("[", 200) + strings.Repeat("]", 200)
	got, _ := ScrubBody(deep)
	if got == "" {
		t.Fatal("a deeply nested body must still be handled, by the fallback")
	}
}

func TestScrubBodyCapsLengthAndKeepsAMarker(t *testing.T) {
	long := `{"data":"` + strings.Repeat("é", 5000) + `"}`
	got, changed := ScrubBody(long)
	if !changed || !strings.HasSuffix(got, TruncatedMarker) {
		t.Fatalf("a long body must be cut and say so, got length %d", len(got))
	}
	if len(got) > MaxBodyBytes+len(TruncatedMarker) {
		t.Fatalf("length %d exceeds the cap", len(got))
	}
	if !strings.HasPrefix(got, `{"data":"`) {
		t.Fatalf("got %q", got[:20])
	}
	again, againChanged := ScrubBody(got)
	if again != got || againChanged {
		t.Fatalf("scrubbing is idempotent: changed=%v equal=%v", againChanged, again == got)
	}
}

func TestScrubBodyKeepsAnOmittedMarkerAndEmptyBodies(t *testing.T) {
	if got, changed := ScrubBody(OmittedBody); got != OmittedBody || changed {
		t.Fatalf("got %q %v", got, changed)
	}
	if got, changed := ScrubBody(""); got != "" || changed {
		t.Fatalf("got %q %v", got, changed)
	}
	if got, changed := ScrubBody("  \n"); got != "" || !changed {
		t.Fatalf("whitespace only: %q %v", got, changed)
	}
}

func TestScrubBodyPlainText(t *testing.T) {
	got, changed := ScrubBody("Error: invalid email ops@example.com")
	if !changed || strings.Contains(got, "ops@example.com") {
		t.Fatalf("got %q", got)
	}
}
