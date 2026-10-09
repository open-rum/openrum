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
	overviewCachePrefix = "openrum:overview:v1:"
	overviewCacheTTL    = 15 * time.Second
)

type overviewCacheRedis interface {
	Get(context.Context, string) *redis.StringCmd
	Set(context.Context, string, any, time.Duration) *redis.StatusCmd
}

type OverviewCache struct {
	client overviewCacheRedis
	ttl    time.Duration
}

func NewOverviewCache(client overviewCacheRedis) *OverviewCache {
	return &OverviewCache{client: client, ttl: overviewCacheTTL}
}

func (cache *OverviewCache) Get(ctx context.Context, filters OverviewFilters, version time.Time) (Overview, bool, error) {
	key, err := overviewCacheKey(filters, version)
	if err != nil {
		return Overview{}, false, err
	}
	payload, err := cache.client.Get(ctx, key).Bytes()
	if errors.Is(err, redis.Nil) {
		return Overview{}, false, nil
	}
	if err != nil {
		return Overview{}, false, fmt.Errorf("read overview cache: %w", err)
	}
	var value Overview
	if err := json.Unmarshal(payload, &value); err != nil {
		return Overview{}, false, fmt.Errorf("decode overview cache: %w", err)
	}
	return value, true, nil
}

func (cache *OverviewCache) Set(ctx context.Context, filters OverviewFilters, version time.Time, value Overview) error {
	key, err := overviewCacheKey(filters, version)
	if err != nil {
		return err
	}
	payload, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("encode overview cache: %w", err)
	}
	if err := cache.client.Set(ctx, key, payload, cache.ttl).Err(); err != nil {
		return fmt.Errorf("write overview cache: %w", err)
	}
	return nil
}

func overviewCacheKey(requested OverviewFilters, version time.Time) (string, error) {
	filters, err := NormalizeOverviewFilters(requested)
	if err != nil {
		return "", err
	}
	canonical := filters.ProjectID.String() + "\n" + filters.From.Format(time.RFC3339Nano) + "\n" +
		filters.To.Format(time.RFC3339Nano) + "\n" + filters.Environment + "\n" + filters.Release + "\n" +
		filters.Route + "\n" + strconv.Itoa(filters.MaxPoints) + "\n" + strconv.FormatInt(version.UTC().UnixMilli(), 10)
	digest := sha256.Sum256([]byte(canonical))
	return overviewCachePrefix + hex.EncodeToString(digest[:]), nil
}
