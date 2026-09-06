package security_test

import (
	"context"
	"net"
	"net/url"
	"testing"

	"openrum/internal/notify"
)

type fixedResolver map[string][]net.IP

func (resolver fixedResolver) LookupIP(_ context.Context, _, host string) ([]net.IP, error) {
	return resolver[host], nil
}

func TestWebhookRejectsPrivateMetadataAndRebindingTargets(t *testing.T) {
	resolver := fixedResolver{
		"private.example":  {net.ParseIP("10.0.0.8")},
		"metadata.example": {net.ParseIP("169.254.169.254")},
		"mixed.example":    {net.ParseIP("203.0.113.10"), net.ParseIP("127.0.0.1")},
	}
	for _, raw := range []string{"http://public.example/hook", "https://private.example/hook", "https://metadata.example/hook", "https://mixed.example/hook"} {
		target, err := url.Parse(raw)
		if err != nil {
			t.Fatal(err)
		}
		if err := notify.ValidateWebhookURL(context.Background(), target, resolver); err == nil {
			t.Errorf("unsafe webhook accepted: %s", raw)
		}
	}
}
