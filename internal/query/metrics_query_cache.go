package query

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	metricsCachePrefix = "openrum:metrics-query:v1:"
	metricsCacheTTL    = 15 * time.Second
)

// MetricsCache holds catalog results briefly. The version is the project's latest
// queryable instant, so newly queryable data changes the key instead of waiting out the TTL.
type MetricsCache struct {
	client overviewCacheRedis
	ttl    time.Duration
}

func NewMetricsCache(client overviewCacheRedis) *MetricsCache {
	return &MetricsCache{client: client, ttl: metricsCacheTTL}
}

func (cache *MetricsCache) Get(ctx context.Context, query MetricsQuery, version time.Time) (MetricsResult, bool, error) {
	key, err := metricsCacheKey(query, version)
	if err != nil {
		return MetricsResult{}, false, err
	}
	payload, err := cache.client.Get(ctx, key).Bytes()
	if errors.Is(err, redis.Nil) {
		return MetricsResult{}, false, nil
	}
	if err != nil {
		return MetricsResult{}, false, fmt.Errorf("read metrics cache: %w", err)
	}
	var value MetricsResult
	if err := json.Unmarshal(payload, &value); err != nil {
		return MetricsResult{}, false, fmt.Errorf("decode metrics cache: %w", err)
	}
	return value, true, nil
}

func (cache *MetricsCache) Set(ctx context.Context, query MetricsQuery, version time.Time, value MetricsResult) error {
	key, err := metricsCacheKey(query, version)
	if err != nil {
		return err
	}
	payload, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("encode metrics cache: %w", err)
	}
	if err := cache.client.Set(ctx, key, payload, cache.ttl).Err(); err != nil {
		return fmt.Errorf("write metrics cache: %w", err)
	}
	return nil
}

// MetricsCacheKey is exported so identical in-flight requests can share one query.
func MetricsCacheKey(query MetricsQuery, version time.Time) (string, error) {
	return metricsCacheKey(query, version)
}

func metricsCacheKey(requested MetricsQuery, version time.Time) (string, error) {
	query, err := NormalizeMetricsQuery(requested)
	if err != nil {
		return "", err
	}
	canonical := query.ProjectID.String() + "\n" + query.From.Format(time.RFC3339Nano) + "\n" +
		query.To.Format(time.RFC3339Nano) + "\n" + query.Environment + "\n" + strconv.Itoa(query.MaxPoints) + "\n" +
		strconv.FormatInt(version.UTC().UnixMilli(), 10) + "\n" + query.Spec.Canonical()
	digest := sha256.Sum256([]byte(canonical))
	return metricsCachePrefix + hex.EncodeToString(digest[:]), nil
}
