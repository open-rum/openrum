package privacy

import (
	"sort"
	"strings"
)

// Limits on the HTTP header snapshot an API Request may carry. They bound what
// one event can add to a queue message and to a row; the protocol schema states
// the same numbers so a payload over them is refused at Ingest.
const (
	MaxHeaders           = 20
	MaxHeaderNameLength  = 64
	MaxHeaderValueLength = 256
)

// sensitiveHeaderFragments are matched against a header name with the same rules
// as attribute keys (case and separators ignored), so `X-Api-Key`, `x_api_key`
// and `XAPIKEY` are one name. The list is deliberately broad: a header that is
// wrongly refused costs a project one field, while one that is wrongly kept
// stores a credential for three days.
//
// Client address headers are included because an address is personal data and
// the product has no per-project consent to hold it.
var sensitiveHeaderFragments = []string{
	"auth", "cookie", "token", "secret", "password", "passwd", "apikey", "accesskey",
	"session", "csrf", "xsrf", "signature", "credential", "forwardedfor", "realip",
	"clientip", "email", "phone",
}

// SensitiveHeader reports whether a header can never be captured. It is not
// configurable, and the Console refuses to save a rule that names one.
func SensitiveHeader(name string) bool {
	for _, fragment := range sensitiveHeaderFragments {
		if KeyMatchesFragment(name, fragment) {
			return true
		}
	}
	return false
}

// ValidHeaderName reports whether a name is a lower-case HTTP token the product
// accepts. Stricter than RFC 9110 on purpose: names are used as map keys in
// ClickHouse and as labels in the Console.
func ValidHeaderName(name string) bool {
	if name == "" || len(name) > MaxHeaderNameLength {
		return false
	}
	for index := 0; index < len(name); index++ {
		character := name[index]
		switch {
		case character >= 'a' && character <= 'z', character >= '0' && character <= '9':
		case character == '-' && index > 0:
		default:
			return false
		}
	}
	return true
}

// ScrubHeaders makes a header snapshot safe to store. It lower-cases names,
// drops sensitive or malformed ones, redacts patterns in values and enforces the
// size limits. It reports whether anything was removed or rewritten.
func ScrubHeaders(headers map[string]string) (map[string]string, bool) {
	if len(headers) == 0 {
		return nil, false
	}
	names := make([]string, 0, len(headers))
	for name := range headers {
		names = append(names, name)
	}
	// Sorted so which headers survive the count limit does not depend on map order.
	sort.Strings(names)
	result := make(map[string]string, min(len(headers), MaxHeaders))
	changed := false
	for _, original := range names {
		name := strings.ToLower(strings.TrimSpace(original))
		if name != original {
			changed = true
		}
		if !ValidHeaderName(name) || SensitiveHeader(name) || len(result) >= MaxHeaders {
			changed = true
			continue
		}
		value, valueChanged := ScrubString(strings.TrimSpace(headers[original]), MaxHeaderValueLength)
		changed = changed || valueChanged
		result[name] = value
	}
	if len(result) == 0 {
		return nil, changed
	}
	return result, changed
}
