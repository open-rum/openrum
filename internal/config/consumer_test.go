package config

import (
	"testing"
	"time"
)

func TestConsumerFlushInterval(t *testing.T) {
	for _, test := range []struct {
		raw   string
		want  time.Duration
		valid bool
	}{
		{"", 10 * time.Millisecond, true}, {"1ms", time.Millisecond, true}, {"50ms", 50 * time.Millisecond, true}, {"1s", time.Second, true},
		{"0s", 0, false}, {"2s", 0, false}, {"-1ms", 0, false}, {"500us", 0, false}, {"invalid", 0, false},
	} {
		t.Run(test.raw, func(t *testing.T) {
			env := map[string]string{"APP_ENV": "test", "PUBLIC_BASE_URL": "http://localhost:4173", "POSTGRES_DSN": "postgres://local/test", "CLICKHOUSE_DSN": "clickhouse://localhost/test", "KAFKA_BROKERS": "localhost:9092", "REDIS_ADDR": "localhost:6379", "OPENRUM_CONSUMER_FLUSH_INTERVAL": test.raw}
			cfg, err := load(ServiceConsumer, mapLookup(env))
			if (err == nil) != test.valid {
				t.Fatalf("load error=%v valid=%v", err, test.valid)
			}
			if test.valid && cfg.ConsumerFlushInterval != test.want {
				t.Fatalf("interval=%s want=%s", cfg.ConsumerFlushInterval, test.want)
			}
		})
	}
}

func TestConsumerWorkerCount(t *testing.T) {
	for _, test := range []struct {
		raw   string
		want  int
		valid bool
	}{
		{"", 4, true}, {"1", 1, true}, {"12", 12, true}, {"64", 64, true},
		{"0", 0, false}, {"65", 0, false}, {"-1", 0, false}, {"1.5", 0, false}, {"many", 0, false},
	} {
		t.Run(test.raw, func(t *testing.T) {
			env := map[string]string{"APP_ENV": "test", "PUBLIC_BASE_URL": "http://localhost:4173", "POSTGRES_DSN": "postgres://local/test", "CLICKHOUSE_DSN": "clickhouse://localhost/test", "KAFKA_BROKERS": "localhost:9092", "REDIS_ADDR": "localhost:6379", "OPENRUM_CONSUMER_WORKERS": test.raw}
			cfg, err := load(ServiceConsumer, mapLookup(env))
			if (err == nil) != test.valid {
				t.Fatalf("load error=%v valid=%v", err, test.valid)
			}
			if test.valid && cfg.ConsumerWorkers != test.want {
				t.Fatalf("workers=%d want=%d", cfg.ConsumerWorkers, test.want)
			}
		})
	}
}
