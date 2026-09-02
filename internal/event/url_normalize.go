package event

import (
	"net"
	"net/url"
	"regexp"
	"strings"

	"openrum/internal/privacy"
)

var (
	uuidSegmentPattern     = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
	numberSegmentPattern   = regexp.MustCompile(`^\d+$`)
	hexSegmentPattern      = regexp.MustCompile(`(?i)^[0-9a-f]{16,}$`)
	opaqueIDSegmentPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{24,}$`)
)

// NormalizeURL strips credentials, query strings and fragments. It returns a
// safe concrete URL and an aggregation URL with likely identifiers replaced.
func NormalizeURL(raw string) (string, string, bool) {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.User != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Hostname() == "" {
		return "", "", false
	}
	parsed.Scheme = strings.ToLower(parsed.Scheme)
	hostname := strings.ToLower(parsed.Hostname())
	port := parsed.Port()
	if (parsed.Scheme == "http" && port == "80") || (parsed.Scheme == "https" && port == "443") {
		port = ""
	}
	if port == "" {
		if strings.Contains(hostname, ":") {
			parsed.Host = "[" + hostname + "]"
		} else {
			parsed.Host = hostname
		}
	} else {
		parsed.Host = net.JoinHostPort(hostname, port)
	}
	parsed.RawQuery = ""
	parsed.ForceQuery = false
	parsed.Fragment = ""
	parsed.RawFragment = ""
	parsed.RawPath = ""
	if parsed.Path == "" {
		parsed.Path = "/"
	}
	parsed.Path, _ = privacy.ScrubString(parsed.Path, 2048)
	safe := parsed.String()
	parsed.Path = normalizePath(parsed.Path)
	parsed.RawPath = ""
	return safe, parsed.String(), true
}

func NormalizeRoute(route string) string {
	if route == "" || !strings.HasPrefix(route, "/") || strings.ContainsAny(route, "?#") {
		return ""
	}
	return normalizePath(route)
}

func normalizePath(path string) string {
	segments := strings.Split(path, "/")
	for index, segment := range segments {
		decoded, err := url.PathUnescape(segment)
		if err != nil {
			decoded = segment
		}
		if dynamicSegment(decoded) {
			segments[index] = ":id"
		}
	}
	return strings.Join(segments, "/")
}

func dynamicSegment(segment string) bool {
	return uuidSegmentPattern.MatchString(segment) || numberSegmentPattern.MatchString(segment) ||
		hexSegmentPattern.MatchString(segment) || opaqueIDSegmentPattern.MatchString(segment)
}
