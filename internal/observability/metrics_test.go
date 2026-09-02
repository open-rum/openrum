package observability

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestMetricsHandlerUsesBoundedServiceLabels(t *testing.T) {
	request := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/metrics", nil)
	response := httptest.NewRecorder()

	NewMetricsHandler("api", "test").ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d", response.Code)
	}
	body := response.Body.String()
	if !strings.Contains(body, `openrum_service_info{environment="test",service="api"} 1`) {
		t.Fatalf("service info metric missing from response:\n%s", body)
	}
	if strings.Contains(body, "request_id") || strings.Contains(body, "path=") {
		t.Fatal("metrics response contains an unbounded request label")
	}
}
