// Package clientip resolves the network identity that ingest rate limiting is
// keyed on.
//
// The default is the socket peer address. A forwarding header is written by the
// caller, so honouring one unconditionally would let anybody mint an unlimited
// number of rate-limit identities and walk straight past the limiter. That is a
// worse failure than the one this package exists to fix, which is why reading
// the header is opt-in and applies only to requests that arrived through a
// proxy the operator has declared trustworthy.
//
// Without that declaration the behaviour is unchanged: every request behind a
// shared proxy keys on the proxy's address, so the per-IP limit acts as one
// aggregate gate rather than isolating a single abusive caller.
package clientip

import (
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"strings"
)

// forwardedHeader is the only chain this package reads. Its entries are ordered
// oldest to newest, and a conforming proxy appends the peer it observed.
const forwardedHeader = "X-Forwarded-For"

// maxForwardedHops bounds the walk so a caller cannot turn a long synthetic
// chain into per-request parsing work.
const maxForwardedHops = 32

// Resolver maps a request to the address rate limiting should be keyed on.
// The zero value, and a nil Resolver, both key on the socket peer.
type Resolver struct {
	proxies []netip.Prefix
}

// New builds a resolver. An empty list disables header parsing, which is the
// default and keeps the identity bound to the socket peer.
func New(trustedProxies []string) (*Resolver, error) {
	resolver := &Resolver{}
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
	return resolver, nil
}

// Enabled reports whether the resolver can ever read a forwarding header.
func (resolver *Resolver) Enabled() bool {
	return resolver != nil && len(resolver.proxies) > 0
}

// Resolve returns the address to key rate limiting on for a request whose
// direct peer is remoteAddr.
//
// The chain is walked from the right because that is the only end a caller
// cannot control: a trusted proxy appends the peer it saw, so entries further
// left may have been supplied by the caller itself. Taking the leftmost entry
// is the classic mistake, since that value is entirely attacker-chosen.
func (resolver *Resolver) Resolve(remoteAddr string, header http.Header) string {
	peer := hostOnly(remoteAddr)
	if !resolver.Enabled() {
		return peer
	}
	peerAddress, err := netip.ParseAddr(peer)
	if err != nil || !resolver.trusts(peerAddress.Unmap()) {
		return peer
	}
	chain := forwardedChain(header)
	for index := len(chain) - 1; index >= 0; index-- {
		candidate, err := netip.ParseAddr(chain[index])
		if err != nil {
			// The walk cannot continue past a hop it cannot read: every entry
			// further left was written before this one, so none of them can be
			// attributed either. Falling back to the peer degrades to the
			// aggregate gate rather than trusting a value we failed to parse.
			return peer
		}
		candidate = candidate.Unmap()
		if !resolver.trusts(candidate) {
			return candidate.String()
		}
	}
	// Every hop was a declared proxy, so the caller never appeared in the
	// chain. This happens for health checks and proxy-originated requests.
	return peer
}

func (resolver *Resolver) trusts(address netip.Addr) bool {
	for _, prefix := range resolver.proxies {
		if prefix.Contains(address) {
			return true
		}
	}
	return false
}

// forwardedChain flattens every X-Forwarded-For header on the request. Proxies
// are free to append a new header line instead of extending the existing one,
// and net/http preserves them separately, so reading only the first would drop
// the hops that matter most.
func forwardedChain(header http.Header) []string {
	var chain []string
	for _, line := range header.Values(forwardedHeader) {
		for _, entry := range strings.Split(line, ",") {
			entry = hostOnly(entry)
			if entry == "" {
				continue
			}
			chain = append(chain, entry)
			if len(chain) == maxForwardedHops {
				return chain
			}
		}
	}
	return chain
}

// parsePrefix accepts either a CIDR block or a bare address, so an operator can
// name a single proxy without appending a redundant mask.
func parsePrefix(candidate string) (netip.Prefix, error) {
	if strings.Contains(candidate, "/") {
		prefix, err := netip.ParsePrefix(candidate)
		if err != nil {
			return netip.Prefix{}, err
		}
		// Stored masked so the prefix prints canonically; Contains ignores
		// host bits either way.
		return prefix.Masked(), nil
	}
	address, err := netip.ParseAddr(candidate)
	if err != nil {
		return netip.Prefix{}, err
	}
	address = address.Unmap()
	return netip.PrefixFrom(address, address.BitLen()), nil
}

// hostOnly strips an optional port and IPv6 brackets. Proxies differ on whether
// they record a port, and both spellings name the same host.
func hostOnly(value string) string {
	value = strings.TrimSpace(value)
	if host, _, err := net.SplitHostPort(value); err == nil {
		return strings.TrimSpace(host)
	}
	return strings.Trim(value, "[]")
}
