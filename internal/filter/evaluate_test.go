package filter_test

import (
	"errors"
	"strings"
	"testing"

	"openrum/internal/event"
	"openrum/internal/filter"
)

func TestGlobMatching(t *testing.T) {
	for _, testCase := range []struct {
		pattern string
		value   string
		want    bool
	}{
		{pattern: "exact", value: "exact", want: true},
		{pattern: "exact", value: "exactly", want: false},
		{pattern: "ResizeObserver loop*", value: "ResizeObserver loop limit exceeded", want: true},
		{pattern: "ResizeObserver loop*", value: "Some other error", want: false},
		{pattern: "*/vendor/analytics.js", value: "at f (https://cdn.example.com/vendor/analytics.js", want: true},
		// The trailing segment is anchored, so a line continuing past it needs
		// an explicit wildcard.
		{pattern: "*/vendor/analytics.js", value: "at f (https://cdn.example.com/vendor/analytics.js:1:2)", want: false},
		{pattern: "*/vendor/analytics.js*", value: "at f (https://cdn.example.com/vendor/analytics.js:1:2)", want: true},
		{pattern: "*", value: "anything", want: true},
		{pattern: "*", value: "", want: true},
		{pattern: "a*b*c", value: "a-b-c", want: true},
		{pattern: "a*b*c", value: "a-c-b", want: false},
		// A wildcard must not let one character satisfy both anchors.
		{pattern: "a*a", value: "a", want: false},
		{pattern: "a*a", value: "aa", want: true},
		{pattern: "CANARY-*", value: "canary-17", want: true},
		{pattern: "canary-*", value: "CANARY-17", want: true},
		{pattern: "https://staging.*", value: "https://staging.example.com/cart", want: true},
		{pattern: "https://staging.*", value: "https://shop.example.com/cart", want: false},
	} {
		t.Run(testCase.pattern+"|"+testCase.value, func(t *testing.T) {
			settings := filter.Settings{Rules: []filter.Rule{
				{ID: "r1", Kind: filter.KindRelease, Pattern: testCase.pattern, Mode: filter.ModeEnforced},
			}}
			compiled, err := filter.Compile(settings)
			if err != nil {
				t.Fatalf("compile: %v", err)
			}
			matches := compiled.Evaluate(event.CanonicalEvent{Release: testCase.value})
			if got := len(matches) > 0; got != testCase.want {
				t.Fatalf("match = %v, want %v", got, testCase.want)
			}
		})
	}
}

func TestEvaluateBuiltinModes(t *testing.T) {
	bot := event.CanonicalEvent{EventType: event.EventTypePageView, IngestFlags: []string{"bot"}}

	for _, testCase := range []struct {
		name      string
		mode      filter.Mode
		wantMatch bool
		wantDrop  bool
	}{
		{name: "off produces no match", mode: filter.ModeOff, wantMatch: false, wantDrop: false},
		{name: "dry run matches but keeps", mode: filter.ModeDryRun, wantMatch: true, wantDrop: false},
		{name: "enforced drops", mode: filter.ModeEnforced, wantMatch: true, wantDrop: true},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			compiled, err := filter.Compile(filter.Settings{
				Builtin: map[filter.Reason]filter.Mode{filter.ReasonBot: testCase.mode},
			})
			if err != nil {
				t.Fatalf("compile: %v", err)
			}
			matches := compiled.Evaluate(bot)
			if got := len(matches) > 0; got != testCase.wantMatch {
				t.Fatalf("match = %v, want %v", got, testCase.wantMatch)
			}
			if got := filter.Drops(matches); got != testCase.wantDrop {
				t.Fatalf("drop = %v, want %v", got, testCase.wantDrop)
			}
		})
	}
}

func TestEvaluateRuleKinds(t *testing.T) {
	errorEvent := event.CanonicalEvent{
		EventType:         event.EventTypeError,
		ErrorType:         "TypeError",
		ErrorMessage:      "undefined is not a function",
		ErrorStack:        "at boot (https://shop.example.com/app.js:1:1)\nat f (https://cdn.example.com/vendor/analytics.js:9:9)",
		PageURLNormalized: "https://staging.example.com/cart",
		Release:           "canary-17",
	}

	for _, testCase := range []struct {
		name      string
		kind      filter.Kind
		pattern   string
		candidate event.CanonicalEvent
		want      bool
	}{
		{
			name: "error message uses the title shown in the issue list",
			kind: filter.KindErrorMessage, pattern: "TypeError: undefined*", candidate: errorEvent, want: true,
		},
		{
			name: "error url matches one frame, not the joined stack",
			kind: filter.KindErrorURL, pattern: "*vendor/analytics.js*", candidate: errorEvent, want: true,
		},
		{
			// A pattern anchored at both ends must not match across the
			// newline that separates two frames.
			name: "error url does not span frames",
			kind: filter.KindErrorURL, pattern: "*app.js:1:1)at*", candidate: errorEvent, want: false,
		},
		{
			name: "page url", kind: filter.KindPageURL, pattern: "https://staging.*", candidate: errorEvent, want: true,
		},
		{
			name: "release", kind: filter.KindRelease, pattern: "canary-*", candidate: errorEvent, want: true,
		},
		{
			// Error-shaped rules must not fire on other event types that have
			// no error fields to speak of.
			name: "error rules ignore non-error events",
			kind: filter.KindErrorMessage, pattern: "*",
			candidate: event.CanonicalEvent{EventType: event.EventTypePageView}, want: false,
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			compiled, err := filter.Compile(filter.Settings{Rules: []filter.Rule{
				{ID: "r1", Kind: testCase.kind, Pattern: testCase.pattern, Mode: filter.ModeEnforced},
			}})
			if err != nil {
				t.Fatalf("compile: %v", err)
			}
			if got := len(compiled.Evaluate(testCase.candidate)) > 0; got != testCase.want {
				t.Fatalf("match = %v, want %v", got, testCase.want)
			}
		})
	}
}

func TestEvaluateReportsEveryOverlappingMatch(t *testing.T) {
	compiled, err := filter.Compile(filter.Settings{
		Builtin: map[filter.Reason]filter.Mode{
			filter.ReasonBot:       filter.ModeDryRun,
			filter.ReasonLocalhost: filter.ModeDryRun,
		},
		Rules: []filter.Rule{
			{ID: "r1", Kind: filter.KindRelease, Pattern: "canary-*", Mode: filter.ModeEnforced},
		},
	})
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	matches := compiled.Evaluate(event.CanonicalEvent{
		EventType: event.EventTypePageView, PageURLNormalized: "http://localhost:5173/",
		Release: "canary-17", IngestFlags: []string{"bot"},
	})
	if len(matches) != 3 {
		t.Fatalf("matches = %+v, want 3", matches)
	}
	// One enforced rule is enough to drop, even when the others only measure.
	if !filter.Drops(matches) {
		t.Fatal("an enforced rule must drop the event")
	}
}

func TestInactiveSettingsSkipEvaluation(t *testing.T) {
	compiled, err := filter.Compile(filter.Settings{})
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	if compiled.Active() {
		t.Fatal("empty settings must be inactive")
	}
	// A project that never configured anything must behave as before.
	if matches := compiled.Evaluate(event.CanonicalEvent{IngestFlags: []string{"bot"}}); matches != nil {
		t.Fatalf("matches = %+v, want none", matches)
	}
}

func TestValidate(t *testing.T) {
	for _, testCase := range []struct {
		name     string
		settings filter.Settings
		wantErr  bool
	}{
		{name: "empty is valid", settings: filter.Settings{}},
		{
			name: "unknown category",
			settings: filter.Settings{Builtin: map[filter.Reason]filter.Mode{
				filter.Reason("everything"): filter.ModeEnforced,
			}},
			wantErr: true,
		},
		{
			name: "unknown mode",
			settings: filter.Settings{Builtin: map[filter.Reason]filter.Mode{
				filter.ReasonBot: filter.Mode("delete_everything"),
			}},
			wantErr: true,
		},
		{
			name: "unknown rule kind",
			settings: filter.Settings{Rules: []filter.Rule{
				{ID: "r1", Kind: filter.Kind("sql"), Pattern: "x", Mode: filter.ModeEnforced},
			}},
			wantErr: true,
		},
		{
			name: "blank pattern",
			settings: filter.Settings{Rules: []filter.Rule{
				{ID: "r1", Kind: filter.KindRelease, Pattern: "   ", Mode: filter.ModeEnforced},
			}},
			wantErr: true,
		},
		{
			name: "duplicate rule id",
			settings: filter.Settings{Rules: []filter.Rule{
				{ID: "r1", Kind: filter.KindRelease, Pattern: "a", Mode: filter.ModeEnforced},
				{ID: "r1", Kind: filter.KindRelease, Pattern: "b", Mode: filter.ModeEnforced},
			}},
			wantErr: true,
		},
		{
			name: "pattern too long",
			settings: filter.Settings{Rules: []filter.Rule{
				{ID: "r1", Kind: filter.KindRelease, Pattern: strings.Repeat("a", filter.MaxPatternLength+1), Mode: filter.ModeEnforced},
			}},
			wantErr: true,
		},
		{
			name: "too many wildcards",
			settings: filter.Settings{Rules: []filter.Rule{
				{ID: "r1", Kind: filter.KindRelease, Pattern: strings.Repeat("*", filter.MaxWildcards+1), Mode: filter.ModeEnforced},
			}},
			wantErr: true,
		},
		{name: "too many rules", settings: filter.Settings{Rules: tooManyRules()}, wantErr: true},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			err := testCase.settings.Validate()
			if (err != nil) != testCase.wantErr {
				t.Fatalf("err = %v, wantErr = %v", err, testCase.wantErr)
			}
			if err != nil && !errors.Is(err, filter.ErrInvalidSettings) {
				t.Fatalf("err = %v, want it to wrap ErrInvalidSettings", err)
			}
		})
	}
}

func tooManyRules() []filter.Rule {
	rules := make([]filter.Rule, 0, filter.MaxRules+1)
	for index := range filter.MaxRules + 1 {
		rules = append(rules, filter.Rule{
			ID: string(rune('a'+index%26)) + string(rune('a'+index/26)),
			// A distinct id per rule so the limit is what fails, not a clash.
			Kind: filter.KindRelease, Pattern: "x", Mode: filter.ModeEnforced,
		})
	}
	return rules
}
