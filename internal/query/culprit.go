package query

import (
	"net/url"
	"regexp"
	"strings"
)

var (
	// "at fn (url:1:2)", "at url:1:2" (Chrome, Edge) and "fn@url:1:2" (Firefox, Safari).
	v8StackFrame    = regexp.MustCompile(`^\s*at\s+(?:(.+?)\s+\()?(.+?)(?::\d+)?(?::\d+)?\)?\s*$`)
	geckoStackFrame = regexp.MustCompile(`^\s*(.*?)@(.+?)(?::\d+)?(?::\d+)?\s*$`)
	libraryFile     = regexp.MustCompile(`(?i)/node_modules/|^node_modules/|/\.vite/deps/|/vendor[-./]|chunk-[A-Z0-9]{6,}|^(?:native|<anonymous>)$|^(?:chrome|moz|safari)-extension:`)
)

// culpritFromStack returns the innermost application frame of a raw browser stack, or the
// first frame when every frame is library code. The list names an Issue's location from this;
// the detail page restores it through Source Maps when it can.
func culpritFromStack(stack string) *IssueCulprit {
	var first *IssueCulprit
	for _, line := range strings.Split(stack, "\n") {
		match := v8StackFrame.FindStringSubmatch(line)
		if match == nil || !strings.HasPrefix(strings.TrimSpace(line), "at ") {
			match = geckoStackFrame.FindStringSubmatch(line)
			if match == nil || !strings.Contains(line, "@") {
				continue
			}
		}
		file := shortScriptPath(match[2])
		if file == "" {
			continue
		}
		frame := &IssueCulprit{Function: strings.TrimSpace(match[1]), File: file}
		if first == nil {
			first = frame
		}
		if !libraryFile.MatchString(match[2]) {
			return frame
		}
	}
	return first
}

// shortScriptPath turns "https://cdn.example.com/assets/app.js?v=3" into "assets/app.js".
func shortScriptPath(raw string) string {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Host == "" {
		return strings.TrimPrefix(strings.SplitN(raw, "?", 2)[0], "/")
	}
	if path := strings.TrimPrefix(parsed.Path, "/"); path != "" {
		return path
	}
	return parsed.Host
}
