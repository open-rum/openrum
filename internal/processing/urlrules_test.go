package processing

import (
	"strings"
	"testing"
)

func compileRules(t *testing.T, rules ...Rule) *CompiledURLRules {
	t.Helper()
	compiled, err := URLRules{Rules: rules}.Compile()
	if err != nil {
		t.Fatal(err)
	}
	return compiled
}

func TestApplyToPathCollapsesShortSlugsTheHeuristicsMiss(t *testing.T) {
	// The case the built-in heuristics cannot reach: a four character slug is
	// indistinguishable from a real path segment without knowing the routes.
	compiled := compileRules(t, Rule{ID: "orders", Target: TargetPage, Pattern: "/orders/:orderId"})

	first, matchedFirst := compiled.ApplyToPath(TargetPage, "/orders/8fc1")
	second, matchedSecond := compiled.ApplyToPath(TargetPage, "/orders/9ab2")

	if !matchedFirst || !matchedSecond || first != second {
		t.Fatalf("collapsed to %q and %q (matched %v, %v), want one shared row",
			first, second, matchedFirst, matchedSecond)
	}
	if first != "/orders/:orderId" {
		t.Fatalf("collapsed to %q, want the pattern itself", first)
	}
}

func TestApplyToPathMatchesAlreadySubstitutedSegments(t *testing.T) {
	// Rules run after normalization, so a numeric id has already become `:id`.
	// A rule that did not match it would split one route across two rows: the
	// long ids under `:id` and the short ones under the project's own name.
	compiled := compileRules(t, Rule{ID: "orders", Target: TargetPage, Pattern: "/orders/:orderId"})

	rewritten, matched := compiled.ApplyToPath(TargetPage, "/orders/:id")

	if !matched || rewritten != "/orders/:orderId" {
		t.Fatalf("rewrote %q (matched %v), want /orders/:orderId", rewritten, matched)
	}
}

func TestApplyToPathUsesTheFirstMatchingRule(t *testing.T) {
	compiled := compileRules(t,
		Rule{ID: "new", Target: TargetPage, Pattern: "/orders/new"},
		Rule{ID: "detail", Target: TargetPage, Pattern: "/orders/:orderId"},
	)

	rewritten, matched := compiled.ApplyToPath(TargetPage, "/orders/new")

	if !matched || rewritten != "/orders/new" {
		t.Fatalf("rewrote %q (matched %v), want the specific rule to win", rewritten, matched)
	}
}

func TestApplyToPathRespectsSegmentCount(t *testing.T) {
	compiled := compileRules(t, Rule{ID: "orders", Target: TargetPage, Pattern: "/orders/:orderId"})

	for _, path := range []string{"/orders", "/orders/8fc1/items", "/orders/", "/basket/8fc1"} {
		if rewritten, matched := compiled.ApplyToPath(TargetPage, path); matched {
			t.Fatalf("%q was rewritten to %q, want no match", path, rewritten)
		}
	}
}

func TestApplyToPathTailWildcardKeepsTheParentAsItsOwnRow(t *testing.T) {
	compiled := compileRules(t, Rule{ID: "assets", Target: TargetPage, Pattern: "/assets/*"})

	if rewritten, matched := compiled.ApplyToPath(TargetPage, "/assets/js/app.js"); !matched || rewritten != "/assets/*" {
		t.Fatalf("rewrote %q (matched %v), want /assets/*", rewritten, matched)
	}
	if _, matched := compiled.ApplyToPath(TargetPage, "/assets"); matched {
		t.Fatal("/assets matched /assets/*, want the parent page to keep its own row")
	}
}

func TestApplyToPathIgnoresCaseInLiteralSegments(t *testing.T) {
	compiled := compileRules(t, Rule{ID: "orders", Target: TargetPage, Pattern: "/orders/:orderId"})

	if rewritten, matched := compiled.ApplyToPath(TargetPage, "/Orders/8fc1"); !matched || rewritten != "/orders/:orderId" {
		t.Fatalf("rewrote %q (matched %v), want the lowercase pattern", rewritten, matched)
	}
}

func TestApplyToURLRewritesOnlyThePath(t *testing.T) {
	compiled := compileRules(t, Rule{ID: "orders", Target: TargetBoth, Pattern: "/orders/:orderId"})

	rewritten, matched := compiled.ApplyToURL(TargetAPI, "https://api.example.com/orders/8fc1")

	if !matched || rewritten != "https://api.example.com/orders/:orderId" {
		t.Fatalf("rewrote %q (matched %v), want the host preserved", rewritten, matched)
	}
}

func TestApplyRespectsTheTarget(t *testing.T) {
	compiled := compileRules(t, Rule{ID: "orders", Target: TargetAPI, Pattern: "/orders/:orderId"})

	if _, matched := compiled.ApplyToPath(TargetPage, "/orders/8fc1"); matched {
		t.Fatal("an API rule rewrote a page address")
	}
	if _, matched := compiled.ApplyToPath(TargetAPI, "/orders/8fc1"); !matched {
		t.Fatal("an API rule did not rewrite an API address")
	}
}

func TestValidateRejectsUnusablePatterns(t *testing.T) {
	cases := map[string]Rule{
		"missing leading slash": {ID: "a", Target: TargetPage, Pattern: "orders/:id"},
		"empty pattern":         {ID: "a", Target: TargetPage, Pattern: ""},
		"unknown target":        {ID: "a", Target: "everything", Pattern: "/orders"},
		"missing id":            {ID: "", Target: TargetPage, Pattern: "/orders"},
		"wildcard in the middle": {
			ID: "a", Target: TargetPage, Pattern: "/orders/*/items",
		},
		"partial wildcard":     {ID: "a", Target: TargetPage, Pattern: "/orders/id-*"},
		"empty placeholder":    {ID: "a", Target: TargetPage, Pattern: "/orders/:"},
		"numeric placeholder":  {ID: "a", Target: TargetPage, Pattern: "/orders/:1"},
		"pattern is too long":  {ID: "a", Target: TargetPage, Pattern: "/" + strings.Repeat("x", MaxURLPatternLength)},
		"too many path pieces": {ID: "a", Target: TargetPage, Pattern: strings.Repeat("/a", MaxURLPatternSegments)},
	}
	for name, rule := range cases {
		t.Run(name, func(t *testing.T) {
			if err := (URLRules{Rules: []Rule{rule}}).Validate(); err == nil {
				t.Fatal("validation accepted an unusable rule")
			}
		})
	}
}

func TestValidateRejectsDuplicateRuleIDs(t *testing.T) {
	rules := URLRules{Rules: []Rule{
		{ID: "same", Target: TargetPage, Pattern: "/a"},
		{ID: "same", Target: TargetPage, Pattern: "/b"},
	}}

	if err := rules.Validate(); err == nil {
		t.Fatal("validation accepted two rules with one id")
	}
}

func TestInactiveRulesLeaveThePathAlone(t *testing.T) {
	compiled := compileRules(t)

	if compiled.Active() {
		t.Fatal("an empty rule set reported itself active")
	}
	if rewritten, matched := compiled.ApplyToPath(TargetPage, "/orders/8fc1"); matched || rewritten != "/orders/8fc1" {
		t.Fatalf("rewrote %q with no rules configured", rewritten)
	}
}
