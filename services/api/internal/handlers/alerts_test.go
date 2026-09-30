package handlers

import (
	"context"
	"encoding/json"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"openrum/internal/metadata"
	"openrum/internal/notify"
)

type publicResolver struct{}

func (publicResolver) LookupIP(context.Context, string, string) ([]net.IP, error) {
	return []net.IP{net.ParseIP("93.184.216.34")}, nil
}

type privateResolver struct{}

func (privateResolver) LookupIP(context.Context, string, string) ([]net.IP, error) {
	return []net.IP{net.ParseIP("10.1.2.3")}, nil
}

func TestDeliveryStateSummarizesChannelOutcomes(t *testing.T) {
	notified := time.Now()
	sent := metadata.AlertDelivery{Status: "sent"}
	failed := metadata.AlertDelivery{Status: "failed", ErrorCode: "feishu_sign_invalid"}
	for _, current := range []struct {
		notification metadata.AlertNotification
		want         string
	}{
		{metadata.AlertNotification{Status: "suppressed"}, "cooldown"},
		{metadata.AlertNotification{Status: "breached", NotifiedAt: &notified}, "no_channels"},
		{metadata.AlertNotification{Status: "breached"}, "pending"},
		{metadata.AlertNotification{Status: "breached", Deliveries: []metadata.AlertDelivery{sent, sent}}, "delivered"},
		{metadata.AlertNotification{Status: "breached", Deliveries: []metadata.AlertDelivery{sent, failed}}, "partial"},
		{metadata.AlertNotification{Status: "breached", Deliveries: []metadata.AlertDelivery{failed}}, "failed"},
	} {
		if got := deliveryState(current.notification); got != current.want {
			t.Errorf("%+v: got %s want %s", current.notification, got, current.want)
		}
	}
}

func TestChannelIDsMustBeUUIDs(t *testing.T) {
	id := uuid.New()
	if parsed, ok := parseChannelIDs([]string{id.String()}); !ok || parsed[0] != id {
		t.Fatalf("valid ids: %v %v", parsed, ok)
	}
	if _, ok := parseChannelIDs([]string{"not-a-uuid"}); ok {
		t.Fatal("a malformed channel id was accepted")
	}
}

func TestChannelSettingsAreNormalizedPerKind(t *testing.T) {
	ctx := context.Background()
	feishu, _ := notify.LookupKind("feishu")
	config, err := normalizeChannel(ctx, feishu, map[string]string{
		"webhookUrl": "https://open.feishu.cn/open-apis/bot/v2/hook/abc", "secret": "s3cret",
	}, nil, publicResolver{})
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]string
	if err := json.Unmarshal(config, &decoded); err != nil || decoded["secret"] != "s3cret" {
		t.Fatalf("config did not round-trip: %s %v", config, err)
	}
	webhook, _ := notify.LookupKind("webhook")
	for name, settings := range map[string]map[string]string{
		"plaintext http":     {"url": "http://hooks.example.com/openrum", "secret": strings.Repeat("s", 32)},
		"credentials in url": {"url": "https://user:pass@hooks.example.com/openrum", "secret": strings.Repeat("s", 32)},
		"short secret":       {"url": "https://hooks.example.com/openrum", "secret": "tooshort"},
		"oversized value":    {"url": "https://hooks.example.com/" + strings.Repeat("a", 5000), "secret": strings.Repeat("s", 32)},
	} {
		if _, err := normalizeChannel(ctx, webhook, settings, nil, publicResolver{}); err == nil {
			t.Errorf("%s was accepted", name)
		}
	}
	if _, err := normalizeChannel(ctx, webhook, map[string]string{
		"url": "https://internal.example.com/openrum", "secret": strings.Repeat("s", 32),
	}, nil, privateResolver{}); err == nil {
		t.Fatal("a webhook resolving to a private address must be refused when it is saved")
	}
}
