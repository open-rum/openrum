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
