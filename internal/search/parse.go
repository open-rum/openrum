// Package search reads the Console's shared search language and turns it into ClickHouse
// conditions. The language is deliberately small and AND-only, so every condition can still be
// shown as one removable token:
//
//	route:/checkout          equals
//	!route:/checkout         does not equal
//	browser:[Chrome,Safari]  is one of (negate with a leading !)
//	route:*checkout*         contains; route:/api/* starts with; route:*.js ends with
//	has:trace_id             has a value (negate with a leading !); trace_id:* means the same
//	status:>=500             compares a number; duration:>2s compares a duration
//	timeout                  a bare word: the page's own free-text search
//	a AND b                  AND may be written between conditions; it changes nothing
//
// Values may be quoted. Field names, SQL expressions and operators come only from the page's
// Schema; user text is always a bound parameter.
package search

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

const (
	// MaxTerms and MaxLength bound one search, as the logs grammar always has.
	MaxTerms  = 12
	MaxLength = 1024
	// MaxListValues bounds key:[a,b,...].
	MaxListValues = 20
)

// ErrInvalid is wrapped by every parse and compile error, so callers can map them to one 400.
var ErrInvalid = errors.New("invalid search")

// Error says what is wrong and where, so the Console can point at it.
type Error struct {
	Code     string
	Position int
	Term     string
}

func (err *Error) Error() string {
	if err.Term == "" {
		return fmt.Sprintf("search %s", strings.ReplaceAll(err.Code, "_", " "))
	}
	return fmt.Sprintf("search %s at %d: %q", strings.ReplaceAll(err.Code, "_", " "), err.Position, err.Term)
}

func (err *Error) Unwrap() error { return ErrInvalid }

// Error codes the Console translates.
const (
	CodeTooLong          = "too_long"
	CodeTooManyTerms     = "too_many_terms"
	CodeUnterminated     = "unterminated_quote"
	CodeBooleanKeyword   = "boolean_keyword"
	CodeEmptyValue       = "empty_value"
	CodeWildcardPosition = "wildcard_position"
	CodeTooManyValues    = "too_many_values"
	CodeUnknownField     = "unknown_field"
	CodeUnsupported      = "unsupported_operator"
	CodeInvalidValue     = "invalid_value"
	CodeNoFreeText       = "free_text_unsupported"
	CodeInvalidControl   = "invalid_character"
)

// Operator is what a term asks of its field.
type Operator string

const (
	OpEquals   Operator = "eq"
	OpIn       Operator = "in"
	OpContains Operator = "contains"
	OpPrefix   Operator = "prefix"
	OpSuffix   Operator = "suffix"
	OpHas      Operator = "has"
	OpGT       Operator = "gt"
	OpGTE      Operator = "gte"
	OpLT       Operator = "lt"
	OpLTE      Operator = "lte"
)

// Term is one condition. Field is empty for free text.
type Term struct {
	Field    string
	Negated  bool
	Operator Operator
	Values   []string
	Position int
	Raw      string
}

var fieldPattern = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_.-]{0,79}$`)

type token struct {
	text     string
	position int
}

// Parse reads a search. An empty search is no terms.
func Parse(input string) ([]Term, error) {
	if len(input) > MaxLength {
		return nil, &Error{Code: CodeTooLong}
	}
	if !utf8.ValidString(input) || strings.ContainsAny(input, "\x00") {
		return nil, &Error{Code: CodeInvalidControl}
	}
	all, err := split(input)
	if err != nil {
		return nil, err
	}
	// Conditions always all apply, so a written AND is only punctuation. The Console writes one
	// between conditions it adds, to make the query read the way it behaves.
	tokens := all[:0]
	for _, current := range all {
		if current.text != "AND" {
			tokens = append(tokens, current)
		}
	}
	if len(tokens) > MaxTerms {
		return nil, &Error{Code: CodeTooManyTerms}
	}
	terms := make([]Term, 0, len(tokens))
	for _, current := range tokens {
		term, err := parseTerm(current)
		if err != nil {
			return nil, err
		}
		terms = append(terms, term)
	}
	return terms, nil
}

// split breaks the input on whitespace outside quotes and brackets. Quotes are kept, so a
// quoted wildcard can be told apart from a real one.
func split(input string) ([]token, error) {
	var tokens []token
	var current strings.Builder
	start, quoted, escaped, depth := 0, false, false, 0
	flush := func() {
		if current.Len() > 0 {
			tokens = append(tokens, token{text: current.String(), position: start})
			current.Reset()
		}
	}
	for index, r := range input {
		if current.Len() == 0 && !unicode.IsSpace(r) {
			start = index
		}
		switch {
		case escaped:
			escaped = false
		case r == '\\':
			escaped = true
		case r == '"':
			quoted = !quoted
		case !quoted && r == '[':
			depth++
		case !quoted && r == ']' && depth > 0:
			depth--
		case !quoted && depth == 0 && unicode.IsSpace(r):
			flush()
			continue
		}
		current.WriteRune(r)
	}
	if quoted || escaped {
		return nil, &Error{Code: CodeUnterminated, Position: start, Term: current.String()}
	}
	flush()
	return tokens, nil
}

func parseTerm(current token) (Term, error) {
	raw := current.text
	term := Term{Position: current.position, Raw: raw}
	fail := func(code string) (Term, error) {
		return Term{}, &Error{Code: code, Position: current.position, Term: raw}
	}
	if raw == "OR" || raw == "NOT" {
		return fail(CodeBooleanKeyword)
	}
	body := raw
	if strings.HasPrefix(body, "!") && len(body) > 1 {
		term.Negated = true
		body = body[1:]
	}
	if name, ok := strings.CutPrefix(body, "has:"); ok {
		if !fieldPattern.MatchString(name) {
			return fail(CodeUnknownField)
		}
		term.Field, term.Operator = name, OpHas
		return term, nil
	}
	key, rest, isField := cutUnquoted(body, ':')
	// "https://..." is a URL to look for, not a field named https.
	if !isField || !fieldPattern.MatchString(key) || strings.HasPrefix(rest, "//") {
		// A bare word, or something like a URL whose "scheme" is not a field name.
		value, _, err := unquote(body)
		if err != nil {
			return fail(CodeUnterminated)
		}
		if value == "" {
			return fail(CodeEmptyValue)
		}
		term.Operator, term.Values = OpContains, []string{value}
		return term, nil
	}
	term.Field = key
	if rest == "" {
		return fail(CodeEmptyValue)
	}
	if strings.HasPrefix(rest, "[") {
		if !strings.HasSuffix(rest, "]") {
			return fail(CodeInvalidValue)
		}
		values, err := splitList(rest[1 : len(rest)-1])
		if err != nil {
			return fail(CodeInvalidValue)
		}
		if len(values) == 0 {
			return fail(CodeEmptyValue)
		}
		if len(values) > MaxListValues {
			return fail(CodeTooManyValues)
		}
		term.Operator, term.Values = OpIn, values
		return term, nil
	}
	for _, comparison := range []struct {
		prefix   string
		operator Operator
	}{{">=", OpGTE}, {"<=", OpLTE}, {">", OpGT}, {"<", OpLT}} {
		if value, ok := strings.CutPrefix(rest, comparison.prefix); ok {
			if value == "" {
				return fail(CodeEmptyValue)
			}
			term.Operator, term.Values = comparison.operator, []string{value}
			return term, nil
		}
	}
	value, quotedWhole, err := unquote(rest)
	if err != nil {
		return fail(CodeUnterminated)
	}
	if value == "" {
		return fail(CodeEmptyValue)
	}
	if quotedWhole {
		term.Operator, term.Values = OpEquals, []string{value}
		return term, nil
	}
	if value == "*" {
		term.Operator = OpHas
		return term, nil
	}
	leading, trailing := strings.HasPrefix(value, "*"), strings.HasSuffix(value, "*")
	inner := strings.TrimSuffix(strings.TrimPrefix(value, "*"), "*")
	if strings.Contains(inner, "*") || inner == "" {
		return fail(CodeWildcardPosition)
	}
	switch {
	case leading && trailing:
		term.Operator = OpContains
	case leading:
		term.Operator = OpSuffix
	case trailing:
		term.Operator = OpPrefix
	default:
		term.Operator = OpEquals
	}
	term.Values = []string{inner}
	return term, nil
}

// cutUnquoted splits at the first separator outside quotes.
func cutUnquoted(value string, separator rune) (string, string, bool) {
	quoted := false
	for index, r := range value {
		if r == '"' {
			quoted = !quoted
		}
		if r == separator && !quoted {
			return value[:index], value[index+1:], true
		}
	}
	return value, "", false
}

func splitList(value string) ([]string, error) {
	var values []string
	var current strings.Builder
	quoted := false
	add := func() error {
		item, _, err := unquote(strings.TrimSpace(current.String()))
		current.Reset()
		if err != nil {
			return err
		}
		if item == "" {
			return ErrInvalid
		}
		values = append(values, item)
		return nil
	}
	for _, r := range value {
		if r == '"' {
			quoted = !quoted
		}
		if r == ',' && !quoted {
			if err := add(); err != nil {
				return nil, err
			}
			continue
		}
		current.WriteRune(r)
	}
	if strings.TrimSpace(current.String()) != "" || len(values) > 0 {
		if err := add(); err != nil {
			return nil, err
		}
	}
	return values, nil
}

// unquote removes quotes and resolves escapes. quotedWhole is true when the whole value was
// one quoted string, which makes a * inside it literal.
func unquote(value string) (string, bool, error) {
	var result strings.Builder
	quoted, escaped, sawQuote := false, false, false
	for _, r := range value {
		if escaped {
			switch r {
			case 'n':
				result.WriteRune('\n')
			case 'r':
				result.WriteRune('\r')
			case 't':
				result.WriteRune('\t')
			default:
				result.WriteRune(r)
			}
			escaped = false
			continue
		}
		switch r {
		case '\\':
			escaped = true
		case '"':
			quoted, sawQuote = !quoted, true
		default:
			result.WriteRune(r)
		}
	}
	if quoted || escaped {
		return "", false, ErrInvalid
	}
	quotedWhole := sawQuote && strings.HasPrefix(value, `"`) && strings.HasSuffix(value, `"`) && strings.Count(value, `"`)-strings.Count(value, `\"`) == 2
	return result.String(), quotedWhole, nil
}
