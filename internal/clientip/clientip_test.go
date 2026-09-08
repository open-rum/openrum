package clientip_test

import (
	"net/http"
	"testing"

	"openrum/internal/clientip"
)

func TestResolveKeepsPeerWhenNoProxyIsDeclared(t *testing.T) {
	resolver, err := clientip.New(nil)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if resolver.Enabled() {
		t.Fatal("a resolver without declared proxies must not read the header")
	}
	header := http.Header{"X-Forwarded-For": []string{"9.9.9.9"}}
	if got := resolver.Resolve("203.0.113.7:44321", header); got != "203.0.113.7" {
		t.Fatalf("got %q, want the socket peer 203.0.113.7", got)
	}
}

func TestResolve(t *testing.T) {
	// The declared edge is 10.0.0.0/8 plus one bare address.
	proxies := []string{"10.0.0.0/8", "192.0.2.10"}

	for _, testCase := range []struct {
		name       string
		remoteAddr string
		forwarded  []string
		want       string
	}{
		{
			name:       "single hop behind the edge",
			remoteAddr: "10.1.2.3:5000",
			forwarded:  []string{"203.0.113.7"},
			want:       "203.0.113.7",
		},
		{
			name:       "forged entries to the left are ignored",
			remoteAddr: "10.1.2.3:5000",
			forwarded:  []string{"1.1.1.1, 2.2.2.2, 203.0.113.7"},
			want:       "203.0.113.7",
		},
		{
			name:       "walk skips declared proxies on the right",
			remoteAddr: "10.1.2.3:5000",
			forwarded:  []string{"203.0.113.7, 10.4.4.4, 192.0.2.10"},
			want:       "203.0.113.7",
		},
		{
			name:       "separate header lines form one chain",
			remoteAddr: "10.1.2.3:5000",
			forwarded:  []string{"1.1.1.1", "203.0.113.7, 10.4.4.4"},
			want:       "203.0.113.7",
		},
		{
			name:       "untrusted peer never has its header read",
			remoteAddr: "198.51.100.4:5000",
			forwarded:  []string{"203.0.113.7"},
			want:       "198.51.100.4",
		},
		{
			name:       "missing header falls back to the peer",
			remoteAddr: "10.1.2.3:5000",
			forwarded:  nil,
			want:       "10.1.2.3",
		},
		{
			name:       "a chain of only proxies falls back to the peer",
			remoteAddr: "10.1.2.3:5000",
			forwarded:  []string{"10.4.4.4, 192.0.2.10"},
			want:       "10.1.2.3",
		},
		{
			name:       "an unreadable hop stops the walk",
			remoteAddr: "10.1.2.3:5000",
			forwarded:  []string{"203.0.113.7, not-an-address"},
			want:       "10.1.2.3",
		},
		{
			name:       "ports on forwarded entries are stripped",
			remoteAddr: "10.1.2.3:5000",
			forwarded:  []string{"203.0.113.7:9999"},
			want:       "203.0.113.7",
		},
		{
			name:       "bracketed IPv6 with a port is read",
			remoteAddr: "10.1.2.3:5000",
			forwarded:  []string{"[2001:db8::1]:443"},
			want:       "2001:db8::1",
		},
		{
			name:       "bare IPv6 is read",
			remoteAddr: "10.1.2.3:5000",
			forwarded:  []string{"2001:db8::1"},
			want:       "2001:db8::1",
		},
		{
			name:       "empty entries are skipped",
			remoteAddr: "10.1.2.3:5000",
			forwarded:  []string{" , 203.0.113.7 , "},
			want:       "203.0.113.7",
		},
		{
			name:       "an IPv4-mapped hop is reported in its IPv4 form",
			remoteAddr: "10.1.2.3:5000",
			forwarded:  []string{"::ffff:203.0.113.7"},
			want:       "203.0.113.7",
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			resolver, err := clientip.New(proxies)
			if err != nil {
				t.Fatalf("New: %v", err)
			}
			header := http.Header{}
			for _, line := range testCase.forwarded {
				header.Add("X-Forwarded-For", line)
			}
			if got := resolver.Resolve(testCase.remoteAddr, header); got != testCase.want {
				t.Fatalf("got %q, want %q", got, testCase.want)
			}
		})
	}
}

// A caller behind the edge must not be able to choose its own identity by
// padding the chain, because that would let one source occupy the whole limit.
func TestResolveIgnoresCallerSuppliedIdentities(t *testing.T) {
	resolver, err := clientip.New([]string{"10.0.0.0/8"})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	header := http.Header{}
	header.Add("X-Forwarded-For", "5.5.5.1, 5.5.5.2, 5.5.5.3")
	// The edge appends the peer it actually saw.
	header.Add("X-Forwarded-For", "203.0.113.7")
	if got := resolver.Resolve("10.1.2.3:5000", header); got != "203.0.113.7" {
		t.Fatalf("got %q, want the address the edge observed", got)
	}
}

func TestResolveBoundsChainLength(t *testing.T) {
	resolver, err := clientip.New([]string{"10.0.0.0/8"})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	header := http.Header{}
	for range 200 {
		header.Add("X-Forwarded-For", "10.9.9.9")
	}
	// Every readable hop is a declared proxy, so the peer stands. The point of
	// the case is that a long chain terminates rather than being walked whole.
	if got := resolver.Resolve("10.1.2.3:5000", header); got != "10.1.2.3" {
		t.Fatalf("got %q, want 10.1.2.3", got)
	}
}

func TestNewRejectsUnparseableProxy(t *testing.T) {
	if _, err := clientip.New([]string{"not-a-cidr"}); err == nil {
		t.Fatal("expected an error for an unparseable trusted proxy")
	}
}

func TestNewAcceptsPrefixWithHostBitsSet(t *testing.T) {
	// An operator naming their edge as 10.1.2.3/8 means the /8 block.
	resolver, err := clientip.New([]string{"10.1.2.3/8"})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	header := http.Header{"X-Forwarded-For": []string{"203.0.113.7"}}
	if got := resolver.Resolve("10.9.9.9:5000", header); got != "203.0.113.7" {
		t.Fatalf("got %q, want 203.0.113.7", got)
	}
}
