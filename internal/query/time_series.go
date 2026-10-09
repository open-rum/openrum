package query

import "time"

// ConsoleSeriesMaxPoints is the shared target, not an exact bucket count.
// Read docs/agents/time-series.md before changing this policy.
const ConsoleSeriesMaxPoints = 30

// ConsoleSeriesInterval respects the source's finest available resolution.
// Current rollup floors (one minute, five minutes and one hour) all align
// with the allowed intervals. Never invent finer samples from a coarse rollup.
func ConsoleSeriesInterval(window, sourceResolution time.Duration) time.Duration {
	return max(sourceResolution, adaptiveSeriesInterval(window, ConsoleSeriesMaxPoints))
}

// Zero retains legacy resolution at API call sites that support opt-in budgets.
func validSeriesPointBudget(points int) bool {
	return points == 0 || (points >= 24 && points <= 240)
}

func adaptiveSeriesInterval(window time.Duration, points int) time.Duration {
	if !validSeriesPointBudget(points) || points == 0 {
		points = ConsoleSeriesMaxPoints
	}
	for _, minutes := range []int{1, 2, 5, 10, 15, 30, 60, 120, 180, 240, 360, 720, 1440, 2880} {
		interval := time.Duration(minutes) * time.Minute
		if window <= time.Duration(points)*interval {
			return interval
		}
	}
	return 48 * time.Hour
}

// seriesBuckets returns the dense, ascending bucket grid a series is laid on. It floors to
// the epoch like ClickHouse's toStartOfInterval does in UTC, so a range that does not
// start on a boundary gains one partial leading bucket rather than being stretched.
func seriesBuckets(from, to time.Time, interval time.Duration) []time.Time {
	step := int64(interval / time.Second)
	if step <= 0 || !to.After(from) {
		return nil
	}
	start := from.UTC().Unix() / step * step
	end := to.UTC().Unix()
	buckets := make([]time.Time, 0, (end-start)/step+1)
	for current := start; current < end; current += step {
		buckets = append(buckets, time.Unix(current, 0).UTC())
	}
	return buckets
}
