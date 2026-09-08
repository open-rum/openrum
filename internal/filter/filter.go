// Package filter classifies events that a project is unlikely to want in its
// data, such as crawler traffic or errors thrown by a browser extension.
//
// Classification is separate from acting on it. This package only reports what
// an event looks like; whether a project drops those events, keeps them, or
// merely counts them is decided by the caller. Keeping the two apart is what
// lets the consumer measure the effect of a rule before anybody enables it.
package filter

import (
	"net/netip"
	"net/url"
	"slices"
	"strings"

	"openrum/internal/event"
)

// Reason names a category of unwanted traffic. The set is closed so it can be
// used as a metric label without letting cardinality grow with user input.
type Reason string

const (
	// ReasonBot marks traffic from a self-identified crawler or a headless
	// browser. The flag is written during normalization, which is the last
	// stage that still holds the raw user agent.
	ReasonBot Reason = "bot"

	// ReasonExtension marks an error raised by browser extension code rather
	// than by the page.
	ReasonExtension Reason = "extension"

	// ReasonLocalhost marks a page served from a developer machine.
	ReasonLocalhost Reason = "localhost"
)

// BotFlag is the ingest flag normalization writes for crawler traffic. It is
// also stored on the event, so the share of bot traffic in a project can be
// measured from ClickHouse without adding a per-project metric label.
const BotFlag = "bot"

// extensionSchemes are the origins browsers give to extension code. An error
// whose stack points at one of them was not raised by the page.
var extensionSchemes = []string{
	"chrome-extension://",
	"moz-extension://",
	"safari-web-extension://",
	"safari-extension://",
	"ms-browser-extension://",
	"chrome-search://",
}

// Classify reports every category the event falls into. An event can match
// more than one, so the caller decides which reason to attribute it to.
func Classify(candidate event.CanonicalEvent) []Reason {
	var reasons []Reason
	if slices.Contains(candidate.IngestFlags, BotFlag) {
		reasons = append(reasons, ReasonBot)
	}
	if isExtensionError(candidate) {
		reasons = append(reasons, ReasonExtension)
	}
	if isLocalPage(candidate.PageURLNormalized) {
		reasons = append(reasons, ReasonLocalhost)
	}
	return reasons
}

// isExtensionError looks at the stack rather than the page URL, because a page
// URL that is not http or https never survives normalization: an event whose
// document really was an extension page does not reach this stage.
func isExtensionError(candidate event.CanonicalEvent) bool {
	if candidate.EventType != event.EventTypeError || candidate.ErrorStack == "" {
		return false
	}
	stack := strings.ToLower(candidate.ErrorStack)
	for _, scheme := range extensionSchemes {
		if strings.Contains(stack, scheme) {
			return true
		}
	}
	return false
}

// isLocalPage reports whether the page was served from a developer machine.
//
// Private ranges such as 10.0.0.0/8 are deliberately not treated as local. A
// self-hosted deployment is exactly the case where an intranet application is
// the real traffic, so counting those as developer noise would discard the data
// the project exists to collect. Loopback, the localhost name and the mDNS
// .local suffix have no such second reading.
func isLocalPage(pageURL string) bool {
	if pageURL == "" {
		return false
	}
	parsed, err := url.Parse(pageURL)
	if err != nil {
		return false
	}
	hostname := strings.ToLower(parsed.Hostname())
	if hostname == "" {
		return false
	}
	if hostname == "localhost" || strings.HasSuffix(hostname, ".localhost") ||
		strings.HasSuffix(hostname, ".local") {
		return true
	}
	address, err := netip.ParseAddr(hostname)
	if err != nil {
		return false
	}
	address = address.Unmap()
	// Link-local covers the 169.254.0.0/16 and fe80::/10 addresses a machine
	// assigns itself when no network hands it one.
	return address.IsLoopback() || address.IsLinkLocalUnicast()
}
