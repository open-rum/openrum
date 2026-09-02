package health

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"openrum/internal/config"
)

func TestLiveHandlerIsIndependentOfDependencies(t *testing.T) {
	manager := NewManager(map[string]Check{
		"database": func(context.Context) error { return errors.New("secret DSN") },
	}, time.Second)
	response := serve(manager.LiveHandler())
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"status":"ok"`) {
		t.Fatalf("unexpected live response: %d %s", response.Code, response.Body.String())
	}
}

func TestReadyHandlerReportsDependencyStateWithoutLeakingErrors(t *testing.T) {
	manager := NewManager(map[string]Check{
		"clickhouse": func(context.Context) error { return nil },
		"postgres":   func(context.Context) error { return errors.New("postgres://admin:password@private") },
	}, time.Second)
	response := serve(manager.ReadyHandler())
	body := response.Body.String()
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, body = %s", response.Code, body)
	}
	if !strings.Contains(body, `"postgres":{"status":"unavailable"}`) {
		t.Fatalf("dependency state missing: %s", body)
	}
	if strings.Contains(body, "password") || strings.Contains(body, "private") {
		t.Fatalf("health response leaked internal error: %s", body)
	}
}

func TestReadyHandlerBoundsSlowChecks(t *testing.T) {
	manager := NewManager(map[string]Check{
		"slow": func(ctx context.Context) error {
			<-ctx.Done()
			return ctx.Err()
		},
	}, 20*time.Millisecond)
	started := time.Now()
	response := serve(manager.ReadyHandler())
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d", response.Code)
	}
	if elapsed := time.Since(started); elapsed > 250*time.Millisecond {
		t.Fatalf("readiness took %s", elapsed)
	}
}

func TestChecksForConfigUsesServiceDependencies(t *testing.T) {
	checks, err := ChecksForConfig(config.Config{
		Service:       config.ServiceAPI,
		PostgresDSN:   "postgres://localhost:5433/openrum",
		ClickHouseDSN: "clickhouse://localhost:9000/openrum",
		RedisAddress:  "localhost:6379",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(checks) != 3 || checks["postgres"] == nil || checks["clickhouse"] == nil || checks["redis"] == nil {
		t.Fatalf("unexpected checks: %#v", checks)
	}
}

func serve(handler http.Handler) *httptest.ResponseRecorder {
	request := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/health", nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}
