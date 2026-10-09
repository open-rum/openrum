package notify

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Feishu custom group bots accept POSTs at /open-apis/bot/v2/hook/<token> on the
// Feishu (China) or Lark (international) open platform. Restricting the host keeps a
// "Feishu" channel from becoming a general-purpose outbound request.
var feishuHosts = map[string]bool{"open.feishu.cn": true, "open.larksuite.com": true}

const feishuHookPath = "/open-apis/bot/v2/hook/"

type FeishuConfig struct {
	WebhookURL string
	// Secret is the bot's optional "signature verification" key.
	Secret string
}

type FeishuNotifier struct {
	config   FeishuConfig
	client   *http.Client
	resolver IPResolver
	now      func() time.Time
	sleeper  Sleeper
}

// ParseFeishuWebhookURL accepts only a Feishu or Lark custom bot hook address.
func ParseFeishuWebhookURL(raw string) (*url.URL, error) {
	target, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || target.Scheme != "https" || target.User != nil || target.Fragment != "" || target.RawQuery != "" {
		return nil, ErrUnsafeWebhookURL
	}
	host := strings.ToLower(target.Hostname())
	token := strings.TrimPrefix(target.Path, feishuHookPath)
	if !feishuHosts[host] || target.Port() != "" || !strings.HasPrefix(target.Path, feishuHookPath) ||
		token == "" || strings.Contains(token, "/") || len(token) > 128 {
		return nil, ErrUnsafeWebhookURL
	}
	return target, nil
}

func NewFeishuNotifier(config FeishuConfig, resolver IPResolver) (*FeishuNotifier, error) {
	if resolver == nil {
		resolver = netResolver{}
	}
	if _, err := ParseFeishuWebhookURL(config.WebhookURL); err != nil {
		return nil, err
	}
	return &FeishuNotifier{config: config, client: NewSafeWebhookClient(resolver), resolver: resolver, now: time.Now}, nil
}

// feishuResponse covers both response shapes the hook has used: {code,msg} and the
// older {StatusCode,StatusMessage}. Errors usually arrive with HTTP 200.
type feishuResponse struct {
	Code       *int   `json:"code"`
	Message    string `json:"msg"`
	StatusCode *int   `json:"StatusCode"`
}

func (notifier *FeishuNotifier) Send(ctx context.Context, notification Notification) error {
	return retry(ctx, notifier.sleeper, func() (bool, error) {
		target, err := ParseFeishuWebhookURL(notifier.config.WebhookURL)
		if err != nil {
			return false, err
		}
		if err := ValidateWebhookURL(ctx, target, notifier.resolver); err != nil {
			return false, err
		}
		message := feishuMessage(notification)
		if notifier.config.Secret != "" {
			timestamp := notifier.now().UTC().Unix()
			message["timestamp"] = strconv.FormatInt(timestamp, 10)
			message["sign"] = FeishuSignature(notifier.config.Secret, timestamp)
		}
		body, err := json.Marshal(message)
		if err != nil {
			return false, err
		}
		request, err := http.NewRequestWithContext(ctx, http.MethodPost, target.String(), bytes.NewReader(body))
		if err != nil {
			return false, err
		}
		request.Header.Set("Content-Type", "application/json; charset=utf-8")
		request.Header.Set("User-Agent", "OpenRUM-Notifier/1.0")
		response, err := notifier.client.Do(request)
		if err != nil {
			if errors.Is(err, ErrUnsafeWebhookURL) {
				return false, err
			}
			return true, &DeliveryError{Code: "network", Err: err}
		}
		defer func() { _ = response.Body.Close() }()
		raw, _ := io.ReadAll(io.LimitReader(response.Body, 8192))
		if response.StatusCode == http.StatusTooManyRequests || response.StatusCode >= 500 {
			return true, &DeliveryError{Code: fmt.Sprintf("http_%d", response.StatusCode), Err: fmt.Errorf("feishu returned HTTP %d", response.StatusCode)}
		}
		if response.StatusCode < 200 || response.StatusCode >= 300 {
			return false, &DeliveryError{Code: fmt.Sprintf("http_%d", response.StatusCode), Err: fmt.Errorf("feishu returned HTTP %d", response.StatusCode)}
		}
		var parsed feishuResponse
		if err := json.Unmarshal(raw, &parsed); err != nil {
			return false, &DeliveryError{Code: "feishu_bad_response", Err: err}
		}
		code := 0
		if parsed.Code != nil {
			code = *parsed.Code
		} else if parsed.StatusCode != nil {
			code = *parsed.StatusCode
		}
		if code == 0 {
			return false, nil
		}
		return feishuFailure(code)
	})
}

// feishuFailure maps the bot's documented error codes onto stored codes. Only
// frequency limits are retried; the others are configuration problems a retry
// cannot fix.
func feishuFailure(code int) (bool, error) {
	err := fmt.Errorf("feishu rejected the message with code %d", code)
	switch code {
	case 11232:
		return true, &DeliveryError{Code: "feishu_rate_limited", Err: err}
	case 19021:
		return false, &DeliveryError{Code: "feishu_sign_invalid", Err: err}
	case 19022:
		return false, &DeliveryError{Code: "feishu_ip_not_allowed", Err: err}
	case 19024:
		return false, &DeliveryError{Code: "feishu_keyword_mismatch", Err: err}
	default:
		return false, &DeliveryError{Code: "feishu_rejected", Err: err}
	}
}

// FeishuSignature implements the bot's signature verification: the string
// "timestamp\nsecret" is the HMAC-SHA256 key over an empty message, base64-encoded.
func FeishuSignature(secret string, timestamp int64) string {
	digest := hmac.New(sha256.New, []byte(strconv.FormatInt(timestamp, 10)+"\n"+secret))
	return base64.StdEncoding.EncodeToString(digest.Sum(nil))
}

// feishuMessage renders an interactive card. Every user-supplied value goes in a
// plain_text element so rule or project names cannot inject Markdown or links. The
// title always contains "OpenRUM", so a bot guarded by that custom keyword accepts it.
func feishuMessage(notification Notification) map[string]any {
	template := "red"
	title := "OpenRUM 告警：" + notification.Title
	if notification.Kind == NotificationTest {
		template = "blue"
		title = "OpenRUM 测试消息"
	}
	elements := make([]any, 0, 5)
	if notification.Message != "" {
		elements = append(elements, map[string]any{"tag": "div", "text": plainText(notification.Message)})
	}
	if alert := notification.Alert; alert != nil {
		environment := alert.Environment
		if environment == "" {
			environment = "全部环境"
		}
		fields := []any{
			feishuField("项目", alert.ProjectName),
			feishuField("环境", environment),
			feishuField("指标", alert.MetricLabel),
			feishuField("统计窗口", fmt.Sprintf("最近 %d 分钟", alert.WindowMinutes)),
			feishuField("当前值", formatAlertValue(alert.Value, alert.Unit)),
			feishuField("阈值", comparatorSymbol(alert.Comparator)+" "+formatAlertValue(alert.Threshold, alert.Unit)),
		}
		elements = append(elements, map[string]any{"tag": "div", "fields": fields})
	}
	if notification.DeepLink != "" {
		elements = append(elements, map[string]any{"tag": "action", "actions": []any{map[string]any{
			"tag": "button", "type": "primary", "text": plainText("进入诊断"), "url": notification.DeepLink,
		}}})
	}
	elements = append(elements, map[string]any{"tag": "note", "elements": []any{
		plainText("OpenRUM · " + notification.OccurredAt.UTC().Format("2006-01-02 15:04 UTC")),
	}})
	return map[string]any{
		"msg_type": "interactive",
		"card": map[string]any{
			"config":   map[string]any{"wide_screen_mode": true},
			"header":   map[string]any{"template": template, "title": plainText(title)},
			"elements": elements,
		},
	}
}

func plainText(content string) map[string]any {
	return map[string]any{"tag": "plain_text", "content": content}
}

func feishuField(label, value string) map[string]any {
	return map[string]any{"is_short": true, "text": plainText(label + "：" + value)}
}

func comparatorSymbol(comparator string) string {
	if comparator == "gt" {
		return ">"
	}
	return "≥"
}

func formatAlertValue(value float64, unit string) string {
	formatted := strconv.FormatFloat(value, 'f', -1, 64)
	if strings.Contains(formatted, ".") && len(formatted) > 8 {
		formatted = strconv.FormatFloat(value, 'f', 2, 64)
	}
	switch unit {
	case "percent":
		return formatted + "%"
	case "ms":
		return formatted + " ms"
	default:
		return formatted
	}
}
