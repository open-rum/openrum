package query

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestAdaptiveSeriesIntervals(t *testing.T) {
	for _, test := range []struct{ window, want time.Duration }{
		{time.Hour, time.Minute},
		{6 * time.Hour, 5 * time.Minute},
		{24 * time.Hour, 15 * time.Minute},
		{7 * 24 * time.Hour, 2 * time.Hour},
		{30 * 24 * time.Hour, 12 * time.Hour},
	} {
		if got := adaptiveSeriesInterval(test.window, 96); got != test.want {
			t.Errorf("window=%v got=%v want=%v", test.window, got, test.want)
		}
	}
	for _, points := range []int{24, 30, 48, 72, 96, 240} {
		for hours := 1; hours < 30*24; hours++ {
			window := time.Duration(hours)*time.Hour + time.Second
			interval := adaptiveSeriesInterval(window, points)
			// A non-aligned range may straddle one additional partial edge bucket.
			if (window+interval-1)/interval > time.Duration(points) {
				t.Fatalf("window=%v points=%d interval=%v", window, points, interval)
			}
		}
	}
}

func TestDashboardThirtyPointIntervals(t *testing.T) {
	for _, test := range []struct {
		window, want time.Duration
		points       int
	}{
		{5 * time.Minute, time.Minute, 5},
		{time.Hour, 2 * time.Minute, 30},
		{6 * time.Hour, 15 * time.Minute, 24},
		{24 * time.Hour, time.Hour, 24},
		{7 * 24 * time.Hour, 6 * time.Hour, 28},
		{30 * 24 * time.Hour, 24 * time.Hour, 30},
	} {
		interval := adaptiveSeriesInterval(test.window, 30)
		if interval != test.want || int(test.window/interval) != test.points {
			t.Errorf("window=%v interval=%v points=%d", test.window, interval, test.window/interval)
		}
	}
}

func TestSeriesBudgetValidationAndCacheIsolation(t *testing.T) {
	to := time.Date(2026, 9, 23, 0, 0, 0, 0, time.UTC)
	base := OverviewFilters{ProjectID: uuid.New(), From: to.Add(-24 * time.Hour), To: to}
	legacyKey, _ := overviewCacheKey(base, to)
	keys := map[string]bool{legacyKey: true}
	for _, points := range []int{24, 30, 48, 72, 96, 240} {
		base.MaxPoints = points
		key, err := overviewCacheKey(base, to)
		if err != nil || keys[key] {
			t.Fatalf("budget %d cache key collision or error: %v", points, err)
		}
		keys[key] = true
	}
	for _, points := range []int{-1, 1, 23, 241, 10000} {
		base.MaxPoints = points
		if _, err := NormalizeOverviewFilters(base); err == nil {
			t.Fatalf("accepted overview budget %d", points)
		}
		if _, err := NormalizeBehaviorFilters(BehaviorFilters{ProjectID: base.ProjectID, From: base.From, To: to, MaxPoints: points}); err == nil {
			t.Fatalf("accepted behavior budget %d", points)
		}
	}
}
