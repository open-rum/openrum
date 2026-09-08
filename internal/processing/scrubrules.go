package processing

import (
	"errors"
	"fmt"
	"regexp"
	"strings"

	"openrum/internal/privacy"
)

// Limits chosen so that a project cannot turn redaction into meaningful work
// per event, and so the stored document stays small.
const (
	MaxScrubPatterns        = 25
	MaxScrubExpressionSize  = 200
	MaxScrubPatternIDLength = 64
	MaxScrubNoteLength      = 200
	MaxSensitiveKeys        = 50
	MaxSensitiveKeyLength   = 64
)

var ErrInvalidScrubRules = errors.New("invalid scrub rules")

// ScrubPattern is one project-defined expression whose matches are replaced
// before the event is stored.
type ScrubPattern struct {
	ID string `json:"id"`
	// Expression is a Go regular expression. Unlike an inbound filter pattern,
	// this one never runs in a browser, so the restriction to a single
	// wildcard that keeps the two engines equivalent does not apply here. RE2
	// has no backtracking, so a pattern cannot be written that hangs the
	// consumer the way a catastrophic JavaScript RegExp could.
	Expression string `json:"expression"`
	Note       string `json:"note,omitempty"`
}

// ScrubRules is what a project adds to the built-in redaction. Nothing here can
// switch a built-in pattern off: the floor those patterns set is what the SDK's
// privacy promise rests on, and a project-level exception to it would move the
// promise somewhere a reader of the SDK documentation cannot see.
type ScrubRules struct {
	Patterns []ScrubPattern `json:"patterns,omitempty"`
	// SensitiveKeys names attribute and breadcrumb keys to drop. Each is
	// matched the way the built-in list is: punctuation and case are ignored,
	// and the name matches if it appears anywhere in the key, so `ssn` also
	// covers `user_SSN` and `ssn-last4`.
	SensitiveKeys []string `json:"sensitiveKeys,omitempty"`
}

// Validate reports whether the rules can be stored and compiled.
func (rules ScrubRules) Validate() error {
	if len(rules.Patterns) > MaxScrubPatterns {
		return fmt.Errorf("%w: %d patterns exceeds the limit of %d",
			ErrInvalidScrubRules, len(rules.Patterns), MaxScrubPatterns)
	}
	if len(rules.SensitiveKeys) > MaxSensitiveKeys {
		return fmt.Errorf("%w: %d sensitive keys exceeds the limit of %d",
			ErrInvalidScrubRules, len(rules.SensitiveKeys), MaxSensitiveKeys)
	}
	seen := make(map[string]struct{}, len(rules.Patterns))
	for _, pattern := range rules.Patterns {
		if err := pattern.validate(); err != nil {
			return err
		}
		if _, duplicate := seen[pattern.ID]; duplicate {
			return fmt.Errorf("%w: duplicate pattern id %q", ErrInvalidScrubRules, pattern.ID)
		}
		seen[pattern.ID] = struct{}{}
	}
	for _, key := range rules.SensitiveKeys {
		if strings.TrimSpace(key) == "" || len(key) > MaxSensitiveKeyLength {
			return fmt.Errorf("%w: sensitive key must be between 1 and %d characters",
				ErrInvalidScrubRules, MaxSensitiveKeyLength)
		}
	}
	return nil
}

func (pattern ScrubPattern) validate() error {
	switch {
	case pattern.ID == "" || len(pattern.ID) > MaxScrubPatternIDLength:
		return fmt.Errorf("%w: pattern id must be between 1 and %d characters",
			ErrInvalidScrubRules, MaxScrubPatternIDLength)
	case strings.TrimSpace(pattern.Expression) == "":
		return fmt.Errorf("%w: pattern %q needs an expression", ErrInvalidScrubRules, pattern.ID)
	case len(pattern.Expression) > MaxScrubExpressionSize:
		return fmt.Errorf("%w: pattern %q expression exceeds %d characters",
			ErrInvalidScrubRules, pattern.ID, MaxScrubExpressionSize)
	case len(pattern.Note) > MaxScrubNoteLength:
		return fmt.Errorf("%w: pattern %q note exceeds %d characters",
			ErrInvalidScrubRules, pattern.ID, MaxScrubNoteLength)
	}
	compiled, err := regexp.Compile(pattern.Expression)
	if err != nil {
		return fmt.Errorf("%w: pattern %q does not compile: %s", ErrInvalidScrubRules, pattern.ID, err)
	}
	// An expression that matches the empty string would replace between every
	// character of every value, turning any string into a wall of markers. It
	// is always a mistake rather than an intent, so it is refused at the point
	// somebody can still see what they typed.
	if compiled.MatchString("") {
		return fmt.Errorf("%w: pattern %q matches the empty string", ErrInvalidScrubRules, pattern.ID)
	}
	return nil
}

// CompiledScrubRules is the evaluation-ready form of a project's scrub rules.
type CompiledScrubRules struct {
	patterns []*regexp.Regexp
	keys     []string
}

// Compile validates the rules and prepares them for evaluation.
func (rules ScrubRules) Compile() (*CompiledScrubRules, error) {
	if err := rules.Validate(); err != nil {
		return nil, err
	}
	compiled := &CompiledScrubRules{}
	for _, pattern := range rules.Patterns {
		expression, err := regexp.Compile(pattern.Expression)
		if err != nil {
			return nil, fmt.Errorf("%w: pattern %q does not compile: %s",
				ErrInvalidScrubRules, pattern.ID, err)
		}
		compiled.patterns = append(compiled.patterns, expression)
	}
	for _, key := range rules.SensitiveKeys {
		compiled.keys = append(compiled.keys, strings.TrimSpace(key))
	}
	return compiled, nil
}

// Active reports whether any rule is configured.
func (compiled *CompiledScrubRules) Active() bool {
	return compiled != nil && (len(compiled.patterns) > 0 || len(compiled.keys) > 0)
}

// String replaces every match with the standard redaction marker and reports
// whether anything changed.
func (compiled *CompiledScrubRules) String(value string) (string, bool) {
	if !compiled.Active() || value == "" {
		return value, false
	}
	changed := false
	for _, pattern := range compiled.patterns {
		replaced := pattern.ReplaceAllString(value, privacy.Redacted)
		if replaced != value {
			changed = true
			value = replaced
		}
	}
	return value, changed
}

// SensitiveKey reports whether an attribute or breadcrumb key names something
// the project asked to have dropped.
func (compiled *CompiledScrubRules) SensitiveKey(key string) bool {
	if compiled == nil || len(compiled.keys) == 0 {
		return false
	}
	for _, candidate := range compiled.keys {
		if privacy.KeyMatchesFragment(key, candidate) {
			return true
		}
	}
	return false
}

// Attributes drops the keys the project named and redacts the values that
// remain. An identifier that is dropped is removed rather than replaced with a
// marker, matching what the built-in list does: a key that should not have been
// sent is not evidence worth keeping a row for.
func (compiled *CompiledScrubRules) Attributes(attributes map[string]string) (map[string]string, bool) {
	if !compiled.Active() || len(attributes) == 0 {
		return attributes, false
	}
	changed := false
	result := make(map[string]string, len(attributes))
	for key, value := range attributes {
		if compiled.SensitiveKey(key) {
			changed = true
			continue
		}
		scrubbed, valueChanged := compiled.String(value)
		changed = changed || valueChanged
		result[key] = scrubbed
	}
	if !changed {
		return attributes, false
	}
	return result, true
}
