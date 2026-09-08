package handlers

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"openrum/internal/metadata"
)

func TestAlertDeepLinkTargetsThePageThatExplainsTheMetric(t *testing.T) {
	projectID := uuid.New()
	occurredAt := time.Date(2026, 9, 6, 12, 0, 0, 0, time.UTC)
	for _, testCase := range []struct {
		metric metadata.AlertMetric
		page   string
	}{
		{metadata.AlertErrorCount, "issues"},
		{metadata.AlertErrorRate, "issues"},
		{metadata.AlertAPIFailureRate, "apis"},
		{metadata.AlertLCPP75, "performance"},
		{metadata.AlertMetric("unknown"), "overview"},
	} {
		link := alertDeepLink(metadata.AlertNotification{
			ProjectID: projectID, Metric: testCase.metric, OccurredAt: occurredAt,
		})
		want := "/projects/" + projectID.String() + "/" + testCase.page
		if !strings.HasPrefix(link, want+"?") {
			t.Fatalf("metric %q produced %q, want prefix %q", testCase.metric, link, want)
		}
		if !strings.Contains(link, "to=2026-09-06T12%3A00%3A00Z") {
			t.Fatalf("metric %q lost the window end: %q", testCase.metric, link)
		}
	}
}

func TestWebhookChannelConfigRejectsUnsafeEndpointsAndWeakSecrets(t *testing.T) {
	valid := createChannelRequest{
		Name: "On-call", Kind: metadata.ChannelWebhook,
		URL: "https://hooks.example.com/openrum", Secret: strings.Repeat("s", 32),
	}
	config, ok := webhookChannelConfig(valid)
	if !ok {
		t.Fatal("a well-formed webhook channel was rejected")
	}
	var decoded map[string]string
	if err := json.Unmarshal(config, &decoded); err != nil {
		t.Fatalf("config is not an object: %v", err)
	}
	if decoded["url"] != valid.URL || decoded["secret"] != valid.Secret {
		t.Fatalf("config did not round-trip: %v", decoded)
	}

	for name, mutate := range map[string]func(createChannelRequest) createChannelRequest{
		"plaintext http": func(request createChannelRequest) createChannelRequest {
			request.URL = "http://hooks.example.com/openrum"
			return request
		},
		"credentials in url": func(request createChannelRequest) createChannelRequest {
			request.URL = "https://user:pass@hooks.example.com/openrum"
			return request
		},
		"missing host": func(request createChannelRequest) createChannelRequest {
			request.URL = "https:///openrum"
			return request
		},
		"short secret": func(request createChannelRequest) createChannelRequest {
			request.Secret = "tooshort"
			return request
		},
		"blank name": func(request createChannelRequest) createChannelRequest {
			request.Name = "   "
			return request
		},
		"smtp kind": func(request createChannelRequest) createChannelRequest {
			request.Kind = metadata.ChannelSMTP
			return request
		},
	} {
		if _, ok := webhookChannelConfig(mutate(valid)); ok {
			t.Fatalf("%s was accepted", name)
		}
	}
}
