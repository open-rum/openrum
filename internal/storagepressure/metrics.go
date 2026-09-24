package storagepressure

import "github.com/prometheus/client_golang/prometheus"

type metricsRegisterer interface {
	Register(...prometheus.Collector) error
}

func RegisterMetrics(registerer metricsRegisterer, monitor *Monitor) error {
	backend := prometheus.Labels{"backend": "clickhouse"}
	freeRatio := prometheus.NewGaugeFunc(prometheus.GaugeOpts{
		Namespace: "openrum", Subsystem: "storage", Name: "free_ratio",
		Help: "Free storage ratio reported by the backend; -1 means unavailable.", ConstLabels: backend,
	}, func() float64 {
		snapshot := monitor.Snapshot()
		if !snapshot.ProbeSuccessful || snapshot.CapacityBytes == 0 {
			return -1
		}
		return snapshot.FreeRatio
	})
	probe := prometheus.NewGaugeFunc(prometheus.GaugeOpts{
		Namespace: "openrum", Subsystem: "storage", Name: "capacity_probe_success",
		Help: "Whether the most recent backend capacity probe succeeded.", ConstLabels: backend,
	}, func() float64 {
		if monitor.Snapshot().ProbeSuccessful {
			return 1
		}
		return 0
	})
	guard := prometheus.NewGaugeFunc(prometheus.GaugeOpts{
		Namespace: "openrum", Subsystem: "storage", Name: "pressure_guard_active",
		Help: "Whether storage pressure is currently applying emergency Browser SDK sampling.", ConstLabels: backend,
	}, func() float64 {
		if monitor.Snapshot().AutomaticSamplingActive {
			return 1
		}
		return 0
	})
	hardStop := prometheus.NewGaugeFunc(prometheus.GaugeOpts{
		Namespace: "openrum", Subsystem: "storage", Name: "ingest_hard_stop_active",
		Help: "Whether ClickHouse storage pressure is currently stopping Ingest writes.", ConstLabels: backend,
	}, func() float64 {
		if monitor.Snapshot().IngestBlocked {
			return 1
		}
		return 0
	})
	return registerer.Register(freeRatio, probe, guard, hardStop)
}
