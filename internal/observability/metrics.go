package observability

import (
	"net/http"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

type MetricsRegistry struct {
	registry *prometheus.Registry
}

// NewMetricsRegistry returns an isolated registry for one service process.
// Labels are constant, low-cardinality deployment dimensions rather than
// request data. Service packages may register their bounded collectors here.
func NewMetricsRegistry(service, environment string) *MetricsRegistry {
	registry := prometheus.NewRegistry()
	serviceInfo := prometheus.NewGauge(prometheus.GaugeOpts{
		Namespace: "openrum",
		Subsystem: "service",
		Name:      "info",
		Help:      "Static information about the running OpenRUM service.",
		ConstLabels: prometheus.Labels{
			"service":     service,
			"environment": environment,
		},
	})
	serviceInfo.Set(1)
	registry.MustRegister(
		collectors.NewGoCollector(),
		collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}),
		serviceInfo,
	)
	return &MetricsRegistry{registry: registry}
}

func (metrics *MetricsRegistry) Register(collectors ...prometheus.Collector) error {
	for _, collector := range collectors {
		if err := metrics.registry.Register(collector); err != nil {
			return err
		}
	}
	return nil
}

func (metrics *MetricsRegistry) Handler() http.Handler {
	return promhttp.HandlerFor(metrics.registry, promhttp.HandlerOpts{
		ErrorHandling: promhttp.HTTPErrorOnError,
	})
}

func NewMetricsHandler(service, environment string) http.Handler {
	return NewMetricsRegistry(service, environment).Handler()
}
