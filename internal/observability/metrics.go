package observability

import (
	"net/http"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// NewMetricsHandler returns an isolated registry for one service process. Labels
// are constant, low-cardinality deployment dimensions rather than request data.
func NewMetricsHandler(service, environment string) http.Handler {
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

	return promhttp.HandlerFor(registry, promhttp.HandlerOpts{
		ErrorHandling: promhttp.HTTPErrorOnError,
	})
}
