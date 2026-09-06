package health

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"openrum/internal/config"
)

const defaultReadinessTimeout = 2 * time.Second

type Check func(context.Context) error

type Manager struct {
	checks  map[string]Check
	timeout time.Duration
}

type response struct {
	Status string                   `json:"status"`
	Checks map[string]checkResponse `json:"checks,omitempty"`
}

type checkResponse struct {
	Status string `json:"status"`
}

type checkResult struct {
	name string
	err  error
}

func NewManager(checks map[string]Check, timeout time.Duration) *Manager {
	if timeout <= 0 {
		timeout = defaultReadinessTimeout
	}
	ownedChecks := make(map[string]Check, len(checks))
	for name, check := range checks {
		ownedChecks[name] = check
	}
	return &Manager{checks: ownedChecks, timeout: timeout}
}

func (manager *Manager) LiveHandler() http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writeJSON(writer, http.StatusOK, response{Status: "ok"})
	})
}

func (manager *Manager) ReadyHandler() http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		ctx, cancel := context.WithTimeout(request.Context(), manager.timeout)
		defer cancel()

		checks := make(map[string]checkResponse, len(manager.checks))
		results := make(chan checkResult, len(manager.checks))
		names := make([]string, 0, len(manager.checks))
		for name := range manager.checks {
			names = append(names, name)
		}
		sort.Strings(names)
		for _, name := range names {
			check := manager.checks[name]
			go func() {
				results <- checkResult{name: name, err: check(ctx)}
			}()
		}

		ready := true
		for range names {
			select {
			case result := <-results:
				status := "ok"
				if result.err != nil {
					ready = false
					status = "unavailable"
				}
				checks[result.name] = checkResponse{Status: status}
			case <-ctx.Done():
				for _, name := range names {
					if _, checked := checks[name]; !checked {
						checks[name] = checkResponse{Status: "unavailable"}
					}
				}
				writeJSON(writer, http.StatusServiceUnavailable, response{Status: "unavailable", Checks: checks})
				return
			}
		}

		if !ready {
			writeJSON(writer, http.StatusServiceUnavailable, response{Status: "unavailable", Checks: checks})
			return
		}
		writeJSON(writer, http.StatusOK, response{Status: "ok", Checks: checks})
	})
}

// ChecksForConfig builds a fixed dependency set per binary. TCP connectivity is
// deliberately shallow: repository clients perform protocol-level checks once
// their connection pools are constructed, while this foundation still detects
// unreachable dependencies without exposing credentials in health responses.
func ChecksForConfig(configuration config.Config) (map[string]Check, error) {
	checks := make(map[string]Check)
	addURLCheck := func(name, rawURL, defaultPort string) error {
		address, err := addressFromURL(rawURL, defaultPort)
		if err != nil {
			return fmt.Errorf("configure %s readiness check: %w", name, err)
		}
		checks[name] = TCPCheck(address)
		return nil
	}

	switch configuration.Service {
	case config.ServiceAPI:
		if err := addURLCheck("postgres", configuration.PostgresDSN, "5432"); err != nil {
			return nil, err
		}
		if err := addURLCheck("clickhouse", configuration.ClickHouseDSN, "9000"); err != nil {
			return nil, err
		}
		checks["kafka"] = AnyTCPCheck(configuration.KafkaBrokers)
		checks["redis"] = TCPCheck(configuration.RedisAddress)
	case config.ServiceIngest:
		if err := addURLCheck("postgres", configuration.PostgresDSN, "5432"); err != nil {
			return nil, err
		}
		checks["kafka"] = AnyTCPCheck(configuration.KafkaBrokers)
		checks["redis"] = TCPCheck(configuration.RedisAddress)
	case config.ServiceConsumer:
		if err := addURLCheck("clickhouse", configuration.ClickHouseDSN, "9000"); err != nil {
			return nil, err
		}
		checks["kafka"] = AnyTCPCheck(configuration.KafkaBrokers)
	case config.ServiceWorker:
		if err := addURLCheck("postgres", configuration.PostgresDSN, "5432"); err != nil {
			return nil, err
		}
		if err := addURLCheck("clickhouse", configuration.ClickHouseDSN, "9000"); err != nil {
			return nil, err
		}
		if configuration.ObjectStorageProvider != config.ObjectStorageProviderNone && configuration.ObjectStorageEndpoint != "" {
			if err := addURLCheck("object-storage", configuration.ObjectStorageEndpoint, defaultPortForEndpoint(configuration.ObjectStorageEndpoint)); err != nil {
				return nil, err
			}
		}
	default:
		return nil, fmt.Errorf("unsupported service %q", configuration.Service)
	}
	return checks, nil
}

func TCPCheck(address string) Check {
	return func(ctx context.Context) error {
		if strings.TrimSpace(address) == "" {
			return fmt.Errorf("empty dependency address")
		}
		connection, err := (&net.Dialer{}).DialContext(ctx, "tcp", address)
		if err != nil {
			return err
		}
		return connection.Close()
	}
}

func AnyTCPCheck(addresses []string) Check {
	return func(ctx context.Context) error {
		if len(addresses) == 0 {
			return fmt.Errorf("no dependency addresses")
		}
		var lastErr error
		for _, address := range addresses {
			if err := TCPCheck(address)(ctx); err == nil {
				return nil
			} else {
				lastErr = err
			}
		}
		return lastErr
	}
}

func addressFromURL(rawURL, defaultPort string) (string, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Hostname() == "" {
		return "", fmt.Errorf("invalid absolute URL")
	}
	port := parsed.Port()
	if port == "" {
		port = defaultPort
	}
	return net.JoinHostPort(parsed.Hostname(), port), nil
}

func defaultPortForEndpoint(rawURL string) string {
	parsed, err := url.Parse(rawURL)
	if err == nil && parsed.Scheme == "https" {
		return "443"
	}
	return "80"
}

func writeJSON(writer http.ResponseWriter, status int, payload response) {
	writer.Header().Set("Content-Type", "application/json; charset=utf-8")
	writer.Header().Set("Cache-Control", "no-store")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(payload)
}
