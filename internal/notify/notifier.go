package notify

import (
	"context"
	"errors"
	"fmt"
	"time"
)

type Notification struct {
	ID         string            `json:"id"`
	Title      string            `json:"title"`
	Message    string            `json:"message"`
	Severity   string            `json:"severity"`
	ProjectID  string            `json:"projectId"`
	DeepLink   string            `json:"deepLink"`
	OccurredAt time.Time         `json:"occurredAt"`
	Attributes map[string]string `json:"attributes,omitempty"`
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
