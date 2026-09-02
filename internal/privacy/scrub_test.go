package privacy

import "testing"

func TestScrubStringRemovesCommonSensitiveValues(t *testing.T) {
	input := "user@example.com Bearer secret-token-123 eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature 4242 4242 4242 4242"
	got, changed := ScrubString(input, 1024)
	if !changed || got == input || containsAny(got, "user@example.com", "secret-token-123", "eyJhbGci", "4242 4242") {
		t.Fatalf("scrubbed=%q changed=%v", got, changed)
	}
}

func TestScrubAttributesDropsSensitiveKeysAndBoundsValues(t *testing.T) {
	got, changed := ScrubAttributes(map[string]string{
		"authorization": "Bearer secret",
		"member_level":  "gold",
		"contact":       "user@example.com",
	}, 20)
	if !changed || got["authorization"] != "" || got["member_level"] != "gold" || got["contact"] == "user@example.com" {
		t.Fatalf("attributes=%v changed=%v", got, changed)
	}
}

func containsAny(value string, candidates ...string) bool {
	for _, candidate := range candidates {
		if candidate != "" && len(value) >= len(candidate) {
			for index := 0; index+len(candidate) <= len(value); index++ {
				if value[index:index+len(candidate)] == candidate {
					return true
				}
			}
		}
	}
	return false
}
