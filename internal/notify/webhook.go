package notify

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

type WebhookConfig struct {
	URL    string
	Secret string
}

type WebhookNotifier struct {
	config   WebhookConfig
	client   *http.Client
	resolver IPResolver
	now      func() time.Time
	sleeper  Sleeper
}

func NewWebhookNotifier(config WebhookConfig, resolver IPResolver) (*WebhookNotifier, error) {
	if resolver == nil {
		resolver = netResolver{}
	}
	target, err := url.Parse(config.URL)
	if err != nil || len(config.Secret) < 16 || ValidateWebhookURL(context.Background(), target, resolver) != nil {
		return nil, ErrUnsafeWebhookURL
	}
	return &WebhookNotifier{config: config, client: NewSafeWebhookClient(resolver), resolver: resolver, now: time.Now}, nil
}

func (notifier *WebhookNotifier) Send(ctx context.Context, notification Notification) error {
	body, err := json.Marshal(notification)
	if err != nil {
		return err
	}
	return retry(ctx, notifier.sleeper, func() (bool, error) {
		target, parseErr := url.Parse(notifier.config.URL)
		if parseErr != nil {
			return false, parseErr
		}
		if err := ValidateWebhookURL(ctx, target, notifier.resolver); err != nil {
			return false, err
		}
		timestamp := strconv.FormatInt(notifier.now().UTC().Unix(), 10)
		request, err := http.NewRequestWithContext(ctx, http.MethodPost, target.String(), bytes.NewReader(body))
		if err != nil {
			return false, err
		}
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("User-Agent", "OpenRUM-Notifier/1.0")
		request.Header.Set("X-OpenRUM-Timestamp", timestamp)
		request.Header.Set("X-OpenRUM-Signature", webhookSignature(notifier.config.Secret, timestamp, body))
		response, err := notifier.client.Do(request)
		if err != nil {
			if errors.Is(err, ErrUnsafeWebhookURL) {
				return false, err
			}
			return true, &DeliveryError{Code: "network", Err: err}
		}
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
		_ = response.Body.Close()
		if response.StatusCode >= 200 && response.StatusCode < 300 {
			return false, nil
		}
		retryable := response.StatusCode == http.StatusTooManyRequests || response.StatusCode >= 500
		return retryable, &DeliveryError{Code: fmt.Sprintf("http_%d", response.StatusCode), Err: fmt.Errorf("webhook returned HTTP %d", response.StatusCode)}
	})
}

func webhookSignature(secret, timestamp string, body []byte) string {
	digest := hmac.New(sha256.New, []byte(secret))
	_, _ = digest.Write([]byte(timestamp))
	_, _ = digest.Write([]byte("."))
	_, _ = digest.Write(body)
	return "v1=" + hex.EncodeToString(digest.Sum(nil))
}

type netResolver struct{}

func (netResolver) LookupIP(ctx context.Context, network, host string) ([]net.IP, error) {
	return net.DefaultResolver.LookupIP(ctx, network, host)
}
