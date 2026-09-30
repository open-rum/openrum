package notify

import (
	"context"
	"errors"
	"fmt"
	"time"
)

// Notification is what every channel kind renders. The original fields keep their
// JSON names so existing webhook receivers stay compatible; Kind and Alert were added
// for channels such as Feishu that lay the context out as fields.
type Notification struct {
	ID         string            `json:"id"`
	Kind       string            `json:"kind"`
	Title      string            `json:"title"`
	Message    string            `json:"message"`
	Severity   string            `json:"severity"`
	ProjectID  string            `json:"projectId"`
	DeepLink   string            `json:"deepLink"`
	OccurredAt time.Time         `json:"occurredAt"`
	Attributes map[string]string `json:"attributes,omitempty"`
	Alert      *AlertContext     `json:"alert,omitempty"`
}

const (
	NotificationAlert = "alert"
	NotificationTest  = "test"
)

// AlertContext describes the breach behind an alert notification.
type AlertContext struct {
	RuleName      string  `json:"ruleName"`
	ProjectName   string  `json:"projectName"`
	Environment   string  `json:"environment"`
	Metric        string  `json:"metric"`
	MetricLabel   string  `json:"metricLabel"`
	Comparator    string  `json:"comparator"`
	Value         float64 `json:"value"`
	Threshold     float64 `json:"threshold"`
	Unit          string  `json:"unit"`
	WindowMinutes int     `json:"windowMinutes"`
}

// DeliveryError carries a short, fixed code that is safe to store and show. It never
// contains a response body, URL or secret.
type DeliveryError struct {
	Code string
	Err  error
}

func (err *DeliveryError) Error() string { return err.Code + ": " + err.Err.Error() }
func (err *DeliveryError) Unwrap() error { return err.Err }

// ErrorCode returns the stored code for a failed delivery.
func ErrorCode(err error) string {
	var delivery *DeliveryError
	if errors.As(err, &delivery) {
		return delivery.Code
	}
	if errors.Is(err, ErrUnsafeWebhookURL) {
		return "unsafe_url"
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "timeout"
	}
	return "delivery_failed"
}

type Notifier interface {
	Send(context.Context, Notification) error
}

type Sleeper func(context.Context, time.Duration) error

func retry(ctx context.Context, sleeper Sleeper, operation func() (bool, error)) error {
	if sleeper == nil {
		sleeper = sleep
	}
	var result error
	for attempt := 0; attempt < 3; attempt++ {
		retryable, err := operation()
		if err == nil {
			return nil
		}
		result = errors.Join(result, err)
		if !retryable || attempt == 2 {
			break
		}
		if err := sleeper(ctx, time.Duration(1<<attempt)*200*time.Millisecond); err != nil {
			return errors.Join(result, err)
		}
	}
	return fmt.Errorf("notification failed after retry policy: %w", result)
}

func sleep(ctx context.Context, duration time.Duration) error {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
