package notify

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

var publicResolver = fixtureResolver{addresses: []net.IP{net.ParseIP("93.184.216.34")}}

const feishuHook = "https://open.feishu.cn/open-apis/bot/v2/hook/0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0"

// The vector is computed independently from the documented algorithm: the key is
// "timestamp\nsecret" and the HMAC-SHA256 digest of an empty message is base64-encoded.
func TestFeishuSignatureFollowsTheBotAlgorithm(t *testing.T) {
	if got := FeishuSignature("demo", 1599360473); got != "l1N0gAcBjdwBvGm1xMjOF0XSyaLRpR7tuO5dHfhAYc8=" {
		t.Fatalf("signature=%s", got)
	}
}

func TestFeishuAcceptsOnlyBotHookAddresses(t *testing.T) {
	for _, valid := range []string{feishuHook, "https://open.larksuite.com/open-apis/bot/v2/hook/abc"} {
		if _, err := ParseFeishuWebhookURL(valid); err != nil {
			t.Errorf("%s: %v", valid, err)
		}
	}
	for _, invalid := range []string{
		"http://open.feishu.cn/open-apis/bot/v2/hook/abc",
		"https://evil.example.com/open-apis/bot/v2/hook/abc",
		"https://open.feishu.cn.evil.example.com/open-apis/bot/v2/hook/abc",
		"https://open.feishu.cn/open-apis/bot/v2/hook/",
		"https://open.feishu.cn/open-apis/other/abc",
		"https://open.feishu.cn:8443/open-apis/bot/v2/hook/abc",
		"https://open.feishu.cn/open-apis/bot/v2/hook/abc?x=1",
		"https://user@open.feishu.cn/open-apis/bot/v2/hook/abc",
		"https://open.feishu.cn/open-apis/bot/v2/hook/a/b",
	} {
		if _, err := ParseFeishuWebhookURL(invalid); err == nil {
			t.Errorf("%s: expected rejection", invalid)
		}
	}
}

func feishuTestNotifier(t *testing.T, secret string, respond func(body map[string]any) (int, string)) (*FeishuNotifier, *atomic.Int32) {
	t.Helper()
	notifier, err := NewFeishuNotifier(FeishuConfig{WebhookURL: feishuHook, Secret: secret}, publicResolver)
	if err != nil {
		t.Fatal(err)
	}
	var attempts atomic.Int32
	notifier.client = &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		attempts.Add(1)
		var body map[string]any
		raw, _ := io.ReadAll(request.Body)
		if err := json.Unmarshal(raw, &body); err != nil {
			t.Fatalf("body is not JSON: %s", raw)
		}
		status, response := respond(body)
		return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(response)), Header: make(http.Header)}, nil
	})}
	notifier.now = func() time.Time { return time.Unix(1599360473, 0) }
	notifier.sleeper = func(context.Context, time.Duration) error { return nil }
	return notifier, &attempts
}

func alertNotification() Notification {
	return Notification{
		ID: "evaluation-1", Kind: NotificationAlert, Title: "错误率过高 [link](https://evil)",
		DeepLink: "https://rum.example.com/projects/p/issues", OccurredAt: time.Date(2026, 9, 29, 10, 0, 0, 0, time.UTC),
		Alert: &AlertContext{RuleName: "错误率过高", ProjectName: "Web", Environment: "production", Metric: "error_rate",
			MetricLabel: "错误率", Comparator: "gte", Value: 3.5, Threshold: 2, Unit: "percent", WindowMinutes: 5},
	}
}

func TestFeishuSendsASignedInteractiveCard(t *testing.T) {
	var card map[string]any
	notifier, attempts := feishuTestNotifier(t, "demo", func(body map[string]any) (int, string) {
		if body["msg_type"] != "interactive" || body["timestamp"] != "1599360473" || body["sign"] != FeishuSignature("demo", 1599360473) {
			t.Fatalf("unexpected envelope: %v", body)
		}
		card = body["card"].(map[string]any)
		return http.StatusOK, `{"code":0,"msg":"success","data":{}}`
	})
	if err := notifier.Send(context.Background(), alertNotification()); err != nil {
		t.Fatal(err)
	}
	if attempts.Load() != 1 {
		t.Fatalf("attempts=%d", attempts.Load())
	}
	encoded, _ := json.Marshal(card)
	text := string(encoded)
	header := card["header"].(map[string]any)
	if header["template"] != "red" || !strings.Contains(text, "OpenRUM 告警") {
		t.Fatalf("alert header: %v", header)
	}
	for _, want := range []string{"项目：Web", "环境：production", "当前值：3.5%", "阈值：≥ 2%", "最近 5 分钟", "进入诊断", "https://rum.example.com/projects/p/issues"} {
		if !strings.Contains(text, want) {
			t.Errorf("card is missing %q: %s", want, text)
		}
	}
	// User-supplied names are plain text, never Markdown.
	if strings.Contains(text, "lark_md") {
		t.Fatalf("card must not render user input as markdown: %s", text)
	}
}

func TestFeishuTestMessageIsBlueAndUnsignedWithoutSecret(t *testing.T) {
	notifier, _ := feishuTestNotifier(t, "", func(body map[string]any) (int, string) {
		if _, signed := body["sign"]; signed {
			t.Fatal("a bot without a secret must not receive a signature")
		}
		header := body["card"].(map[string]any)["header"].(map[string]any)
		if header["template"] != "blue" {
			t.Fatalf("test header: %v", header)
		}
		return http.StatusOK, `{"StatusCode":0,"StatusMessage":"success"}`
	})
	if err := notifier.Send(context.Background(), Notification{Kind: NotificationTest, Message: "测试"}); err != nil {
		t.Fatal(err)
	}
}

func TestFeishuReadsErrorsFromA200Body(t *testing.T) {
	for _, current := range []struct {
		body      string
		code      string
		wantTries int32
	}{
		{`{"code":19021,"msg":"sign match fail or timestamp is not within one hour from current time"}`, "feishu_sign_invalid", 1},
		{`{"code":19024,"msg":"Key Words Not Found"}`, "feishu_keyword_mismatch", 1},
		{`{"code":19022,"msg":"Ip Not Allowed"}`, "feishu_ip_not_allowed", 1},
		{`{"code":11232,"msg":"frequency limited"}`, "feishu_rate_limited", 3},
		{`{"code":12345,"msg":"other"}`, "feishu_rejected", 1},
		{`not json`, "feishu_bad_response", 1},
	} {
		notifier, attempts := feishuTestNotifier(t, "", func(map[string]any) (int, string) { return http.StatusOK, current.body })
		err := notifier.Send(context.Background(), alertNotification())
		if err == nil || ErrorCode(err) != current.code || attempts.Load() != current.wantTries {
			t.Errorf("%s: err=%v code=%s attempts=%d", current.body, err, ErrorCode(err), attempts.Load())
		}
	}
}

func TestFeishuRetriesServerErrorsAndStopsOnClientErrors(t *testing.T) {
	var calls atomic.Int32
	notifier, attempts := feishuTestNotifier(t, "", func(map[string]any) (int, string) {
		if calls.Add(1) < 3 {
			return http.StatusBadGateway, ""
		}
		return http.StatusOK, `{"code":0}`
	})
	if err := notifier.Send(context.Background(), alertNotification()); err != nil || attempts.Load() != 3 {
		t.Fatalf("err=%v attempts=%d", err, attempts.Load())
	}
	notifier, attempts = feishuTestNotifier(t, "", func(map[string]any) (int, string) { return http.StatusNotFound, "" })
	if err := notifier.Send(context.Background(), alertNotification()); ErrorCode(err) != "http_404" || attempts.Load() != 1 {
		t.Fatalf("err=%v attempts=%d", err, attempts.Load())
	}
}

func TestChannelKindsNormalizeAndKeepWriteOnlySecrets(t *testing.T) {
	ctx := context.Background()
	feishu, ok := LookupKind("feishu")
	if !ok {
		t.Fatal("feishu is registered")
	}
	stored, err := feishu.Normalize(ctx, map[string]string{"webhookUrl": " " + feishuHook + " ", "secret": "s3cret"}, nil, publicResolver)
	if err != nil || stored["webhookUrl"] != feishuHook || stored["secret"] != "s3cret" {
		t.Fatalf("stored=%v err=%v", stored, err)
	}
	kept, err := feishu.Normalize(ctx, map[string]string{"webhookUrl": ""}, stored, publicResolver)
	if err != nil || kept["secret"] != "s3cret" || kept["webhookUrl"] != feishuHook {
		t.Fatalf("a blank update must keep stored values: %v %v", kept, err)
	}
	cleared, err := feishu.Normalize(ctx, map[string]string{"clearSecret": "true"}, stored, publicResolver)
	if err != nil || cleared["secret"] != "" {
		t.Fatalf("clearSecret must turn signing off: %v %v", cleared, err)
	}
	if _, err := feishu.Normalize(ctx, map[string]string{"webhookUrl": "https://hooks.example.com/x"}, nil, publicResolver); !errors.Is(err, ErrInvalidChannelConfig) {
		t.Fatalf("non-Feishu host: %v", err)
	}
	webhook, _ := LookupKind("webhook")
	private := fixtureResolver{addresses: []net.IP{net.ParseIP("10.0.0.8")}}
	if _, err := webhook.Normalize(ctx, map[string]string{"url": "https://internal.example.com/x", "secret": "0123456789abcdef"}, nil, private); !errors.Is(err, ErrInvalidChannelConfig) {
		t.Fatalf("a webhook resolving to a private address must be rejected when saved: %v", err)
	}
	if _, err := webhook.Normalize(ctx, map[string]string{"url": "https://hooks.example.com/x", "secret": "short"}, nil, publicResolver); !errors.Is(err, ErrInvalidChannelConfig) {
		t.Fatalf("short secret: %v", err)
	}
	for _, unsupported := range []string{"smtp", "dingtalk", "slack", "wecom"} {
		if _, ok := LookupKind(unsupported); ok {
			t.Errorf("%s has no delivery yet and must not be creatable", unsupported)
		}
	}
}
