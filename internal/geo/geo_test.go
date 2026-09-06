package geo

import (
	"net/http"
	"testing"
)

func TestResolverIgnoresTheHeaderWhenThePeerIsNotATrustedProxy(t *testing.T) {
	resolver, err := New("CF-IPCountry", []string{"10.0.0.0/8", "192.168.1.7"})
	if err != nil {
		t.Fatalf("new resolver: %v", err)
	}
	header := http.Header{}
	header.Set("CF-IPCountry", "JP")

	// A caller reaching the service directly must not be able to choose its own
	// country, otherwise every analytics breakdown becomes self-reported.
	if country := resolver.Country("203.0.113.10:44321", header); country != Unknown {
		t.Fatalf("untrusted peer resolved %q, want %q", country, Unknown)
	}
	if country := resolver.Country("10.4.2.9:33012", header); country != "JP" {
		t.Fatalf("trusted proxy resolved %q, want JP", country)
	}
	if country := resolver.Country("192.168.1.7:80", header); country != "JP" {
		t.Fatalf("bare trusted address resolved %q, want JP", country)
	}
	if country := resolver.Country("[::ffff:10.4.2.9]:33012", header); country != "JP" {
		t.Fatalf("IPv4-mapped peer resolved %q, want JP", country)
	}
}

func TestResolverRequiresATrustedProxyBeforeReadingAHeader(t *testing.T) {
	if _, err := New("CF-IPCountry", nil); err == nil {
		t.Fatal("a country header without a trusted proxy must be rejected")
	}
	disabled, err := New("", nil)
	if err != nil {
		t.Fatalf("disabled resolver: %v", err)
	}
	if disabled.Enabled() {
		t.Fatal("an empty header must leave resolution disabled")
	}
	header := http.Header{}
	header.Set("CF-IPCountry", "JP")
	if country := disabled.Country("10.4.2.9:1", header); country != Unknown {
		t.Fatalf("disabled resolver returned %q, want %q", country, Unknown)
	}
}

func TestDevelopmentResolverReadsTheHeaderFromAnyPeer(t *testing.T) {
	resolver := NewForDevelopment("CF-IPCountry")
	header := http.Header{}
	header.Set("CF-IPCountry", "JP")

	// A host process talking to a published container port arrives from an
	// address that varies by platform, so a development stack cannot decide
	// this by address without resolving countries on Linux and not on macOS.
	for _, peer := range []string{"172.67.72.165:45476", "172.18.0.6:44880", "203.0.113.10:44321"} {
		if country := resolver.Country(peer, header); country != "JP" {
			t.Errorf("peer %s resolved %q, want JP", peer, country)
		}
	}
	// The relaxation is about who is believed, not about what is accepted.
	header.Set("CF-IPCountry", "XX")
	if country := resolver.Country("203.0.113.10:1", header); country != Unknown {
		t.Errorf("an undetermined code resolved %q, want %q", country, Unknown)
	}
	// An empty header still disables resolution, so development does not invent
	// a country where production would report none.
	disabled := NewForDevelopment("")
	if disabled.Enabled() {
		t.Error("an empty header must leave resolution disabled in development too")
	}
}

func TestNormalizeKeepsOnlyCanonicalAlphaTwoCodes(t *testing.T) {
	for candidate, want := range map[string]string{
		" jp ": "JP",
		"cn":   "CN",
		"US":   "US",
		// Provider spellings for "not determined" collapse into one value so
		// callers never have to special-case them.
		"XX":  Unknown,
		"T1":  Unknown,
		"ZZ":  Unknown,
		"":    Unknown,
		"J":   Unknown,
		"JPN": Unknown,
		"J1":  Unknown,
		"中国":  Unknown,
	} {
		if got := Normalize(candidate); got != want {
			t.Fatalf("Normalize(%q)=%q, want %q", candidate, got, want)
		}
	}
}
