package fingerprint

import (
	"net/url"
	"regexp"
	"strings"
)

var (
	uuidPattern       = regexp.MustCompile(`(?i)\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b`)
	hexPattern        = regexp.MustCompile(`(?i)\b(?:0x)?[0-9a-f]{12,}\b`)
	numberPattern     = regexp.MustCompile(`\b\d+(?:\.\d+)?\b`)
	quotedPattern     = regexp.MustCompile(`(?:"[^"\r\n]{1,256}"|'[^'\r\n]{1,256}')`)
	spacePattern      = regexp.MustCompile(`\s+`)
	frameLocation     = regexp.MustCompile(`((?:(?:https?|file|webpack)://|/)[^\s)]+):(\d+):(\d+)`)
	bundleHashPattern = regexp.MustCompile(`(?i)([._-])[0-9a-f]{8,}([._-])`)
)

func NormalizeMessage(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	value = quotedPattern.ReplaceAllString(value, "<string>")
	value = uuidPattern.ReplaceAllString(value, "<uuid>")
	value = hexPattern.ReplaceAllString(value, "<hex>")
	value = numberPattern.ReplaceAllString(value, "<number>")
	return spacePattern.ReplaceAllString(value, " ")
}

func ParseInAppFrames(stack string, maximum int) []string {
	if maximum <= 0 {
		return nil
	}
	lines := strings.Split(stack, "\n")
	frames := make([]string, 0, min(maximum, len(lines)))
	for _, line := range lines {
		lower := strings.ToLower(line)
		if strings.Contains(lower, "node_modules/") || strings.Contains(lower, "chrome-extension://") ||
			strings.Contains(lower, "moz-extension://") || strings.Contains(lower, "<anonymous>") ||
			strings.Contains(lower, "[native code]") {
			continue
		}
		match := frameLocation.FindStringSubmatch(strings.TrimSpace(line))
		if len(match) == 0 {
			continue
		}
		functionName := strings.TrimSpace(line[:strings.Index(line, match[0])])
		functionName = strings.TrimSpace(strings.TrimPrefix(functionName, "at "))
		functionName = strings.Trim(functionName, "(@ ")
		if functionName == "" {
			functionName = "<anonymous>"
		}
		frames = append(frames, normalizeToken(functionName)+"@"+normalizeFramePath(match[1]))
		if len(frames) == maximum {
			break
		}
	}
	return frames
}

func normalizeFramePath(value string) string {
	if parsed, err := url.Parse(value); err == nil && parsed.Scheme != "" {
		value = parsed.Path
	}
	value = strings.TrimPrefix(value, "/")
	value = bundleHashPattern.ReplaceAllString(value, "$1<hash>$2")
	return value
}
