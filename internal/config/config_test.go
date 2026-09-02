package config

import (
	"strings"
	"testing"
	"time"
)

func TestLoadValidConfigurationForEveryService(t *testing.T) {
	environment := map[string]string{
		"APP_ENV":         "test",
		"PUBLIC_BASE_URL": "http://127.0.0.1:8080",
		"POSTGRES_DSN":    "postgres://openrum:test@127.0.0.1/openrum",
		"CLICKHOUSE_DSN":  "clickhouse://127.0.0.1/openrum",
		"KAFKA_BROKERS":   "127.0.0.1:9092, 127.0.0.1:9093",
		"REDIS_ADDR":      "127.0.0.1:6379",
		"OSS_ENDPOINT":    "http://127.0.0.1:9000",
		"OSS_BUCKET":      "openrum-test",
	}
	lookup := mapLookup(environment)

	for _, service := range []Service{ServiceAPI, ServiceIngest, ServiceConsumer, ServiceWorker} {
		t.Run(string(service), func(t *testing.T) {
			configuration, err := load(service, lookup)
			if err != nil {
				t.Fatalf("load(%q) error = %v", service, err)
			}
			if configuration.Service != service {
				t.Fatalf("Service = %q, want %q", configuration.Service, service)
			}
			if configuration.ShutdownTimeout != 10*time.Second {
				t.Fatalf("ShutdownTimeout = %s, want 10s", configuration.ShutdownTimeout)
			}
			if configuration.KafkaEventTopic != "rum-events-v1" {
				t.Fatalf("KafkaEventTopic = %q, want rum-events-v1", configuration.KafkaEventTopic)
			}
		})
	}
}

func TestLoadReportsAllMissingRequiredValues(t *testing.T) {
	_, err := load(ServiceIngest, mapLookup(map[string]string{}))
	if err == nil {
		t.Fatal("load() error = nil, want validation error")
	}
	for _, key := range []string{"APP_ENV", "KAFKA_BROKERS", "PUBLIC_BASE_URL", "REDIS_ADDR"} {
		if !strings.Contains(err.Error(), key) {
			t.Errorf("error %q does not mention %s", err, key)
		}
	}
}

func TestLoadRejectsInvalidCommonValues(t *testing.T) {
	base := map[string]string{
		"APP_ENV":         "test",
		"PUBLIC_BASE_URL": "http://localhost:8080",
		"KAFKA_BROKERS":   "localhost:9092",
		"REDIS_ADDR":      "localhost:6379",
	}
	tests := []struct {
		name  string
		key   string
		value string
		want  string
	}{
		{name: "environment", key: "APP_ENV", value: "prod", want: "APP_ENV"},
		{name: "public URL", key: "PUBLIC_BASE_URL", value: "/relative", want: "PUBLIC_BASE_URL"},
		{name: "shutdown timeout", key: "SHUTDOWN_TIMEOUT", value: "forever", want: "SHUTDOWN_TIMEOUT"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			environment := make(map[string]string, len(base)+1)
			for key, value := range base {
				environment[key] = value
			}
			environment[test.key] = test.value
			_, err := load(ServiceIngest, mapLookup(environment))
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("load() error = %v, want error containing %q", err, test.want)
			}
		})
	}
}

func mapLookup(values map[string]string) lookupEnv {
	return func(key string) (string, bool) {
		value, ok := values[key]
		return value, ok
	}
}
