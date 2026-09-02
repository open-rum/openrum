package config

import (
	"fmt"
	"net/url"
	"os"
	"sort"
	"strings"
	"time"
)

type Service string

const (
	ServiceAPI      Service = "api"
	ServiceIngest   Service = "ingest"
	ServiceConsumer Service = "consumer"
	ServiceWorker   Service = "worker"
)

type Config struct {
	Service         Service
	AppEnv          string
	PublicBaseURL   *url.URL
	ListenAddress   string
	ShutdownTimeout time.Duration
	PostgresDSN     string
	ClickHouseDSN   string
	KafkaBrokers    []string
	KafkaEventTopic string
	RedisAddress    string
	OSSEndpoint     string
	OSSBucket       string
	BootstrapToken  string
}

type lookupEnv func(string) (string, bool)

var serviceDefaults = map[Service]string{
	ServiceAPI:      ":8080",
	ServiceIngest:   ":8081",
	ServiceConsumer: ":8082",
	ServiceWorker:   ":8083",
}

var serviceRequirements = map[Service][]string{
	ServiceAPI:      {"POSTGRES_DSN", "CLICKHOUSE_DSN", "REDIS_ADDR"},
	ServiceIngest:   {"POSTGRES_DSN", "KAFKA_BROKERS", "REDIS_ADDR"},
	ServiceConsumer: {"CLICKHOUSE_DSN", "KAFKA_BROKERS"},
	ServiceWorker:   {"POSTGRES_DSN", "CLICKHOUSE_DSN", "OSS_ENDPOINT", "OSS_BUCKET"},
}

func Load(service Service) (Config, error) {
	return load(service, os.LookupEnv)
}

func load(service Service, lookup lookupEnv) (Config, error) {
	defaultAddress, knownService := serviceDefaults[service]
	if !knownService {
		return Config{}, fmt.Errorf("unknown service %q", service)
	}

	values := func(key string) string {
		value, _ := lookup(key)
		return strings.TrimSpace(value)
	}

	missing := make([]string, 0)
	required := append([]string{"APP_ENV", "PUBLIC_BASE_URL"}, serviceRequirements[service]...)
	for _, key := range required {
		if values(key) == "" {
			missing = append(missing, key)
		}
	}
	if len(missing) > 0 {
		sort.Strings(missing)
		return Config{}, fmt.Errorf("missing required environment variables: %s", strings.Join(missing, ", "))
	}

	appEnv := values("APP_ENV")
	if !isSupportedEnvironment(appEnv) {
		return Config{}, fmt.Errorf("APP_ENV must be one of development, test, staging, production; got %q", appEnv)
	}

	publicBaseURL, err := url.ParseRequestURI(values("PUBLIC_BASE_URL"))
	if err != nil || publicBaseURL.Host == "" || (publicBaseURL.Scheme != "http" && publicBaseURL.Scheme != "https") {
		return Config{}, fmt.Errorf("PUBLIC_BASE_URL must be an absolute http(s) URL")
	}
	if appEnv == "production" && publicBaseURL.Scheme != "https" {
		return Config{}, fmt.Errorf("PUBLIC_BASE_URL must use https in production")
	}

	shutdownTimeout := 10 * time.Second
	if raw := values("SHUTDOWN_TIMEOUT"); raw != "" {
		shutdownTimeout, err = time.ParseDuration(raw)
		if err != nil || shutdownTimeout <= 0 {
			return Config{}, fmt.Errorf("SHUTDOWN_TIMEOUT must be a positive duration")
		}
	}

	listenAddress := values(strings.ToUpper(string(service)) + "_HTTP_ADDR")
	if listenAddress == "" {
		listenAddress = defaultAddress
	}

	topic := values("KAFKA_EVENT_TOPIC")
	if topic == "" {
		topic = "rum-events-v1"
	}

	return Config{
		Service:         service,
		AppEnv:          appEnv,
		PublicBaseURL:   publicBaseURL,
		ListenAddress:   listenAddress,
		ShutdownTimeout: shutdownTimeout,
		PostgresDSN:     values("POSTGRES_DSN"),
		ClickHouseDSN:   values("CLICKHOUSE_DSN"),
		KafkaBrokers:    splitCommaSeparated(values("KAFKA_BROKERS")),
		KafkaEventTopic: topic,
		RedisAddress:    values("REDIS_ADDR"),
		OSSEndpoint:     values("OSS_ENDPOINT"),
		OSSBucket:       values("OSS_BUCKET"),
		BootstrapToken:  values("BOOTSTRAP_TOKEN"),
	}, nil
}

func isSupportedEnvironment(value string) bool {
	switch value {
	case "development", "test", "staging", "production":
		return true
	default:
		return false
	}
}

func splitCommaSeparated(value string) []string {
	if value == "" {
		return nil
	}
	parts := strings.Split(value, ",")
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			result = append(result, trimmed)
		}
	}
	return result
}
