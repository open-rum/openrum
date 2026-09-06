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
			if configuration.ObjectStorageProvider != ObjectStorageProviderNone {
				t.Fatalf("ObjectStorageProvider = %q, want optional storage disabled", configuration.ObjectStorageProvider)
			}
		})
	}
}

func TestLoadReportsAllMissingRequiredValues(t *testing.T) {
	_, err := load(ServiceIngest, mapLookup(map[string]string{}))
	if err == nil {
		t.Fatal("load() error = nil, want validation error")
	}
	for _, key := range []string{"APP_ENV", "KAFKA_BROKERS", "POSTGRES_DSN", "PUBLIC_BASE_URL", "REDIS_ADDR"} {
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
		"POSTGRES_DSN":    "postgres://openrum:test@localhost/openrum",
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

func TestLoadRequiresHTTPSInProduction(t *testing.T) {
	environment := map[string]string{
		"APP_ENV":         "production",
		"PUBLIC_BASE_URL": "http://rum.example.com",
		"KAFKA_BROKERS":   "localhost:9092",
		"REDIS_ADDR":      "localhost:6379",
		"POSTGRES_DSN":    "postgres://openrum:test@localhost/openrum",
	}
	_, err := load(ServiceIngest, mapLookup(environment))
	if err == nil || !strings.Contains(err.Error(), "https") {
		t.Fatalf("load() error=%v", err)
	}
}

func TestObjectStorageCredentialSourcesAndMaskedIdentity(t *testing.T) {
	base := map[string]string{
		"APP_ENV": "test", "PUBLIC_BASE_URL": "http://localhost:8080",
		"POSTGRES_DSN": "postgres://localhost/openrum", "CLICKHOUSE_DSN": "clickhouse://localhost/openrum",
		"KAFKA_BROKERS": "localhost:9092", "REDIS_ADDR": "localhost:6379",
		"OBJECT_STORAGE_PROVIDER": "oss", "OBJECT_STORAGE_REGION": "cn-hangzhou", "OBJECT_STORAGE_BUCKET": "openrum-test",
	}
	configuration, err := load(ServiceAPI, mapLookup(base))
	if err != nil {
		t.Fatal(err)
	}
	if configuration.ObjectStorageCredential != ObjectStorageCredentialRAMRole {
		t.Fatalf("source=%q", configuration.ObjectStorageCredential)
	}

	base["OSS_ACCESS_KEY_ID"] = "LTAI1234567890"
	base["OSS_ACCESS_KEY_SECRET"] = "secret-value"
	configuration, err = load(ServiceAPI, mapLookup(base))
	if err != nil {
		t.Fatal(err)
	}
	if configuration.ObjectStorageCredential != ObjectStorageCredentialEnvironment || configuration.ObjectStorageMaskedIdentity != "LTA••••7890" {
		t.Fatalf("source=%q identity=%q", configuration.ObjectStorageCredential, configuration.ObjectStorageMaskedIdentity)
	}
	base["KUBERNETES_SERVICE_HOST"] = "10.0.0.1"
	configuration, err = load(ServiceAPI, mapLookup(base))
	if err != nil || configuration.ObjectStorageCredential != ObjectStorageCredentialKubernetesSecret {
		t.Fatalf("source=%q err=%v", configuration.ObjectStorageCredential, err)
	}

	delete(base, "OSS_ACCESS_KEY_ID")
	delete(base, "OSS_ACCESS_KEY_SECRET")
	delete(base, "KUBERNETES_SERVICE_HOST")
	base["OBJECT_STORAGE_PROVIDER"] = "s3"
	base["AWS_ACCESS_KEY_ID"] = "AKIA1234567890"
	base["AWS_SECRET_ACCESS_KEY"] = "secret-value"
	configuration, err = load(ServiceAPI, mapLookup(base))
	if err != nil || configuration.ObjectStorageCredential != ObjectStorageCredentialEnvironment || configuration.ObjectStorageMaskedIdentity != "AKI••••7890" {
		t.Fatalf("source=%q identity=%q err=%v", configuration.ObjectStorageCredential, configuration.ObjectStorageMaskedIdentity, err)
	}
}

func TestObjectStorageRejectsPartialCredentialsAndUnsafeProductionEndpoint(t *testing.T) {
	base := map[string]string{
		"APP_ENV": "production", "PUBLIC_BASE_URL": "https://rum.example.com",
		"POSTGRES_DSN": "postgres://localhost/openrum", "CLICKHOUSE_DSN": "clickhouse://localhost/openrum",
		"KAFKA_BROKERS": "localhost:9092", "REDIS_ADDR": "localhost:6379",
		"OBJECT_STORAGE_PROVIDER": "oss", "OBJECT_STORAGE_REGION": "cn-hangzhou", "OBJECT_STORAGE_BUCKET": "openrum-test",
	}
	base["OSS_ACCESS_KEY_ID"] = "only-id"
	if _, err := load(ServiceAPI, mapLookup(base)); err == nil || !strings.Contains(err.Error(), "configured together") {
		t.Fatalf("partial credentials err=%v", err)
	}
	delete(base, "OSS_ACCESS_KEY_ID")
	base["OBJECT_STORAGE_ENDPOINT"] = "http://127.0.0.1:9000"
	if _, err := load(ServiceAPI, mapLookup(base)); err == nil || !strings.Contains(err.Error(), "https") {
		t.Fatalf("insecure endpoint err=%v", err)
	}
	base["OBJECT_STORAGE_ENDPOINT"] = "https://storage.example.com"
	if _, err := load(ServiceAPI, mapLookup(base)); err == nil || !strings.Contains(err.Error(), "ALLOWLIST") {
		t.Fatalf("custom endpoint err=%v", err)
	}
	base["OPENRUM_OBJECT_STORAGE_ENDPOINT_ALLOWLIST"] = "storage.example.com"
	if _, err := load(ServiceAPI, mapLookup(base)); err != nil {
		t.Fatalf("allowlisted endpoint err=%v", err)
	}
}

func TestObjectStorageProviderValidationAndLegacyOSSCompatibility(t *testing.T) {
	base := map[string]string{
		"APP_ENV": "test", "PUBLIC_BASE_URL": "http://localhost:8080",
		"POSTGRES_DSN": "postgres://localhost/openrum", "CLICKHOUSE_DSN": "clickhouse://localhost/openrum",
		"KAFKA_BROKERS": "localhost:9092", "REDIS_ADDR": "localhost:6379",
	}
	base["OBJECT_STORAGE_PROVIDER"] = "azure"
	if _, err := load(ServiceAPI, mapLookup(base)); err == nil || !strings.Contains(err.Error(), "OBJECT_STORAGE_PROVIDER") {
		t.Fatalf("provider err=%v", err)
	}
	base["OBJECT_STORAGE_PROVIDER"] = "s3"
	if _, err := load(ServiceAPI, mapLookup(base)); err == nil || !strings.Contains(err.Error(), "OBJECT_STORAGE_BUCKET") {
		t.Fatalf("partial configuration err=%v", err)
	}
	delete(base, "OBJECT_STORAGE_PROVIDER")
	base["OSS_REGION"], base["OSS_BUCKET"] = "cn-hangzhou", "legacy-bucket"
	configuration, err := load(ServiceAPI, mapLookup(base))
	if err != nil || configuration.ObjectStorageProvider != ObjectStorageProviderOSS || configuration.ObjectStorageBucket != "legacy-bucket" {
		t.Fatalf("configuration=%+v err=%v", configuration, err)
	}
}

func TestManagedSecretsRequireExplicitOptInAndExternalKey(t *testing.T) {
	base := map[string]string{
		"APP_ENV": "test", "PUBLIC_BASE_URL": "http://localhost:8080",
		"POSTGRES_DSN": "postgres://localhost/openrum", "CLICKHOUSE_DSN": "clickhouse://localhost/openrum",
		"KAFKA_BROKERS": "localhost:9092", "REDIS_ADDR": "localhost:6379",
	}
	base["OPENRUM_ALLOW_MANAGED_SECRETS"] = "true"
	if _, err := load(ServiceAPI, mapLookup(base)); err == nil {
		t.Fatal("managed secrets accepted without master key")
	}
	base["OPENRUM_MASTER_KEY"] = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="
	base["OPENRUM_MASTER_KEY_ID"] = "rotation-2"
	configuration, err := load(ServiceAPI, mapLookup(base))
	if err != nil {
		t.Fatal(err)
	}
	if !configuration.AllowManagedSecrets || configuration.ManagedSecretsKeyID != "rotation-2" || len(configuration.ManagedSecretsMasterKey) != 32 {
		t.Fatalf("managed secret configuration not loaded safely: %#v", configuration)
	}
}

func mapLookup(values map[string]string) lookupEnv {
	return func(key string) (string, bool) {
		value, ok := values[key]
		return value, ok
	}
}
