package servicehealth

import (
	"context"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
)

type heartbeatWriter struct {
	key string
	ttl time.Duration
}

func (writer *heartbeatWriter) Set(_ context.Context, key string, value interface{}, ttl time.Duration) *redis.StatusCmd {
	writer.key, writer.ttl = key, ttl
	if value != "alive" {
		return redis.NewStatusResult("", context.Canceled)
	}
	return redis.NewStatusResult("OK", nil)
}

func TestWorkerHeartbeatUsesInstanceKeyAndExpires(t *testing.T) {
	key := WorkerHeartbeatKey("https://rum.example.com/")
	if key != WorkerHeartbeatKey("https://rum.example.com") {
		t.Fatal("trailing slash changed heartbeat key")
	}
	if key == WorkerHeartbeatKey("https://other.example.com") {
		t.Fatal("different instances share a heartbeat key")
	}
	writer := &heartbeatWriter{}
	if err := WriteWorkerHeartbeat(context.Background(), writer, key); err != nil {
		t.Fatal(err)
	}
	if writer.key != key || writer.ttl != WorkerHeartbeatTTL || WorkerHeartbeatTTL <= WorkerHeartbeatInterval {
		t.Fatalf("heartbeat key=%q ttl=%s", writer.key, writer.ttl)
	}
}
