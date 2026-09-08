package privacy

import (
	"regexp"
	"sort"
	"strings"
	"unicode/utf8"
)

const Redacted = "[REDACTED]"

var (
	emailPattern  = regexp.MustCompile(`(?i)\b[a-z0-9.!#$%&'*+/=?^_` + "`" + `{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+\b`)
	bearerPattern = regexp.MustCompile(`(?i)\bBearer\s+[A-Za-z0-9._~+/=-]{8,}`)
	jwtPattern    = regexp.MustCompile(`\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b`)
	cardPattern   = regexp.MustCompile(`\b(?:\d[ -]*?){13,19}\b`)
)

func ScrubString(value string, maximum int) (string, bool) {
	changed := false
	if !utf8.ValidString(value) {
		value = strings.ToValidUTF8(value, "�")
		changed = true
	}
	replace := func(pattern *regexp.Regexp, input string, replacement string) string {
		result := pattern.ReplaceAllString(input, replacement)
		if result != input {
			changed = true
		}
		return result
	}
	value = replace(bearerPattern, value, "Bearer "+Redacted)
	value = replace(jwtPattern, value, Redacted)
	value = replace(emailPattern, value, "[REDACTED_EMAIL]")
	value = cardPattern.ReplaceAllStringFunc(value, func(candidate string) string {
		if luhnValid(candidate) {
			changed = true
			return "[REDACTED_CARD]"
		}
		return candidate
	})
	if maximum >= 0 && len(value) > maximum {
		value = truncateUTF8(value, maximum)
		changed = true
	}
	return value, changed
}

func ScrubIdentifier(value string, maximum int) (string, bool) {
	scrubbed, changed := ScrubString(value, maximum)
	if strings.Contains(scrubbed, "[REDACTED_") || strings.Contains(scrubbed, Redacted) {
		return "", true
	}
	return scrubbed, changed
}

func ScrubAttributes(attributes map[string]string, maximumProperties int) (map[string]string, bool) {
	if len(attributes) == 0 {
		return map[string]string{}, false
	}
	result := make(map[string]string, min(len(attributes), maximumProperties))
	changed := false
	keys := make([]string, 0, len(attributes))
	for key := range attributes {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, originalKey := range keys {
		key, value := originalKey, attributes[originalKey]
		if len(result) >= maximumProperties {
			changed = true
			break
		}
		key = strings.TrimSpace(key)
		if key == "" || sensitiveKey(key) {
			changed = true
			continue
		}
		if len(key) > 64 {
			key = truncateUTF8(key, 64)
			changed = true
		}
		scrubbed, valueChanged := ScrubString(value, 512)
		changed = changed || valueChanged
		result[key] = scrubbed
	}
	return result, changed
}

func truncateUTF8(value string, maximum int) string {
	if maximum <= 0 {
		return ""
	}
	if len(value) <= maximum {
		return value
	}
	end := maximum
	for end > 0 && !utf8.ValidString(value[:end]) {
		end--
	}
	return value[:end]
}

func sensitiveKey(key string) bool {
	for _, fragment := range []string{"authorization", "cookie", "password", "passwd", "secret", "token", "apikey", "accesskey", "creditcard", "cardnumber"} {
		if KeyMatchesFragment(key, fragment) {
			return true
		}
	}
	return false
}

// KeyMatchesFragment reports whether an attribute key contains a fragment,
// ignoring case and the punctuation that separates words in a key. It is
// exported so that a project adding its own sensitive names gets the same
// matching the built-in list uses: a name that behaved differently depending on
// who wrote it would be a trap, because the two lists are read as one.
func KeyMatchesFragment(key, fragment string) bool {
	normalized := normalizeKey(fragment)
	// A fragment made only of separators normalizes to nothing, and an empty
	// needle is contained in every key. Refused here rather than at validation
	// so that no caller can reach the state where one entry drops every
	// attribute the project sends.
	if normalized == "" {
		return false
	}
	return strings.Contains(normalizeKey(key), normalized)
}

func normalizeKey(value string) string {
	return strings.ToLower(strings.NewReplacer("-", "", "_", "", ".", "", " ", "").Replace(value))
}

func luhnValid(candidate string) bool {
	digits := make([]byte, 0, len(candidate))
	for index := range len(candidate) {
		if candidate[index] >= '0' && candidate[index] <= '9' {
			digits = append(digits, candidate[index]-'0')
		}
	}
	if len(digits) < 13 || len(digits) > 19 {
		return false
	}
	sum := 0
	parity := len(digits) % 2
	for index, digit := range digits {
		value := int(digit)
		if index%2 == parity {
			value *= 2
			if value > 9 {
				value -= 9
			}
		}
		sum += value
	}
	return sum%10 == 0
}
