package query

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

func TestOverviewCacheKeysFiltersAndInvalidatesOnQueryableVersion(t *testing.T) {
	address := os.Getenv("TEST_REDIS_ADDR")
	if address == "" {
		t.Skip("TEST_REDIS_ADDR is not set")
	}
	client := redis.NewClient(&redis.Options{Addr: address, DB: 13})
	t.Cleanup(func() { _ = client.Close() })
	cache := NewOverviewCache(client)
	to := time.Date(2026, 9, 2, 12, 0, 0, 0, time.UTC)
	filters := OverviewFilters{ProjectID: uuid.New(), From: to.Add(-time.Hour), To: to, Environment: "production"}
	version := to.Add(-time.Minute)
	key, err := overviewCacheKey(filters, version)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = client.Del(context.Background(), key).Err() })
	want := Overview{From: filters.From, To: filters.To, IntervalSeconds: 60, Series: []OverviewPoint{}, TopIssues: []OverviewIssue{}, SlowAPIs: []OverviewAPI{}}
	if err := cache.Set(context.Background(), filters, version, want); err != nil {
		t.Fatal(err)
	}
	got, hit, err := cache.Get(context.Background(), filters, version)
	if err != nil || !hit || got.IntervalSeconds != want.IntervalSeconds {
		t.Fatalf("hit=%v got=%+v err=%v", hit, got, err)
	}
	if _, hit, err := cache.Get(context.Background(), filters, version.Add(time.Second)); err != nil || hit {
		t.Fatalf("new queryable version hit=%v err=%v", hit, err)
	}
	changed := filters
	changed.Route = "/checkout"
	if _, hit, err := cache.Get(context.Background(), changed, version); err != nil || hit {
		t.Fatalf("changed filter hit=%v err=%v", hit, err)
	}
}
