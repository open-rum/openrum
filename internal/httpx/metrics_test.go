package httpx

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/testutil"
	"github.com/rs/zerolog"
)

type metricRegisterer struct{ *prometheus.Registry }

func (registerer metricRegisterer) Register(collectors ...prometheus.Collector) error {
	for _, collector := range collectors {
		if err := registerer.Registry.Register(collector); err != nil {
			return err
		}
	}
	return nil
}

func TestRouterHTTPMetricsUseRoutePattern(t *testing.T) {
	registry := prometheus.NewRegistry()
	metrics, err := NewHTTPMetrics(metricRegisterer{registry})
	if err != nil {
		t.Fatal(err)
	}
	router := NewRouter(zerolog.Nop(), metrics)
	router.HandleFunc("GET /v1/projects/{projectID}", func(response http.ResponseWriter, _ *http.Request) {
		response.WriteHeader(503)
	})
	router.ServeHTTP(httptest.NewRecorder(), httptest.NewRequestWithContext(context.Background(), "GET", "/v1/projects/secret-project", nil))

	want := `# HELP openrum_http_requests_total HTTP requests by method, matched route pattern and status class.
# TYPE openrum_http_requests_total counter
openrum_http_requests_total{method="GET",route="GET /v1/projects/{projectID}",status_class="5xx"} 1
`
	if err := testutil.GatherAndCompare(registry, strings.NewReader(want), "openrum_http_requests_total"); err != nil {
		t.Fatal(err)
	}
}
