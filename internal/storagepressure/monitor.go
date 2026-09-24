package storagepressure

import (
	"context"
	"database/sql"
	"sync"
	"time"

	"openrum/internal/config"
)

type CapacityReader interface {
	Capacity(context.Context) (uint64, uint64, error)
}

type SQLCapacityReader struct{ Database *sql.DB }

func (reader SQLCapacityReader) Capacity(ctx context.Context) (uint64, uint64, error) {
	var total, free uint64
	err := reader.Database.QueryRowContext(ctx,
		"SELECT sum(total_space), sum(free_space) FROM system.disks").Scan(&total, &free)
	return total, free, err
}

type Snapshot struct {
	Mode                    string
	Level                   string
	UsedBytes               uint64
	FreeBytes               uint64
	CapacityBytes           uint64
	FreeRatio               float64
	AutomaticSamplingActive bool
	AutomaticSamplingRate   float64
	IngestBlocked           bool
	ObservedAt              time.Time
	LastError               string
	ProbeSuccessful         bool
}

type Monitor struct {
	reader CapacityReader
	config config.StoragePressureConfig
	now    func() time.Time

	mu       sync.RWMutex
	snapshot Snapshot
}

func NewMonitor(reader CapacityReader, configuration config.StoragePressureConfig) *Monitor {
	return &Monitor{
		reader: reader, config: configuration, now: time.Now,
		snapshot: Snapshot{Mode: "unknown", Level: "unknown", AutomaticSamplingRate: configuration.EmergencyRate},
	}
}

func (monitor *Monitor) Run(ctx context.Context) {
	monitor.Check(ctx)
	ticker := time.NewTicker(monitor.config.PollInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			monitor.Check(ctx)
		}
	}
}

func (monitor *Monitor) Check(ctx context.Context) {
	checkCtx, cancel := context.WithTimeout(ctx, min(5*time.Second, monitor.config.PollInterval/2))
	defer cancel()
	total, free, err := monitor.reader.Capacity(checkCtx)

	monitor.mu.Lock()
	defer monitor.mu.Unlock()
	if err != nil || total == 0 || free > total {
		monitor.snapshot.ProbeSuccessful = false
		if monitor.snapshot.IngestBlocked {
			monitor.snapshot.Mode = "blocked"
			monitor.snapshot.Level = "critical"
			monitor.snapshot.AutomaticSamplingActive = true
		} else {
			monitor.snapshot.Mode = "unknown"
			monitor.snapshot.Level = "unknown"
			lease := max(2*monitor.config.PollInterval, 2*time.Minute)
			if monitor.snapshot.ObservedAt.IsZero() || monitor.now().Sub(monitor.snapshot.ObservedAt) > lease {
				monitor.snapshot.AutomaticSamplingActive = false
			}
		}
		if err != nil {
			monitor.snapshot.LastError = err.Error()
		} else {
			monitor.snapshot.LastError = "ClickHouse returned invalid disk capacity"
		}
		return
	}

	freeRatio := float64(free) / float64(total)
	samplingActive := monitor.snapshot.AutomaticSamplingActive
	ingestBlocked := monitor.snapshot.IngestBlocked
	if monitor.config.Enabled {
		if ingestBlocked {
			if freeRatio > monitor.config.RecoveryFreeRatio {
				ingestBlocked = false
				samplingActive = false
			} else {
				samplingActive = true
			}
		} else if freeRatio <= monitor.config.HardStopFreeRatio {
			ingestBlocked = true
			samplingActive = true
		} else if freeRatio <= monitor.config.CriticalFreeRatio {
			samplingActive = true
		} else if freeRatio > monitor.config.RecoveryFreeRatio {
			samplingActive = false
		}
	} else {
		samplingActive = false
		ingestBlocked = false
	}
	mode := "normal"
	level := "normal"
	if ingestBlocked {
		mode = "blocked"
		level = "critical"
	} else if samplingActive {
		mode = "sampling"
		level = "warning"
	} else if freeRatio <= monitor.config.WarningFreeRatio {
		mode = "warning"
		level = "warning"
	}
	monitor.snapshot = Snapshot{
		Mode: mode, Level: level, UsedBytes: total - free, FreeBytes: free, CapacityBytes: total, FreeRatio: freeRatio,
		AutomaticSamplingActive: samplingActive, AutomaticSamplingRate: monitor.config.EmergencyRate,
		IngestBlocked: ingestBlocked,
		ObservedAt:    monitor.now().UTC(), ProbeSuccessful: true,
	}
}

func (monitor *Monitor) Snapshot() Snapshot {
	monitor.mu.RLock()
	defer monitor.mu.RUnlock()
	return monitor.snapshot
}

// EmergencySampling returns a short-lived cap while ordinary sampling pressure
// is fresh. A known hard stop instead stays at zero until a successful recovery
// observation, matching the Ingest circuit breaker.
func (monitor *Monitor) EmergencySampling(now time.Time) (float64, time.Time, bool) {
	snapshot := monitor.Snapshot()
	lease := max(2*monitor.config.PollInterval, 2*time.Minute)
	if snapshot.IngestBlocked {
		return 0, now.Add(lease), true
	}
	if !snapshot.AutomaticSamplingActive || snapshot.ObservedAt.IsZero() || now.Sub(snapshot.ObservedAt) > lease {
		return 0, time.Time{}, false
	}
	return monitor.config.EmergencyRate, now.Add(lease), true
}

// HardStop reports the latched Ingest circuit-breaker state. Once activated it
// remains closed until a successful capacity observation crosses the recovery
// threshold; a failed probe must not reopen writes into a known-full store.
func (monitor *Monitor) HardStop() bool {
	return monitor.Snapshot().IngestBlocked
}
