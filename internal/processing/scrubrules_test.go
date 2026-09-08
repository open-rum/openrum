package processing

import (
	"strings"
	"testing"

	"openrum/internal/privacy"
)

func compileScrub(t *testing.T, rules ScrubRules) *CompiledScrubRules {
	t.Helper()
	compiled, err := rules.Compile()
	if err != nil {
		t.Fatal(err)
	}
	return compiled
}

func TestStringRedactsAProjectPattern(t *testing.T) {
	compiled := compileScrub(t, ScrubRules{Patterns: []ScrubPattern{
		{ID: "order", Expression: `ORD-[0-9]{6}`},
	}})

	scrubbed, changed := compiled.String("payment failed for ORD-123456")

	if !changed || strings.Contains(scrubbed, "123456") {
		t.Fatalf("scrubbed to %q (changed %v), want the order number gone", scrubbed, changed)
	}
	if !strings.Contains(scrubbed, privacy.Redacted) {
		t.Fatalf("scrubbed to %q, want the standard marker", scrubbed)
	}
}

func TestStringLeavesUnmatchedTextAlone(t *testing.T) {
	compiled := compileScrub(t, ScrubRules{Patterns: []ScrubPattern{
		{ID: "order", Expression: `ORD-[0-9]{6}`},
	}})

	scrubbed, changed := compiled.String("payment failed")

	if changed || scrubbed != "payment failed" {
		t.Fatalf("scrubbed to %q (changed %v), want the input unchanged", scrubbed, changed)
	}
}

func TestSensitiveKeyMatchesTheBuiltinWay(t *testing.T) {
	compiled := compileScrub(t, ScrubRules{SensitiveKeys: []string{"ssn"}})

	// Punctuation and case are ignored, matching the built-in list, so a
	// project does not have to enumerate the spellings of its own key.
	for _, key := range []string{"ssn", "user_SSN", "ssn-last4", "customer.ssn"} {
		if !compiled.SensitiveKey(key) {
			t.Fatalf("%q was not recognised as sensitive", key)
		}
	}
	// Matching is on the whole normalized key, so an unrelated name that only
	// shares letters is left alone.
	if compiled.SensitiveKey("session") {
		t.Fatal("`session` was treated as `ssn`")
	}
}

func TestAttributesDropsNamedKeysAndRedactsTheRest(t *testing.T) {
	compiled := compileScrub(t, ScrubRules{
		Patterns:      []ScrubPattern{{ID: "order", Expression: `ORD-[0-9]{6}`}},
		SensitiveKeys: []string{"ssn"},
	})

	result, changed := compiled.Attributes(map[string]string{
		"user_ssn": "123-45-6789",
		"order":    "ORD-123456",
		"page":     "checkout",
	})

	if !changed {
		t.Fatal("attributes reported unchanged")
	}
	if _, present := result["user_ssn"]; present {
		t.Fatal("a key the project named was kept")
	}
	if result["order"] != privacy.Redacted {
		t.Fatalf("order attribute is %q, want it redacted", result["order"])
	}
	if result["page"] != "checkout" {
		t.Fatalf("page attribute is %q, want it untouched", result["page"])
	}
}

func TestValidateRejectsUnusableScrubRules(t *testing.T) {
	cases := map[string]ScrubRules{
		"missing id":            {Patterns: []ScrubPattern{{Expression: "a"}}},
		"empty expression":      {Patterns: []ScrubPattern{{ID: "a", Expression: "  "}}},
		"expression is invalid": {Patterns: []ScrubPattern{{ID: "a", Expression: "([unclosed"}}},
		// An expression matching the empty string replaces between every
		// character, which is never what anybody meant.
		"expression matches everything": {Patterns: []ScrubPattern{{ID: "a", Expression: "x*"}}},
		"expression is too long": {Patterns: []ScrubPattern{
			{ID: "a", Expression: strings.Repeat("a", MaxScrubExpressionSize+1)},
		}},
		"empty key": {SensitiveKeys: []string{" "}},
	}
	for name, rules := range cases {
		t.Run(name, func(t *testing.T) {
			if err := rules.Validate(); err == nil {
				t.Fatal("validation accepted an unusable rule set")
			}
		})
	}
}

func TestSeparatorOnlyKeyDropsNothing(t *testing.T) {
	// It passes validation because it is not blank, but it normalizes to an
	// empty needle. Left unguarded it would drop every attribute the project
	// sends, which is a data loss nobody would connect back to this field.
	compiled := compileScrub(t, ScrubRules{SensitiveKeys: []string{"-"}})

	if compiled.SensitiveKey("page") {
		t.Fatal("a separator-only entry matched an ordinary key")
	}
}

func TestInactiveRulesLeaveTheEventAlone(t *testing.T) {
	compiled := compileScrub(t, ScrubRules{})

	if compiled.Active() {
		t.Fatal("an empty rule set reported itself active")
	}
	if scrubbed, changed := compiled.String("ORD-123456"); changed || scrubbed != "ORD-123456" {
		t.Fatalf("scrubbed %q with no rules configured", scrubbed)
	}
}
