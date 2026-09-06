package httpx

import (
	"net/http"
	"strconv"
	"time"

	"github.com/prometheus/client_golang/prometheus"
)

// HTTPMetrics records bounded server-side request dimensions. Route patterns
// are used instead of raw paths so project IDs and other user input never
// become Prometheus labels.
type HTTPMetrics struct {
	requests *prometheus.CounterVec
	duration *prometheus.HistogramVec
}

func NewHTTPMetrics(registerer interface {
	Register(...prometheus.Collector) error
}) (*HTTPMetrics, error) {
	requests := prometheus.NewCounterVec(prometheus.CounterOpts{
		Namespace: "openrum", Subsystem: "http", Name: "requests_total",
		Help: "HTTP requests by method, matched route pattern and status class.",
	}, []string{"method", "route", "status_class"})
	duration := prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Namespace: "openrum", Subsystem: "http", Name: "request_duration_seconds",
		Help:    "HTTP request duration by method and matched route pattern.",
		Buckets: []float64{0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10},
	}, []string{"method", "route"})
	if err := registerer.Register(requests, duration); err != nil {
		return nil, err
	}
	return &HTTPMetrics{requests: requests, duration: duration}, nil
}

func (metrics *HTTPMetrics) Observe(request *http.Request, status int, elapsed time.Duration) {
	route := request.Pattern
	if route == "" {
		route = "unmatched"
	}
	method := request.Method
	if method == "" {
		method = "UNKNOWN"
	}
	statusClass := strconv.Itoa(status/100) + "xx"
	metrics.requests.WithLabelValues(method, route, statusClass).Inc()
	metrics.duration.WithLabelValues(method, route).Observe(elapsed.Seconds())
}
