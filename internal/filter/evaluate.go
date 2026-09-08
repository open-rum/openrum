package filter

import (
	"strings"

	"openrum/internal/event"
)

// Match records why an event matched and what the project asked for.
type Match struct {
	// Reason is drawn from a closed set so it is safe as a metric label.
	Reason Reason
	Mode   Mode
	// RuleID identifies a custom rule and is empty for a built-in category.
	// It is not used as a metric label; it exists so a rule can report when it
	// last matched, which is how dead rules get found.
	RuleID string
}

// Compiled is the evaluation-ready form of a project's settings. Patterns are
// compiled once per settings version rather than once per event.
type Compiled struct {
	builtin map[Reason]Mode
	rules   []compiledRule
}

type compiledRule struct {
	id      string
	kind    Kind
	mode    Mode
	pattern glob
}

// Compile validates the settings and prepares them for evaluation.
func Compile(settings Settings) (*Compiled, error) {
	if err := settings.Validate(); err != nil {
		return nil, err
	}
	compiled := &Compiled{builtin: make(map[Reason]Mode, len(builtinReasons))}
	for _, reason := range builtinReasons {
		if mode := settings.ModeOf(reason); mode != ModeOff {
			compiled.builtin[reason] = mode
		}
	}
	for _, rule := range settings.Rules {
		if rule.Mode == ModeOff {
			continue
		}
		compiled.rules = append(compiled.rules, compiledRule{
			id: rule.ID, kind: rule.Kind, mode: rule.Mode, pattern: compileGlob(rule.Pattern),
		})
	}
	return compiled, nil
}

// Active reports whether anything is configured. An inactive set skips
// evaluation entirely, which is the common case for a project that has never
// opened the settings page.
func (compiled *Compiled) Active() bool {
	return compiled != nil && (len(compiled.builtin) > 0 || len(compiled.rules) > 0)
}

// Evaluate returns every match for the event. All matches are returned rather
// than the first, so the counters show which categories overlap instead of
// attributing an event to whichever rule happened to be checked first.
func (compiled *Compiled) Evaluate(candidate event.CanonicalEvent) []Match {
	if !compiled.Active() {
		return nil
	}
	var matches []Match
	for _, reason := range Classify(candidate) {
		if mode, ok := compiled.builtin[reason]; ok {
			matches = append(matches, Match{Reason: reason, Mode: mode})
		}
	}
	for _, rule := range compiled.rules {
		if rule.matches(candidate) {
			matches = append(matches, Match{Reason: ReasonRule, Mode: rule.mode, RuleID: rule.id})
		}
	}
	return matches
}

// Drops reports whether any match asks for the event to be removed.
func Drops(matches []Match) bool {
	for _, match := range matches {
		if match.Mode == ModeEnforced {
			return true
		}
	}
	return false
}

func (rule compiledRule) matches(candidate event.CanonicalEvent) bool {
	switch rule.kind {
	case KindErrorMessage:
		if candidate.EventType != event.EventTypeError {
			return false
		}
		return rule.pattern.match(errorTitle(candidate))
	case KindErrorURL:
		if candidate.EventType != event.EventTypeError {
			return false
		}
		// Matched per frame so a pattern anchored with a trailing wildcard
		// behaves the way its author expects: against one location, not
		// against the whole multi-line stack.
		for _, frame := range strings.Split(candidate.ErrorStack, "\n") {
			if rule.pattern.match(strings.TrimSpace(frame)) {
				return true
			}
		}
		return false
	case KindPageURL:
		return rule.pattern.match(candidate.PageURLNormalized)
	case KindRelease:
		return rule.pattern.match(candidate.Release)
	default:
		return false
	}
}

// errorTitle renders the error the way the issue list does, so a rule can be
// written by copying what is on screen.
func errorTitle(candidate event.CanonicalEvent) string {
	if candidate.ErrorType == "" {
		return candidate.ErrorMessage
	}
	if candidate.ErrorMessage == "" {
		return candidate.ErrorType
	}
	return candidate.ErrorType + ": " + candidate.ErrorMessage
}
