// Package geo resolves the country of an inbound event without trusting
// client-controlled input.
//
// Country is deliberately kept out of the ingest rate-limit identity. That
// identity stays bound to the socket peer address, because a country taken from
// a request header can be forged by whoever sends the request. Honouring such a
// header for rate limiting would let a caller mint unlimited identities, so the
// two concerns use different sources on purpose.
package geo

import (
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"strings"
)

// Unknown is the ISO 3166-1 alpha-2 user-assigned code this project stores when
// a country cannot be established.
const Unknown = "ZZ"

// Resolver reads a country from a named header, but only for requests that
// arrived through a proxy the operator has declared trustworthy. Anything else
// resolves to Unknown, so an untrusted caller cannot choose its own country.
type Resolver struct {
	header  string
	proxies []netip.Prefix
	anyPeer bool
}

// New builds a resolver. An empty header disables country resolution entirely,
// which is the default: without a proxy that injects the header, every value a
// client could supply would be self-reported.
func New(header string, trustedProxies []string) (*Resolver, error) {
	resolver := &Resolver{header: http.CanonicalHeaderKey(strings.TrimSpace(header))}
	for _, candidate := range trustedProxies {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" {
			continue
		}
		prefix, err := parsePrefix(candidate)
		if err != nil {
			return nil, fmt.Errorf("trusted proxy %q: %w", candidate, err)
		}
		resolver.proxies = append(resolver.proxies, prefix)
	}
	if resolver.header != "" && len(resolver.proxies) == 0 {
		return nil, fmt.Errorf("country header %q requires at least one trusted proxy", header)
	}
	return resolver, nil
}

// NewForDevelopment builds a resolver that reads the country header from any
// peer, not only from a declared proxy.
//
// A development stack has no edge in front of it, and the peer address is not
// evidence of one either: a request from the host to a published container port
// arrives from an address that varies by platform, so on Docker Desktop it
// falls outside the private ranges the compose file trusts and on Linux it
// falls inside them. Deciding trust by address would therefore resolve
// countries for some contributors and not others.
//
// The relaxation is bounded by APP_ENV rather than by a widened CIDR list: the
// committed environment file keeps a production-shaped trust boundary, and a
// deployment never sets APP_ENV to development. What a forged header can reach
// is analytics and nothing else, because the rate-limit identity stays bound to
// the socket peer address.
func NewForDevelopment(header string) *Resolver {
	return &Resolver{header: http.CanonicalHeaderKey(strings.TrimSpace(header)), anyPeer: true}
}

// Enabled reports whether the resolver can ever return a country.
func (resolver *Resolver) Enabled() bool {
	return resolver != nil && resolver.header != ""
}

// Country resolves the country for a request whose direct peer is remoteAddr.
func (resolver *Resolver) Country(remoteAddr string, header http.Header) string {
	if !resolver.Enabled() || !resolver.trusts(remoteAddr) {
		return Unknown
	}
	return Normalize(header.Get(resolver.header))
}

// Normalize accepts a candidate country code and returns either a canonical
// alpha-2 code or Unknown. Codes that stand for "could not be determined" are
// mapped to Unknown so callers do not have to know each provider's spelling:
// Cloudflare sends XX for unknown and T1 for traffic arriving over Tor.
func Normalize(candidate string) string {
	candidate = strings.ToUpper(strings.TrimSpace(candidate))
	if len(candidate) != 2 {
		return Unknown
	}
	for index := 0; index < len(candidate); index++ {
		if candidate[index] < 'A' || candidate[index] > 'Z' {
			return Unknown
		}
	}
	switch candidate {
	case "XX", "T1", Unknown:
		return Unknown
	}
	return candidate
}

func (resolver *Resolver) trusts(remoteAddr string) bool {
	if resolver.anyPeer {
		return true
	}
	address, err := netip.ParseAddr(hostOnly(remoteAddr))
	if err != nil {
		return false
	}
	address = address.Unmap()
	for _, prefix := range resolver.proxies {
		if prefix.Contains(address) {
			return true
		}
	}
	return false
}

// parsePrefix accepts either a CIDR block or a bare address, so an operator can
// name a single proxy without appending a redundant mask.
func parsePrefix(candidate string) (netip.Prefix, error) {
	if strings.Contains(candidate, "/") {
		return netip.ParsePrefix(candidate)
	}
	address, err := netip.ParseAddr(candidate)
	if err != nil {
		return netip.Prefix{}, err
	}
	address = address.Unmap()
	return netip.PrefixFrom(address, address.BitLen()), nil
}

func hostOnly(remoteAddr string) string {
	remoteAddr = strings.TrimSpace(remoteAddr)
	if host, _, err := net.SplitHostPort(remoteAddr); err == nil {
		return host
	}
	return strings.Trim(remoteAddr, "[]")
}
