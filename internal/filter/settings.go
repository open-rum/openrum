package filter

import (
	"errors"
	"fmt"
	"strings"
)

// Mode says what a project wants done with the events a category matches.
//
// The three states exist so a rule can be measured before it removes anything.
// Going straight from off to enforced would mean discovering the blast radius
// of a rule only after the data it would have kept is already gone.
type Mode string

const (
	// ModeOff ignores the category entirely and produces no match.
	ModeOff Mode = "off"
	// ModeDryRun counts matches but keeps the events.
	ModeDryRun Mode = "dry_run"
	// ModeEnforced drops the matching events before they are stored.
	ModeEnforced Mode = "enforced"
)

// Kind names the field a custom rule is matched against.
type Kind string

const (
	// KindErrorMessage matches the error type and message together, in the
	// form the issue list shows them.
	KindErrorMessage Kind = "error_message"
	// KindErrorURL matches any single frame of the stack.
	KindErrorURL Kind = "error_url"
	// KindPageURL matches the normalized page address.
	KindPageURL Kind = "page_url"
	// KindRelease matches the release identifier.
	KindRelease Kind = "release"
)

// ReasonRule is the metric label used for every custom rule. Rules are not
// labelled individually, because the label set would then grow with whatever
// the projects create.
const ReasonRule Reason = "rule"

// Limits chosen so that a project cannot turn rule evaluation into meaningful
// work per event, and so the stored document stays small.
const (
	MaxRules          = 50
	MaxPatternLength  = 200
	MaxWildcards      = 10
	MaxRuleIDLength   = 64
	MaxRuleNoteLength = 200
)

var (
	ErrInvalidSettings = errors.New("invalid inbound filter settings")

	builtinReasons = []Reason{ReasonBot, ReasonExtension, ReasonLocalhost}
	ruleKinds      = []Kind{KindErrorMessage, KindErrorURL, KindPageURL, KindRelease}
	modes          = []Mode{ModeOff, ModeDryRun, ModeEnforced}
)

// Rule is one project-defined pattern.
type Rule struct {
	ID      string `json:"id"`
	Kind    Kind   `json:"kind"`
	Pattern string `json:"pattern"`
	Mode    Mode   `json:"mode"`
	Note    string `json:"note,omitempty"`
}

// Settings is the stored form of a project's inbound filtering preferences. It
// is persisted as one JSON document so it travels with the existing SDK config
// version rather than needing a version of its own.
type Settings struct {
	Builtin map[Reason]Mode `json:"builtin,omitempty"`
	Rules   []Rule          `json:"rules,omitempty"`
}

// BuiltinReasons lists the categories a project can switch on, in display
// order. Callers use it instead of ranging over a map so that the order an
// operator sees does not change between requests.
func BuiltinReasons() []Reason { return append([]Reason(nil), builtinReasons...) }

// RuleKinds lists the fields a custom rule can match against.
func RuleKinds() []Kind { return append([]Kind(nil), ruleKinds...) }

// ModeOf reports the mode configured for a built-in category, defaulting to
// off. Filtering is never enabled implicitly: a project that has never been
// configured behaves exactly as it did before the feature existed.
func (settings Settings) ModeOf(reason Reason) Mode {
	if settings.Builtin == nil {
		return ModeOff
	}
	if mode, ok := settings.Builtin[reason]; ok && mode != "" {
		return mode
	}
	return ModeOff
}

// ClientEnforced projects the settings down to what a browser should act on.
//
// Two things are removed. Anything still measuring is dropped, because a client
// that discarded a dry-run match would stop the event from ever reaching the
// counter that the measurement depends on — the mode would report zero and look
// like the rule matched nothing. The bot category is dropped because deciding
// it needs the same user-agent parsing the server does, and a second
// implementation in the browser would drift from the first.
//
// What remains is an optimisation only: the consumer applies the full settings
// regardless, so an outdated or ignored client costs bandwidth, not accuracy.
func (settings Settings) ClientEnforced() Settings {
	projected := Settings{}
	for _, reason := range builtinReasons {
		if reason == ReasonBot {
			continue
		}
		if settings.ModeOf(reason) == ModeEnforced {
			if projected.Builtin == nil {
				projected.Builtin = map[Reason]Mode{}
			}
			projected.Builtin[reason] = ModeEnforced
		}
	}
	for _, rule := range settings.Rules {
		if rule.Mode != ModeEnforced || !reproducibleInBrowser(rule.Kind) {
			continue
		}
		projected.Rules = append(projected.Rules, rule)
	}
	return projected
}

// reproducibleInBrowser reports whether a browser sees the same input the
// consumer matches against.
//
// Page URL rules do not qualify. The consumer matches the normalized address,
// whose path has had identifier-looking segments replaced, so `/orders/12345`
// is matched as `/orders/:id`. A browser holds the original. Reproducing the
// substitution client-side would mean maintaining the same heuristics twice,
// and the moment they disagreed the client would discard events the server
// would have kept — a silent, one-directional data loss. Leaving these to the
// consumer costs one upload.
func reproducibleInBrowser(kind Kind) bool {
	return kind == KindErrorMessage || kind == KindErrorURL || kind == KindRelease
}

// Validate reports whether the settings can be stored and compiled.
func (settings Settings) Validate() error {
	for reason, mode := range settings.Builtin {
		if !knownReason(reason) {
			return fmt.Errorf("%w: unknown category %q", ErrInvalidSettings, reason)
		}
		if !knownMode(mode) {
			return fmt.Errorf("%w: category %q has unknown mode %q", ErrInvalidSettings, reason, mode)
		}
	}
	if len(settings.Rules) > MaxRules {
		return fmt.Errorf("%w: %d rules exceeds the limit of %d", ErrInvalidSettings, len(settings.Rules), MaxRules)
	}
	seen := make(map[string]struct{}, len(settings.Rules))
	for _, rule := range settings.Rules {
		if err := rule.validate(); err != nil {
			return err
		}
		if _, duplicate := seen[rule.ID]; duplicate {
			return fmt.Errorf("%w: duplicate rule id %q", ErrInvalidSettings, rule.ID)
		}
		seen[rule.ID] = struct{}{}
	}
	return nil
}

func (rule Rule) validate() error {
	switch {
	case rule.ID == "" || len(rule.ID) > MaxRuleIDLength:
		return fmt.Errorf("%w: rule id must be between 1 and %d characters", ErrInvalidSettings, MaxRuleIDLength)
	case !knownKind(rule.Kind):
		return fmt.Errorf("%w: rule %q has unknown kind %q", ErrInvalidSettings, rule.ID, rule.Kind)
	case !knownMode(rule.Mode):
		return fmt.Errorf("%w: rule %q has unknown mode %q", ErrInvalidSettings, rule.ID, rule.Mode)
	case strings.TrimSpace(rule.Pattern) == "":
		return fmt.Errorf("%w: rule %q needs a pattern", ErrInvalidSettings, rule.ID)
	case len(rule.Pattern) > MaxPatternLength:
		return fmt.Errorf("%w: rule %q pattern exceeds %d characters", ErrInvalidSettings, rule.ID, MaxPatternLength)
	case strings.Count(rule.Pattern, "*") > MaxWildcards:
		return fmt.Errorf("%w: rule %q uses more than %d wildcards", ErrInvalidSettings, rule.ID, MaxWildcards)
	case len(rule.Note) > MaxRuleNoteLength:
		return fmt.Errorf("%w: rule %q note exceeds %d characters", ErrInvalidSettings, rule.ID, MaxRuleNoteLength)
	}
	return nil
}

func knownReason(candidate Reason) bool {
	for _, reason := range builtinReasons {
		if reason == candidate {
			return true
		}
	}
	return false
}

func knownKind(candidate Kind) bool {
	for _, kind := range ruleKinds {
		if kind == candidate {
			return true
		}
	}
	return false
}

func knownMode(candidate Mode) bool {
	for _, mode := range modes {
		if mode == candidate {
			return true
		}
	}
	return false
}
