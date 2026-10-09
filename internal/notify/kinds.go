package notify

import (
	"context"
	"errors"
	"net/url"
	"strings"
)

// Kind names a notification channel type. Adding one means: a KindSpec here, the
// database constraint on notification_channels.kind, the Console's channelKinds.ts,
// and a docs page. See docs/agents/alerts.md.
type Kind string

const (
	KindWebhook Kind = "webhook"
	KindFeishu  Kind = "feishu"
)

// ErrInvalidChannelConfig is a validation failure that is safe to report to the user.
var ErrInvalidChannelConfig = errors.New("invalid channel configuration")

// KindSpec is everything the platform needs to store and use one channel kind.
// Config is a flat string map, encrypted at rest; SecretFields are write-only.
type KindSpec struct {
	SecretFields []string
	// Normalize validates submitted settings and returns the config to store. On an
	// update, previous holds the stored config so a blank secret keeps its value.
	Normalize func(ctx context.Context, input, previous map[string]string, resolver IPResolver) (map[string]string, error)
	Build     func(config map[string]string, resolver IPResolver) (Notifier, error)
}

var kinds = map[Kind]KindSpec{
	KindWebhook: {
		SecretFields: []string{"secret"},
		Normalize:    normalizeWebhook,
		Build: func(config map[string]string, resolver IPResolver) (Notifier, error) {
			return NewWebhookNotifier(WebhookConfig{URL: config["url"], Secret: config["secret"]}, resolver)
		},
	},
	KindFeishu: {
		SecretFields: []string{"secret"},
		Normalize:    normalizeFeishu,
		Build: func(config map[string]string, resolver IPResolver) (Notifier, error) {
			return NewFeishuNotifier(FeishuConfig{WebhookURL: config["webhookUrl"], Secret: config["secret"]}, resolver)
		},
	},
}

// LookupKind returns the spec of a kind that can be created and delivered today.
func LookupKind(kind string) (KindSpec, bool) {
	spec, ok := kinds[Kind(kind)]
	return spec, ok
}

func keepSecret(input, previous map[string]string, field string) string {
	value := strings.TrimSpace(input[field])
	if value == "" && previous != nil {
		return previous[field]
	}
	return value
}

func normalizeWebhook(ctx context.Context, input, previous map[string]string, resolver IPResolver) (map[string]string, error) {
	if resolver == nil {
		resolver = netResolver{}
	}
	raw := strings.TrimSpace(input["url"])
	if raw == "" && previous != nil {
		raw = previous["url"]
	}
	target, err := url.Parse(raw)
	if err != nil || len(raw) > 2048 {
		return nil, ErrInvalidChannelConfig
	}
	if err := ValidateWebhookURL(ctx, target, resolver); err != nil {
		return nil, errors.Join(ErrInvalidChannelConfig, err)
	}
	secret := keepSecret(input, previous, "secret")
	if len(secret) < 16 || len(secret) > 256 {
		return nil, ErrInvalidChannelConfig
	}
	return map[string]string{"url": target.String(), "secret": secret}, nil
}

func normalizeFeishu(ctx context.Context, input, previous map[string]string, resolver IPResolver) (map[string]string, error) {
	if resolver == nil {
		resolver = netResolver{}
	}
	raw := strings.TrimSpace(input["webhookUrl"])
	if raw == "" && previous != nil {
		raw = previous["webhookUrl"]
	}
	target, err := ParseFeishuWebhookURL(raw)
	if err != nil {
		return nil, ErrInvalidChannelConfig
	}
	if err := ValidateWebhookURL(ctx, target, resolver); err != nil {
		return nil, errors.Join(ErrInvalidChannelConfig, err)
	}
	config := map[string]string{"webhookUrl": target.String()}
	// Signature verification is optional in Feishu; "clearSecret" turns it off on update.
	secret := keepSecret(input, previous, "secret")
	if input["clearSecret"] == "true" {
		secret = ""
	}
	if len(secret) > 128 {
		return nil, ErrInvalidChannelConfig
	}
	if secret != "" {
		config["secret"] = secret
	}
	return config, nil
}
