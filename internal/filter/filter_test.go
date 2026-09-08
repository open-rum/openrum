package filter_test

import (
	"slices"
	"testing"

	"openrum/internal/event"
	"openrum/internal/filter"
)

func TestClassify(t *testing.T) {
	for _, testCase := range []struct {
		name      string
		candidate event.CanonicalEvent
		want      []filter.Reason
	}{
		{
			name:      "ordinary page view is not classified",
			candidate: event.CanonicalEvent{EventType: event.EventTypePageView, PageURLNormalized: "https://shop.example.com/cart"},
			want:      nil,
		},
		{
			name: "bot flag written during normalization",
			candidate: event.CanonicalEvent{
				EventType: event.EventTypePageView, PageURLNormalized: "https://shop.example.com/",
				IngestFlags: []string{"bot"},
			},
			want: []filter.Reason{filter.ReasonBot},
		},
		{
			name: "extension frame in an error stack",
			candidate: event.CanonicalEvent{
				EventType: event.EventTypeError, PageURLNormalized: "https://shop.example.com/",
				ErrorStack: "at handler (chrome-extension://abcdef/content.js:1:1)",
			},
			want: []filter.Reason{filter.ReasonExtension},
		},
		{
			name: "extension scheme matching is case insensitive",
			candidate: event.CanonicalEvent{
				EventType: event.EventTypeError, PageURLNormalized: "https://shop.example.com/",
				ErrorStack: "at handler (MOZ-EXTENSION://abcdef/content.js:1:1)",
			},
			want: []filter.Reason{filter.ReasonExtension},
		},
		{
			// Only errors carry a stack, so the check must not fire on other
			// event types that happen to mention an extension elsewhere.
			name: "extension check applies to errors only",
			candidate: event.CanonicalEvent{
				EventType: event.EventTypeAPI, PageURLNormalized: "https://shop.example.com/",
				ErrorStack: "at handler (chrome-extension://abcdef/content.js:1:1)",
			},
			want: nil,
		},
		{
			name:      "page served from localhost",
			candidate: event.CanonicalEvent{EventType: event.EventTypePageView, PageURLNormalized: "http://localhost:5173/checkout"},
			want:      []filter.Reason{filter.ReasonLocalhost},
		},
		{
			name:      "page served from loopback",
			candidate: event.CanonicalEvent{EventType: event.EventTypePageView, PageURLNormalized: "http://127.0.0.1:5173/"},
			want:      []filter.Reason{filter.ReasonLocalhost},
		},
		{
			name:      "page served from IPv6 loopback",
			candidate: event.CanonicalEvent{EventType: event.EventTypePageView, PageURLNormalized: "http://[::1]:5173/"},
			want:      []filter.Reason{filter.ReasonLocalhost},
		},
		{
			name:      "mDNS name",
			candidate: event.CanonicalEvent{EventType: event.EventTypePageView, PageURLNormalized: "http://macbook.local/"},
			want:      []filter.Reason{filter.ReasonLocalhost},
		},
		{
			// An intranet deployment is the case a self-hosted product exists
			// to serve, so a private address is real traffic, not noise.
			name:      "private intranet address is real traffic",
			candidate: event.CanonicalEvent{EventType: event.EventTypePageView, PageURLNormalized: "https://10.4.1.9/orders"},
			want:      nil,
		},
		{
			name:      "another private range is real traffic",
			candidate: event.CanonicalEvent{EventType: event.EventTypePageView, PageURLNormalized: "https://192.168.1.20/orders"},
			want:      nil,
		},
		{
			// A hostname merely containing the word must not match.
			name:      "hostname containing localhost is not local",
			candidate: event.CanonicalEvent{EventType: event.EventTypePageView, PageURLNormalized: "https://localhost.example.com/"},
			want:      nil,
		},
		{
			name: "an event can fall into several categories",
			candidate: event.CanonicalEvent{
				EventType: event.EventTypeError, PageURLNormalized: "http://localhost:5173/",
				ErrorStack:  "at handler (chrome-extension://abcdef/content.js:1:1)",
				IngestFlags: []string{"bot"},
			},
			want: []filter.Reason{filter.ReasonBot, filter.ReasonExtension, filter.ReasonLocalhost},
		},
		{
			name:      "missing page URL is not local",
			candidate: event.CanonicalEvent{EventType: event.EventTypePageView},
			want:      nil,
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			got := filter.Classify(testCase.candidate)
			if !slices.Equal(got, testCase.want) {
				t.Fatalf("got %v, want %v", got, testCase.want)
			}
		})
	}
}
