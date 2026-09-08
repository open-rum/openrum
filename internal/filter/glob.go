package filter

import "strings"

// glob matches a string against a pattern whose only metacharacter is `*`.
//
// Regular expressions are deliberately not offered. The same pattern has to run
// here and in the browser SDK, and those engines are not equivalent: Go's
// regexp is RE2, which runs in linear time but rejects backreferences and
// lookahead, while the browser's RegExp accepts both and backtracks, so a
// pattern authored in one place can either fail to compile or hang a phone in
// the other. A single wildcard has one meaning everywhere.
//
// Matching is case-insensitive, because the values these patterns are written
// against — URLs, browser error messages — vary in case for reasons the author
// of a rule has no way to predict.
type glob struct {
	// segments holds the literal parts between wildcards. A pattern with no
	// wildcard has exactly one segment and is compared for equality.
	segments []string
	wildcard bool
}

func compileGlob(pattern string) glob {
	segments := strings.Split(strings.ToLower(pattern), "*")
	return glob{segments: segments, wildcard: len(segments) > 1}
}

func (pattern glob) match(value string) bool {
	if len(pattern.segments) == 0 {
		return false
	}
	value = strings.ToLower(value)
	if !pattern.wildcard {
		return value == pattern.segments[0]
	}
	// The first and last segments are anchored; everything between them only
	// has to appear in order.
	leading, trailing := pattern.segments[0], pattern.segments[len(pattern.segments)-1]
	if !strings.HasPrefix(value, leading) {
		return false
	}
	rest := value[len(leading):]
	for _, middle := range pattern.segments[1 : len(pattern.segments)-1] {
		index := strings.Index(rest, middle)
		if index < 0 {
			return false
		}
		rest = rest[index+len(middle):]
	}
	// Checked against the remainder rather than the whole value so that a
	// pattern like `a*a` does not match a lone "a" by reusing one character.
	return strings.HasSuffix(rest, trailing)
}
