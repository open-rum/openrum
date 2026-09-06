package notify

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type fixtureSMTPDelivery struct{ attempts atomic.Int32 }

func (fixture *fixtureSMTPDelivery) Deliver(_ context.Context, _ SMTPConfig, message []byte) error {
	if !strings.Contains(string(message), "Open in OpenRUM") {
		return errors.New("missing deep link")
	}
	if fixture.attempts.Add(1) < 3 {
		return errors.New("temporary SMTP failure")
	}
	return nil
}

func TestSMTPRetriesThreeTimesAndRejectsHeaderInjection(t *testing.T) {
	delivery := &fixtureSMTPDelivery{}
	notifier, err := NewSMTPNotifier(SMTPConfig{
		Host: "smtp.example.test", Port: 587, From: "alerts@example.test", To: []string{"oncall@example.test"},
	}, delivery)
	if err != nil {
		t.Fatal(err)
	}
	notifier.sleeper = func(context.Context, time.Duration) error { return nil }
	if err := notifier.Send(context.Background(), Notification{Title: "Checkout errors", Message: "Threshold exceeded", DeepLink: "https://rum.example.test/issues"}); err != nil {
		t.Fatal(err)
	}
	if delivery.attempts.Load() != 3 {
		t.Fatalf("attempts=%d", delivery.attempts.Load())
	}
	if err := notifier.Send(context.Background(), Notification{Title: "valid\r\nBcc: attacker@example.test"}); err == nil {
		t.Fatal("expected header injection rejection")
	}
}

type fixtureResolver struct{ addresses []net.IP }

func (fixture fixtureResolver) LookupIP(context.Context, string, string) ([]net.IP, error) {
	return fixture.addresses, nil
}

func TestWebhookRejectsPrivateIPsIncludingRedirects(t *testing.T) {
	private := fixtureResolver{addresses: []net.IP{net.ParseIP("127.0.0.1")}}
	target, _ := url.Parse("https://hooks.example.test/notify")
	if err := ValidateWebhookURL(context.Background(), target, private); !errors.Is(err, ErrUnsafeWebhookURL) {
		t.Fatalf("private IP error=%v", err)
	}
	client := NewSafeWebhookClient(private)
	request := &http.Request{URL: target}
	if err := client.CheckRedirect(request, []*http.Request{{URL: &url.URL{Scheme: "https", Host: "public.example.test"}}}); !errors.Is(err, ErrUnsafeWebhookURL) {
		t.Fatalf("redirect error=%v", err)
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (function roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return function(request)
}

func TestWebhookSignsPayloadAndRetriesServerFailures(t *testing.T) {
	resolver := fixtureResolver{addresses: []net.IP{net.ParseIP("93.184.216.34")}}
	notifier, err := NewWebhookNotifier(WebhookConfig{URL: "https://hooks.example.test/notify", Secret: "0123456789abcdef"}, resolver)
	if err != nil {
		t.Fatal(err)
	}
	var attempts atomic.Int32
	notifier.client = &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		if !strings.HasPrefix(request.Header.Get("X-OpenRUM-Signature"), "v1=") || request.Header.Get("X-OpenRUM-Timestamp") == "" {
			t.Fatal("missing webhook signature")
		}
		status := http.StatusServiceUnavailable
		if attempts.Add(1) == 3 {
			status = http.StatusNoContent
		}
		return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader("response")), Header: make(http.Header)}, nil
	})}
	notifier.now = func() time.Time { return time.Date(2026, 9, 3, 8, 0, 0, 0, time.UTC) }
	notifier.sleeper = func(context.Context, time.Duration) error { return nil }
	if err := notifier.Send(context.Background(), Notification{ID: "evaluation-1", Title: "Errors high"}); err != nil {
		t.Fatal(err)
	}
	if attempts.Load() != 3 {
		t.Fatalf("attempts=%d", attempts.Load())
	}
}
