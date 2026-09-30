package servicehealth

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	WorkerHeartbeatInterval = 10 * time.Second
	WorkerHeartbeatTTL      = 30 * time.Second
)

type WorkerHeartbeatWriter interface {
	Set(context.Context, string, interface{}, time.Duration) *redis.StatusCmd
}

func WorkerHeartbeatKey(publicBaseURL string) string {
	sum := sha256.Sum256([]byte(strings.TrimRight(publicBaseURL, "/")))
	return "openrum:health:worker:" + hex.EncodeToString(sum[:12])
}

func WriteWorkerHeartbeat(ctx context.Context, writer WorkerHeartbeatWriter, key string) error {
	return writer.Set(ctx, key, "alive", WorkerHeartbeatTTL).Err()
}
