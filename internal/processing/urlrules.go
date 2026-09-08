package processing

import (
	"errors"
	"fmt"
	"net/url"
	"strings"
)

// Target names which addresses a URL rule is applied to.
type Target string

const (
	// TargetPage rewrites the page address and the route.
	TargetPage Target = "page"
	// TargetAPI rewrites the address of an API request.
	TargetAPI Target = "api"
	// TargetBoth rewrites both. A single-page application usually serves its
	// API from the same path shape as its pages, so most rules want this.
	TargetBoth Target = "both"
)

// Limits chosen so that a project cannot turn rewriting into meaningful work
// per event, and so the stored document stays small.
const (
	MaxURLRules            = 50
	MaxURLPatternLength    = 200
	MaxURLPatternSegments  = 20
	MaxURLRuleIDLength     = 64
	MaxURLRuleNoteLength   = 200
	maxPlaceholderNameSize = 32
)

var (
	ErrInvalidURLRules = errors.New("invalid URL rules")

	urlTargets = []Target{TargetPage, TargetAPI, TargetBoth}
)

// Rule is one project-defined path template.
//
// The pattern is both the matcher and the result: a path that matches is
// stored as the pattern, verbatim. Writing the two separately would let them
// disagree, and the disagreement would only show up as an aggregation row
// nobody can trace back to a rule.
type Rule struct {
	ID      string `json:"id"`
	Target  Target `json:"target"`
	Pattern string `json:"pattern"`
	Note    string `json:"note,omitempty"`
}

// URLRules is a project's ordered list of path templates.
type URLRules struct {
	Rules []Rule `json:"rules,omitempty"`
}

// Targets lists the addresses a rule can apply to, in display order.
func Targets() []Target { return append([]Target(nil), urlTargets...) }

// Validate reports whether the rules can be stored and compiled.
func (rules URLRules) Validate() error {
	if len(rules.Rules) > MaxURLRules {
		return fmt.Errorf("%w: %d rules exceeds the limit of %d",
			ErrInvalidURLRules, len(rules.Rules), MaxURLRules)
	}
	seen := make(map[string]struct{}, len(rules.Rules))
	for _, rule := range rules.Rules {
		if err := rule.validate(); err != nil {
			return err
		}
		if _, duplicate := seen[rule.ID]; duplicate {
			return fmt.Errorf("%w: duplicate rule id %q", ErrInvalidURLRules, rule.ID)
		}
		seen[rule.ID] = struct{}{}
	}
	return nil
}

func (rule Rule) validate() error {
	switch {
	case rule.ID == "" || len(rule.ID) > MaxURLRuleIDLength:
		return fmt.Errorf("%w: rule id must be between 1 and %d characters",
			ErrInvalidURLRules, MaxURLRuleIDLength)
	case !knownTarget(rule.Target):
		return fmt.Errorf("%w: rule %q has unknown target %q", ErrInvalidURLRules, rule.ID, rule.Target)
	case len(rule.Pattern) > MaxURLPatternLength:
		return fmt.Errorf("%w: rule %q pattern exceeds %d characters",
			ErrInvalidURLRules, rule.ID, MaxURLPatternLength)
	case len(rule.Note) > MaxURLRuleNoteLength:
		return fmt.Errorf("%w: rule %q note exceeds %d characters",
			ErrInvalidURLRules, rule.ID, MaxURLRuleNoteLength)
	}
	_, err := compileTemplate(rule.ID, rule.Pattern)
	return err
}

// CompiledURLRules is the evaluation-ready form of a project's URL rules.
type CompiledURLRules struct {
	page []compiledTemplate
	api  []compiledTemplate
}

type compiledTemplate struct {
	// result is the pattern as written, which is what a match is stored as.
	result   string
	segments []templateSegment
	// tail is set when the pattern ends in `*`, in which case the segments
	// before it match a prefix and everything after it is absorbed.
	tail bool
}

type templateSegment struct {
	literal string
	// placeholder segments match exactly one segment of any content.
	placeholder bool
}

// Compile validates the rules and prepares them for evaluation.
func (rules URLRules) Compile() (*CompiledURLRules, error) {
	if err := rules.Validate(); err != nil {
		return nil, err
	}
	compiled := &CompiledURLRules{}
	for _, rule := range rules.Rules {
		template, err := compileTemplate(rule.ID, rule.Pattern)
		if err != nil {
			return nil, err
		}
		if rule.Target == TargetPage || rule.Target == TargetBoth {
			compiled.page = append(compiled.page, template)
		}
		if rule.Target == TargetAPI || rule.Target == TargetBoth {
			compiled.api = append(compiled.api, template)
		}
	}
	return compiled, nil
}

// Active reports whether any rule is configured.
func (compiled *CompiledURLRules) Active() bool {
	return compiled != nil && (len(compiled.page) > 0 || len(compiled.api) > 0)
}

// ApplyToURL rewrites the path of an absolute URL and reports whether a rule
// matched. Only the path is considered: the same shape is usually served by
// several hosts — a CDN, a staging domain, a regional endpoint — and a rule
// that had to name one of them would silently stop applying the day another
// appeared.
func (compiled *CompiledURLRules) ApplyToURL(target Target, raw string) (string, bool) {
	if !compiled.Active() || raw == "" {
		return raw, false
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return raw, false
	}
	rewritten, matched := compiled.ApplyToPath(target, parsed.Path)
	if !matched {
		return raw, false
	}
	parsed.Path = rewritten
	parsed.RawPath = ""
	return parsed.String(), true
}

// ApplyToPath rewrites a path and reports whether a rule matched.
//
// The first matching rule wins, so the stored order is the precedence order and
// an operator can put a specific template above a broader one. Trying every
// rule and preferring the most specific match would be one fewer thing to
// explain, but it would also mean that adding an unrelated rule could change
// how an existing path aggregates.
func (compiled *CompiledURLRules) ApplyToPath(target Target, path string) (string, bool) {
	if !compiled.Active() || path == "" {
		return path, false
	}
	for _, template := range compiled.templates(target) {
		if template.match(path) {
			return template.result, true
		}
	}
	return path, false
}

func (compiled *CompiledURLRules) templates(target Target) []compiledTemplate {
	switch target {
	case TargetPage:
		return compiled.page
	case TargetAPI:
		return compiled.api
	default:
		return nil
	}
}

// compileTemplate parses a pattern into segments, reporting the same errors
// validation reports so that a stored document can never fail to compile.
func compileTemplate(ruleID, pattern string) (compiledTemplate, error) {
	if !strings.HasPrefix(pattern, "/") {
		return compiledTemplate{}, fmt.Errorf("%w: rule %q pattern must start with /", ErrInvalidURLRules, ruleID)
	}
	raw := strings.Split(pattern, "/")
	if len(raw) > MaxURLPatternSegments {
		return compiledTemplate{}, fmt.Errorf("%w: rule %q has more than %d path segments",
			ErrInvalidURLRules, ruleID, MaxURLPatternSegments)
	}
	template := compiledTemplate{result: pattern}
	for index, segment := range raw {
		switch {
		case segment == "*":
			if index != len(raw)-1 {
				return compiledTemplate{}, fmt.Errorf("%w: rule %q may only use * as the last segment",
					ErrInvalidURLRules, ruleID)
			}
			template.tail = true
		case strings.HasPrefix(segment, ":"):
			name := segment[1:]
			if !validPlaceholderName(name) {
				return compiledTemplate{}, fmt.Errorf(
					"%w: rule %q placeholder %q must be a letter followed by up to %d letters, digits or underscores",
					ErrInvalidURLRules, ruleID, segment, maxPlaceholderNameSize-1)
			}
			template.segments = append(template.segments, templateSegment{placeholder: true})
		case strings.ContainsAny(segment, "*?#"):
			return compiledTemplate{}, fmt.Errorf("%w: rule %q segment %q contains an unsupported character",
				ErrInvalidURLRules, ruleID, segment)
		default:
			// Lowercased once here rather than on every event. Matching is
			// case-insensitive because the same path reaches the console in
			// whatever case a link happened to use, and two rows that differ
			// only in case are exactly what these rules exist to merge.
			template.segments = append(template.segments, templateSegment{literal: strings.ToLower(segment)})
		}
	}
	if len(template.segments) == 0 && !template.tail {
		return compiledTemplate{}, fmt.Errorf("%w: rule %q needs a pattern", ErrInvalidURLRules, ruleID)
	}
	return template, nil
}

func (template compiledTemplate) match(path string) bool {
	segments := strings.Split(path, "/")
	if template.tail {
		// Strictly longer, so `/assets/*` describes what is below `/assets`
		// and leaves `/assets` itself as its own row.
		if len(segments) <= len(template.segments) {
			return false
		}
		segments = segments[:len(template.segments)]
	} else if len(segments) != len(template.segments) {
		return false
	}
	for index, expected := range template.segments {
		actual := segments[index]
		if expected.placeholder {
			// A placeholder must consume something. An empty segment means a
			// double slash or a trailing slash, and treating those as an
			// identifier would merge `/orders/` into `/orders/:id`.
			if actual == "" {
				return false
			}
			continue
		}
		if !strings.EqualFold(actual, expected.literal) {
			return false
		}
	}
	return true
}

func validPlaceholderName(name string) bool {
	if name == "" || len(name) >= maxPlaceholderNameSize {
		return false
	}
	for index := range len(name) {
		character := name[index]
		switch {
		case character >= 'a' && character <= 'z', character >= 'A' && character <= 'Z':
		case index > 0 && (character >= '0' && character <= '9' || character == '_'):
		default:
			return false
		}
	}
	return true
}

func knownTarget(candidate Target) bool {
	for _, target := range urlTargets {
		if target == candidate {
			return true
		}
	}
	return false
}
