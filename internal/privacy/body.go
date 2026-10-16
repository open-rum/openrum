package privacy

import (
	"encoding/json"
	"io"
	"net/url"
	"regexp"
	"strings"
)

// Limits on an HTTP body snapshot. A stored body is for reading in the Console, not for
// replaying, so it is short, and a body too large to redact completely is not kept at all.
const (
	MaxBodyBytes = 4096
	// MaxBodyReadBytes is the largest body the browser reads. JSON has to be complete to be
	// redacted by key, so a larger body is omitted rather than cut and half-redacted.
	MaxBodyReadBytes = 64 * 1024
	// TruncatedMarker ends a body that was cut to MaxBodyBytes.
	TruncatedMarker = "…[truncated]"
	// OmittedBody stands in for a body larger than MaxBodyReadBytes.
	OmittedBody = "[omitted: body larger than 64 KB]"

	maxJSONDepth = 24
)

// sensitiveBodyFragments are matched against object keys and form field names with the same
// rules as header names (case and separators ignored). They are narrower than the header list
// in one respect: `auth` alone is absent, because it would redact `author`. The browser SDK
// keeps an identical list; both are tested against the same names.
var sensitiveBodyFragments = []string{
	"authorization", "cookie", "token", "secret", "password", "passwd", "passphrase", "apikey",
	"accesskey", "session", "csrf", "xsrf", "signature", "credential", "email", "phone",
	"creditcard", "cardnumber", "cvv", "ssn",
}

// SensitiveBodyKey reports whether the value under a key must not be stored.
func SensitiveBodyKey(key string) bool {
	for _, fragment := range sensitiveBodyFragments {
		if KeyMatchesFragment(key, fragment) {
			return true
		}
	}
	return false
}

var (
	// Fallbacks for text that is not complete JSON, such as a body cut by a client or one
	// forged to dodge the parser. They only see scalar values, which is why a body that parses
	// is redacted structurally instead.
	jsonPairPattern = regexp.MustCompile(`"([^"\\]{1,64})"\s*:\s*("(?:[^"\\]|\\.)*"|[^,}\]\s]+)`)
	formPattern     = regexp.MustCompile(`^[^\s=&{}\[\]<>]{1,64}=[^\s&]*(&[^\s=&{}\[\]<>]{1,64}=[^\s&]*)*$`)
)

// ScrubBody makes a body snapshot safe to store: sensitive keys lose their values, patterns
// such as emails and card numbers are redacted, and the result is cut to MaxBodyBytes. It is
// idempotent, so the Consumer can apply it to what the browser already scrubbed. It reports
// whether anything was removed, rewritten or cut.
func ScrubBody(body string) (string, bool) {
	if body == "" {
		return "", false
	}
	if body == OmittedBody {
		return body, false
	}
	changed := false
	text := strings.TrimSpace(strings.TrimSuffix(body, TruncatedMarker))
	wasCut := strings.HasSuffix(body, TruncatedMarker)
	if text != body && !wasCut {
		changed = true
	}
	switch {
	case strings.HasPrefix(text, "{") || strings.HasPrefix(text, "["):
		if rewritten, ok := redactJSON(text, &changed); ok {
			text = rewritten
		} else {
			text = scrubLooseText(text, &changed)
		}
	case formPattern.MatchString(text):
		text = redactForm(text, &changed)
	default:
		text = scrubLooseText(text, &changed)
	}
	return capBody(text, wasCut, &changed), changed
}

func capBody(text string, alreadyCut bool, changed *bool) string {
	if len(text) > MaxBodyBytes {
		text = truncateUTF8(text, MaxBodyBytes)
		alreadyCut = true
		*changed = true
	}
	if alreadyCut {
		return text + TruncatedMarker
	}
	return text
}

// scrubLooseText redacts what can be found without understanding the structure.
func scrubLooseText(text string, changed *bool) string {
	scrubbed, textChanged := ScrubString(text, -1)
	if textChanged {
		*changed = true
	}
	redacted := jsonPairPattern.ReplaceAllStringFunc(scrubbed, func(pair string) string {
		match := jsonPairPattern.FindStringSubmatch(pair)
		if len(match) < 3 || !SensitiveBodyKey(match[1]) || match[2] == `"`+Redacted+`"` {
			return pair
		}
		*changed = true
		return `"` + match[1] + `":"` + Redacted + `"`
	})
	return redacted
}

func redactForm(text string, changed *bool) string {
	fields := strings.Split(text, "&")
	for index, field := range fields {
		name, value, _ := strings.Cut(field, "=")
		decodedName, err := url.QueryUnescape(name)
		if err != nil {
			decodedName = name
		}
		if SensitiveBodyKey(decodedName) {
			if value != Redacted {
				*changed = true
			}
			fields[index] = name + "=" + url.QueryEscape(Redacted)
			continue
		}
		decodedValue, err := url.QueryUnescape(value)
		if err != nil {
			decodedValue = value
		}
		if scrubbed, valueChanged := ScrubString(decodedValue, -1); valueChanged {
			*changed = true
			fields[index] = name + "=" + url.QueryEscape(scrubbed)
		}
	}
	return strings.Join(fields, "&")
}

// redactJSON rewrites a complete JSON document, preserving key order and number text. It
// returns ok=false for anything that is not exactly one JSON value, so the caller can fall
// back. A document in which nothing was redacted comes back unchanged.
func redactJSON(text string, changed *bool) (string, bool) {
	decoder := json.NewDecoder(strings.NewReader(text))
	decoder.UseNumber()
	var out strings.Builder
	modified := false
	if !writeJSONValue(decoder, &out, &modified, 0) {
		return "", false
	}
	if _, err := decoder.Token(); err != io.EOF {
		return "", false
	}
	if !modified {
		return text, true
	}
	*changed = true
	return out.String(), true
}

func writeJSONValue(decoder *json.Decoder, out *strings.Builder, modified *bool, depth int) bool {
	if depth > maxJSONDepth {
		return false
	}
	token, err := decoder.Token()
	if err != nil {
		return false
	}
	switch value := token.(type) {
	case json.Delim:
		if value == '{' {
			out.WriteByte('{')
			first := true
			for decoder.More() {
				keyToken, err := decoder.Token()
				key, isString := keyToken.(string)
				if err != nil || !isString {
					return false
				}
				if !first {
					out.WriteByte(',')
				}
				first = false
				writeJSONString(out, key)
				out.WriteByte(':')
				if SensitiveBodyKey(key) {
					if !skipJSONValue(decoder, 0) {
						return false
					}
					writeJSONString(out, Redacted)
					*modified = true
					continue
				}
				if !writeJSONValue(decoder, out, modified, depth+1) {
					return false
				}
			}
			_, err := decoder.Token()
			out.WriteByte('}')
			return err == nil
		}
		out.WriteByte('[')
		first := true
		for decoder.More() {
			if !first {
				out.WriteByte(',')
			}
			first = false
			if !writeJSONValue(decoder, out, modified, depth+1) {
				return false
			}
		}
		_, err := decoder.Token()
		out.WriteByte(']')
		return err == nil
	case string:
		scrubbed, changed := ScrubString(value, -1)
		if changed {
			*modified = true
		}
		writeJSONString(out, scrubbed)
	case json.Number:
		out.WriteString(value.String())
	case bool:
		if value {
			out.WriteString("true")
		} else {
			out.WriteString("false")
		}
	case nil:
		out.WriteString("null")
	default:
		return false
	}
	return true
}

// skipJSONValue consumes one value without keeping it.
func skipJSONValue(decoder *json.Decoder, depth int) bool {
	if depth > maxJSONDepth {
		return false
	}
	token, err := decoder.Token()
	if err != nil {
		return false
	}
	delimiter, isDelimiter := token.(json.Delim)
	if !isDelimiter {
		return true
	}
	if delimiter == '{' {
		for decoder.More() {
			if _, err := decoder.Token(); err != nil || !skipJSONValue(decoder, depth+1) {
				return false
			}
		}
	} else {
		for decoder.More() {
			if !skipJSONValue(decoder, depth+1) {
				return false
			}
		}
	}
	_, err = decoder.Token()
	return err == nil
}

func writeJSONString(out *strings.Builder, value string) {
	// Encoder with HTML escaping off: a body shown in the Console should stay readable.
	var encoded strings.Builder
	encoder := json.NewEncoder(&encoded)
	encoder.SetEscapeHTML(false)
	_ = encoder.Encode(value)
	out.WriteString(strings.TrimSuffix(encoded.String(), "\n"))
}
