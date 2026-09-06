package internal

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"

	"openrum/internal/metadata"
)

type fixtureRules struct{ rules []metadata.AlertRule }

func (fixture fixtureRules) ListEnabled(context.Context) ([]metadata.AlertRule, error) {
	return fixture.rules, nil
}

type fixtureMetric struct{ value float64 }

func (fixture fixtureMetric) Read(context.Context, metadata.AlertRule, AlertWindow) (float64, error) {
	return fixture.value, nil
}

type fixtureHistory struct {
	mutex   sync.Mutex
	windows map[string]bool
}

func (fixture *fixtureHistory) Record(_ context.Context, _ metadata.AlertRule, evaluation AlertEvaluation) (bool, error) {
	fixture.mutex.Lock()
	defer fixture.mutex.Unlock()
	key := evaluation.RuleID.String() + evaluation.Window.StartedAt.String()
	if fixture.windows[key] {
		return false, nil
	}
	fixture.windows[key] = true
	return evaluation.Status == "breached", nil
}

func (*fixtureHistory) MarkNotified(context.Context, uuid.UUID, AlertWindow, time.Time) error {
	return nil
}

type fixtureDispatcher struct{ count atomic.Int32 }

func (fixture *fixtureDispatcher) Dispatch(context.Context, metadata.AlertRule, AlertWindow, float64) error {
	fixture.count.Add(1)
	return nil
}

type sharedLeader struct{ held atomic.Bool }

func (leader *sharedLeader) TryAcquire(context.Context) (AlertLeaderLease, bool, error) {
	if !leader.held.CompareAndSwap(false, true) {
		return nil, false, nil
	}
	return fixtureLease{close: func() { leader.held.Store(false) }}, true, nil
}

type fixtureLease struct{ close func() }

func (fixture fixtureLease) Close() error { fixture.close(); return nil }

func TestTwoAlertSchedulersProduceOneNotificationPerFixedWindow(t *testing.T) {
	rule := metadata.AlertRule{ID: uuid.New(), Comparator: "gte", Threshold: 10, WindowMinutes: 5, CooldownMinutes: 30}
	history := &fixtureHistory{windows: map[string]bool{}}
	dispatcher := &fixtureDispatcher{}
	now := time.Date(2026, 9, 3, 8, 7, 31, 0, time.UTC)
	shared := &sharedLeader{}
	makeScheduler := func() *AlertScheduler {
		evaluator := NewAlertEvaluator(fixtureRules{rules: []metadata.AlertRule{rule}}, fixtureMetric{value: 12}, history, dispatcher)
		evaluator.now = func() time.Time { return now }
		return NewAlertScheduler(shared, evaluator)
	}
	schedulers := []*AlertScheduler{makeScheduler(), makeScheduler()}
	var wait sync.WaitGroup
	for _, scheduler := range schedulers {
		wait.Add(1)
		go func() { defer wait.Done(); _ = scheduler.Tick(context.Background()) }()
	}
	wait.Wait()
	if got := dispatcher.count.Load(); got != 1 {
		t.Fatalf("notifications=%d", got)
	}
	window := fixedAlertWindow(now, 5*time.Minute)
	if !window.StartedAt.Equal(time.Date(2026, 9, 3, 8, 0, 0, 0, time.UTC)) || !window.EndedAt.Equal(time.Date(2026, 9, 3, 8, 5, 0, 0, time.UTC)) {
		t.Fatalf("window=%+v", window)
	}
}

func TestAlertComparatorBoundaries(t *testing.T) {
	if !alertBreached("gte", 10, 10) || alertBreached("gt", 10, 10) || !alertBreached("gt", 11, 10) {
		t.Fatal("unexpected comparator result")
	}
}
