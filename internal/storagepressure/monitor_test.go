package storagepressure

import (
	"context"
	"errors"
	"testing"
	"time"

	"openrum/internal/config"
)

type capacityResult struct {
	total uint64
	free  uint64
	err   error
}

type fakeCapacityReader struct{ results []capacityResult }

func (reader *fakeCapacityReader) Capacity(context.Context) (uint64, uint64, error) {
	result := reader.results[0]
	reader.results = reader.results[1:]
	return result.total, result.free, result.err
}

func TestMonitorSamplesThenLatchesHardStopUntilRecovery(t *testing.T) {
	now := time.Date(2026, 9, 15, 9, 0, 0, 0, time.UTC)
	reader := &fakeCapacityReader{results: []capacityResult{
		{total: 1_000, free: 100}, {total: 1_000, free: 50},
		{total: 1_000, free: 90}, {total: 1_000, free: 101},
	}}
	monitor := NewMonitor(reader, config.StoragePressureConfig{
		Enabled: true, WarningFreeRatio: 0.15, CriticalFreeRatio: 0.10,
		HardStopFreeRatio: 0.05, RecoveryFreeRatio: 0.10,
		EmergencyRate: 0.05, PollInterval: 30 * time.Second,
	})
	monitor.now = func() time.Time { return now }

	monitor.Check(context.Background())
	snapshot := monitor.Snapshot()
	if snapshot.Mode != "sampling" || snapshot.Level != "warning" || !snapshot.AutomaticSamplingActive || snapshot.IngestBlocked {
		t.Fatalf("sampling snapshot=%+v", snapshot)
	}
	if rate, expiresAt, active := monitor.EmergencySampling(now); !active || rate != 0.05 || !expiresAt.Equal(now.Add(2*time.Minute)) {
		t.Fatalf("emergency rate=%v expires=%v active=%v", rate, expiresAt, active)
	}

	now = now.Add(time.Minute)
	monitor.Check(context.Background())
	if snapshot = monitor.Snapshot(); snapshot.Mode != "blocked" || snapshot.Level != "critical" || !snapshot.IngestBlocked {
		t.Fatalf("blocked snapshot=%+v", snapshot)
	}
	if rate, _, active := monitor.EmergencySampling(now); !active || rate != 0 {
		t.Fatalf("blocked emergency rate=%v active=%v", rate, active)
	}

	now = now.Add(time.Minute)
	monitor.Check(context.Background())
	if snapshot = monitor.Snapshot(); snapshot.Mode != "blocked" || !snapshot.IngestBlocked {
		t.Fatalf("hard stop was released before 90%% recovery: %+v", snapshot)
	}

	now = now.Add(time.Minute)
	monitor.Check(context.Background())
	if snapshot = monitor.Snapshot(); snapshot.Mode != "warning" || snapshot.AutomaticSamplingActive || snapshot.IngestBlocked {
		t.Fatalf("recovered snapshot=%+v", snapshot)
	}

	monitor.mu.Lock()
	monitor.snapshot.AutomaticSamplingActive = true
	monitor.snapshot.ObservedAt = now.Add(-3 * time.Minute)
	monitor.mu.Unlock()
	if _, _, active := monitor.EmergencySampling(now); active {
		t.Fatal("stale observation kept emergency sampling active")
	}
}

func TestMonitorReportsUnknownCapacity(t *testing.T) {
	monitor := NewMonitor(&fakeCapacityReader{results: []capacityResult{{err: errors.New("unavailable")}}},
		config.StoragePressureConfig{PollInterval: 30 * time.Second})
	monitor.Check(context.Background())
	if snapshot := monitor.Snapshot(); snapshot.Level != "unknown" || snapshot.LastError == "" || snapshot.ProbeSuccessful {
		t.Fatalf("snapshot=%+v", snapshot)
	}
}

func TestMonitorKeepsKnownHardStopClosedWhenCapacityProbeFails(t *testing.T) {
	reader := &fakeCapacityReader{results: []capacityResult{
		{total: 1_000, free: 40},
		{err: errors.New("unavailable")},
	}}
	monitor := NewMonitor(reader, config.StoragePressureConfig{
		Enabled: true, WarningFreeRatio: 0.15, CriticalFreeRatio: 0.10,
		HardStopFreeRatio: 0.05, RecoveryFreeRatio: 0.10,
		EmergencyRate: 0.10, PollInterval: 30 * time.Second,
	})
	monitor.Check(context.Background())
	monitor.Check(context.Background())

	snapshot := monitor.Snapshot()
	if snapshot.Mode != "blocked" || !snapshot.IngestBlocked || snapshot.ProbeSuccessful {
		t.Fatalf("snapshot=%+v", snapshot)
	}
}
