package query

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"openrum/internal/catalog"
)

var metricsTo = time.Date(2026, 9, 2, 12, 0, 0, 0, time.UTC)

func metricsQueryOver(duration time.Duration, spec catalog.Spec) MetricsQuery {
	return MetricsQuery{ProjectID: uuid.New(), From: metricsTo.Add(-duration), To: metricsTo, Spec: spec}
}

func normalized(t *testing.T, requested MetricsQuery) MetricsQuery {
	t.Helper()
	query, err := NormalizeMetricsQuery(requested)
	if err != nil {
		t.Fatal(err)
	}
	return query
}

func TestNormalizeMetricsQueryDefaultsToTheConsoleBudget(t *testing.T) {
	query := normalized(t, metricsQueryOver(time.Hour, catalog.Spec{Metrics: []string{"traffic.pageViews"}, Shape: catalog.ShapeSeries}))
	if query.MaxPoints != ConsoleSeriesMaxPoints {
		t.Fatalf("expected the shared %d-point budget, got %d", ConsoleSeriesMaxPoints, query.MaxPoints)
	}
	for name, requested := range map[string]MetricsQuery{
		"over 30 days": metricsQueryOver(31*24*time.Hour, catalog.Spec{Metrics: []string{"traffic.pageViews"}, Shape: catalog.ShapeTotal}),
		"bad points":   {ProjectID: uuid.New(), From: metricsTo.Add(-time.Hour), To: metricsTo, MaxPoints: 5, Spec: catalog.Spec{Metrics: []string{"traffic.pageViews"}, Shape: catalog.ShapeTotal}},
		"bad env":      {ProjectID: uuid.New(), From: metricsTo.Add(-time.Hour), To: metricsTo, Environment: "Prod!", Spec: catalog.Spec{Metrics: []string{"traffic.pageViews"}, Shape: catalog.ShapeTotal}},
		"empty window": {ProjectID: uuid.New(), From: metricsTo, To: metricsTo, Spec: catalog.Spec{Metrics: []string{"traffic.pageViews"}, Shape: catalog.ShapeTotal}},
		"invalid spec": metricsQueryOver(time.Hour, catalog.Spec{Metrics: []string{"nope"}, Shape: catalog.ShapeTotal}),
		"missing proj": {From: metricsTo.Add(-time.Hour), To: metricsTo, Spec: catalog.Spec{Metrics: []string{"traffic.pageViews"}, Shape: catalog.ShapeTotal}},
	} {
		if _, err := NormalizeMetricsQuery(requested); err == nil {
			t.Errorf("%s: expected rejection", name)
		}
	}
}

func TestIssueSeriesNeverDrawFinerThanFiveMinutes(t *testing.T) {
	issue := normalized(t, metricsQueryOver(time.Hour, catalog.Spec{Metrics: []string{"issues.events"}, Shape: catalog.ShapeSeries}))
	if issue.interval() != 5*time.Minute {
		t.Fatalf("issue rollup floor is five minutes, got %s", issue.interval())
	}
	traffic := normalized(t, metricsQueryOver(time.Hour, catalog.Spec{Metrics: []string{"traffic.pageViews"}, Shape: catalog.ShapeSeries}))
	if traffic.interval() != 2*time.Minute {
		t.Fatalf("one hour over the one-minute rollup is two-minute buckets, got %s", traffic.interval())
	}
}

func TestMetricsBudgetCalibration(t *testing.T) {
	month := 30 * 24 * time.Hour
	budget := DefaultMetricsBudget()
	for name, current := range map[string]struct {
		query MetricsQuery
		ok    bool
	}{
		"30d series unfiltered":          {metricsQueryOver(month, catalog.Spec{Metrics: []string{"traffic.pageViews"}, Shape: catalog.ShapeSeries}), true},
		"30d series with comparison":     {metricsQueryOver(month, catalog.Spec{Metrics: []string{"traffic.pageViews"}, Shape: catalog.ShapeSeries, Compare: true}), true},
		"30d split series":               {metricsQueryOver(month, catalog.Spec{Metrics: []string{"traffic.pageViews"}, Shape: catalog.ShapeSeriesByDimension, Dimension: "device"}), true},
		"30d wide table unfiltered":      {metricsQueryOver(month, catalog.Spec{Metrics: []string{"traffic.pageViews", "traffic.sessions", "traffic.errors", "traffic.apiRequests", "traffic.errorRate", "vitals.lcpP75"}, Shape: catalog.ShapeTable, Dimension: "route", Compare: true, Sparkline: true}), false},
		"24h new issues stat unfiltered": {metricsQueryOver(24*time.Hour, catalog.Spec{Metrics: []string{"issues.newIssues"}, Shape: catalog.ShapeSeries, Compare: true}), true},
	} {
		err := budget.Check(current.query)
		if current.ok && err != nil {
			t.Errorf("%s: unexpectedly rejected: %v", name, err)
		}
		if !current.ok && !errors.Is(err, ErrQueryTooExpensive) {
			t.Errorf("%s: expected ErrQueryTooExpensive, got %v", name, err)
		}
	}
	wide := metricsQueryOver(month, catalog.Spec{
		Metrics: []string{"traffic.pageViews", "traffic.sessions", "traffic.errors", "traffic.apiRequests", "traffic.errorRate", "vitals.lcpP75"},
		Shape:   catalog.ShapeTable, Dimension: "route", Compare: true, Sparkline: true,
		Filters: map[string]string{"release": "1.2.0"},
	})
	wide.Environment = "production"
	if err := budget.Check(wide); err != nil {
		t.Fatalf("an environment and a release make a wide table affordable: %v", err)
	}
}

func TestMetricsCacheKeyIsolatesEveryInput(t *testing.T) {
	base := normalized(t, metricsQueryOver(time.Hour, catalog.Spec{Metrics: []string{"traffic.pageViews"}, Shape: catalog.ShapeSeries}))
	version := metricsTo
	key, err := metricsCacheKey(base, version)
	if err != nil || !strings.HasPrefix(key, metricsCachePrefix) {
		t.Fatalf("key=%q err=%v", key, err)
	}
	variants := map[string]func(MetricsQuery) (MetricsQuery, time.Time){
		"environment": func(query MetricsQuery) (MetricsQuery, time.Time) {
			query.Environment = "production"
			return query, version
		},
		"points":  func(query MetricsQuery) (MetricsQuery, time.Time) { query.MaxPoints = 60; return query, version },
		"version": func(query MetricsQuery) (MetricsQuery, time.Time) { return query, version.Add(time.Second) },
		"compare": func(query MetricsQuery) (MetricsQuery, time.Time) { query.Spec.Compare = true; return query, version },
		"filter": func(query MetricsQuery) (MetricsQuery, time.Time) {
			query.Spec.Filters = map[string]string{"release": "1"}
			return query, version
		},
	}
	for name, change := range variants {
		changed, changedVersion := change(base)
		other, err := metricsCacheKey(changed, changedVersion)
		if err != nil || other == key {
			t.Errorf("%s must change the cache key (err=%v)", name, err)
		}
	}
	again, _ := metricsCacheKey(base, version)
	if again != key {
		t.Fatal("the same query must hit the same key")
	}
}

func TestSeriesBucketsAreDenseAndEpochAligned(t *testing.T) {
	from := time.Date(2026, 9, 2, 10, 7, 30, 0, time.UTC)
	to := time.Date(2026, 9, 2, 11, 0, 0, 0, time.UTC)
	buckets := seriesBuckets(from, to, 15*time.Minute)
	want := []string{"10:00", "10:15", "10:30", "10:45"}
	if len(buckets) != len(want) {
		t.Fatalf("got %v", buckets)
	}
	for index, bucket := range buckets {
		if bucket.Format("15:04") != want[index] {
			t.Fatalf("bucket %d is %s, want %s (one partial leading bucket, then aligned)", index, bucket, want[index])
		}
	}
	day := seriesBuckets(time.Date(2026, 8, 3, 0, 0, 0, 0, time.UTC), metricsTo, 24*time.Hour)
	if len(day) != 31 || day[0].Hour() != 0 {
		t.Fatalf("daily buckets must align to UTC midnight: %v", day[:2])
	}
}

// Every placeholder must have exactly one argument: a mismatch is either a driver error
// or, worse, a value bound to the wrong predicate.
func TestMetricsSQLBindsEveryPlaceholder(t *testing.T) {
	specs := map[string]catalog.Spec{
		"total":              {Metrics: []string{"traffic.pageViews", "traffic.uniqueUsers"}, Shape: catalog.ShapeTotal, Filters: map[string]string{"country": "unknown", "release": "1"}},
		"series":             {Metrics: []string{"api.durationP50", "api.durationP95"}, Shape: catalog.ShapeSeries},
		"breakdown":          {Metrics: []string{"traffic.errorRate"}, Shape: catalog.ShapeBreakdown, Dimension: "browser"},
		"measurement":        {Metrics: []string{"measurement.sum"}, Shape: catalog.ShapeBreakdown, Dimension: "property:payment", Measurement: "amount", Filters: map[string]string{"eventName": "checkout"}},
		"error types":        {Metrics: []string{"issues.events", "issues.activeIssues"}, Shape: catalog.ShapeTable, Dimension: "errorType"},
		"new issues":         {Metrics: []string{"issues.newIssues"}, Shape: catalog.ShapeSeries, Filters: map[string]string{"release": "1", "browser": "Chrome"}},
		"new issues by type": {Metrics: []string{"issues.newIssues"}, Shape: catalog.ShapeBreakdown, Dimension: "errorType"},
		"events by name":     {Metrics: []string{"behavior.events", "behavior.users"}, Shape: catalog.ShapeTable, Dimension: "eventName", Filters: map[string]string{"eventKind": "custom"}},
		"pinned events":      {Metrics: []string{"behavior.events"}, Shape: catalog.ShapeSeriesByDimension, Dimension: "eventName", Groups: []string{"pay_start", "pay_success"}},
		"events by country":  {Metrics: []string{"behavior.events"}, Shape: catalog.ShapeBreakdown, Dimension: "country", Filters: map[string]string{"eventName": "pay_success"}},
		"pinned issue types": {Metrics: []string{"issues.newIssues"}, Shape: catalog.ShapeTable, Dimension: "errorType", Groups: []string{"TypeError"}},
	}
	groupings := []grouping{
		{},
		{interval: 5 * time.Minute},
		{dimension: true},
		{dimension: true, restrict: []string{"a", "b"}},
		{interval: 5 * time.Minute, dimension: true, restrict: []string{"a", "b"}, other: true},
	}
	for name, spec := range specs {
		requested := metricsQueryOver(6*time.Hour, spec)
		requested.Environment = "production"
		query := normalized(t, requested)
		regular, newIssues := partitionMetrics(query.Spec.Metrics)
		for _, current := range []window{query.window(), query.previousWindow()} {
			for _, group := range groupings {
				if group.dimension && query.Spec.Dimension == "" {
					continue
				}
				for _, ranked := range []bool{false, true} {
					// A ranked query is restricted only by pinned groups, never folded into "Other".
					if ranked && (!group.dimension || group.interval > 0 || group.other) {
						continue
					}
					var statement string
					var arguments []any
					if newIssues != nil {
						statement, arguments = query.newIssuesSQL(current, group, ranked)
					} else {
						statement, arguments = query.regularSQL(regular, current, group, ranked)
					}
					if placeholders := strings.Count(statement, "?"); placeholders != len(arguments) {
						t.Fatalf("%s %+v ranked=%v: %d placeholders, %d arguments\n%s", name, group, ranked, placeholders, len(arguments), statement)
					}
					if !strings.HasSuffix(statement, metricsQuerySettings) {
						t.Fatalf("%s: every statement carries its own deadline", name)
					}
				}
			}
		}
	}
}

func TestMetricsSQLShapesThePreviousPeriodOntoTheCurrentGrid(t *testing.T) {
	query := normalized(t, metricsQueryOver(90*time.Minute, catalog.Spec{Metrics: []string{"traffic.pageViews"}, Shape: catalog.ShapeSeries, Compare: true}))
	current, _ := query.regularSQL(query.Spec.ResolvedMetrics(), query.window(), grouping{interval: 5 * time.Minute}, false)
	previous, arguments := query.regularSQL(query.Spec.ResolvedMetrics(), query.previousWindow(), grouping{interval: 5 * time.Minute}, false)
	if strings.Contains(current, "addSeconds") {
		t.Fatalf("the current period is not shifted: %s", current)
	}
	if !strings.Contains(previous, "toStartOfInterval(addSeconds(bucket, 5400), INTERVAL 5 MINUTE)") {
		t.Fatalf("the previous period must be shifted by the range length before bucketing: %s", previous)
	}
	if arguments[1].(time.Time) != query.From.Add(-90*time.Minute) || arguments[2].(time.Time) != query.From {
		t.Fatalf("the previous window is [from-D, from): %v", arguments)
	}
}

func TestMetricsSQLNeverInterpolatesValues(t *testing.T) {
	route := "/checkout'; DROP TABLE rum_events; --"
	query := normalized(t, metricsQueryOver(time.Hour, catalog.Spec{
		Metrics: []string{"traffic.pageViews"}, Shape: catalog.ShapeTotal, Filters: map[string]string{"route": route},
	}))
	statement, arguments := query.regularSQL(query.Spec.ResolvedMetrics(), query.window(), grouping{}, false)
	if strings.Contains(statement, "DROP") || !containsArgument(arguments, route) {
		t.Fatalf("filter values must be bound, never spliced: %s", statement)
	}
}

func TestMetricValueKeepsInsufficientValuesAndRealZeros(t *testing.T) {
	lcp, _ := catalog.Lookup("vitals.lcpP75")
	thin := metricValue(lcp, 1800, 0, 12)
	if thin.Value == nil || *thin.Value != 1800 || thin.Sufficient {
		t.Fatalf("a thin vital is returned but marked insufficient: %+v", thin)
	}
	empty := metricValue(lcp, 0, 0, 0)
	if empty.Value != nil {
		t.Fatalf("an empty digest has no value: %+v", empty)
	}
	pageViews, _ := catalog.Lookup("traffic.pageViews")
	zero := metricValue(pageViews, 0, 0, 0)
	if zero.Value == nil || *zero.Value != 0 {
		t.Fatalf("a real zero count stays zero: %+v", zero)
	}
	rate, _ := catalog.Lookup("traffic.errorRate")
	noTraffic := metricValue(rate, 3, 0, 0)
	if noTraffic.Value != nil || noTraffic.Numerator == nil || *noTraffic.Numerator != 3 {
		t.Fatalf("a rate over zero page views has no value but keeps its parts: %+v", noTraffic)
	}
}

func TestLayOnGridLeavesGapsNullAndNewIssuesZero(t *testing.T) {
	buckets := seriesBuckets(metricsTo.Add(-15*time.Minute), metricsTo, 5*time.Minute)
	value := 7.0
	cells := cells{{point: buckets[1].Unix()}: {"traffic.pageViews": {Value: &value, Sufficient: true}}}
	series := layOnGrid(catalog.Spec{Metrics: []string{"traffic.pageViews"}}, buckets, cells, "", false)[0]
	if series.Points[0] != nil || series.Points[2] != nil || series.Points[1] == nil || *series.Points[1].Value != 7 {
		t.Fatalf("missing buckets must be null: %+v", series.Points)
	}
	newIssues := layOnGrid(catalog.Spec{Metrics: []string{"issues.newIssues"}}, buckets, cells, "", false)[0]
	for index, point := range newIssues.Points {
		if point == nil || point.Value == nil || *point.Value != 0 {
			t.Fatalf("bucket %d: a window with no new Issue computes zero, not a gap: %+v", index, point)
		}
	}
}

func TestRemainderOnlyForMetricsThatAddUp(t *testing.T) {
	total, first, second := 100.0, 60.0, 30.0
	rows := []MetricsRow{
		{Value: "Chrome", Values: map[string]MetricValue{"traffic.pageViews": {Value: &first}, "traffic.uniqueUsers": {Value: &first}}},
		{Value: "Safari", Values: map[string]MetricValue{"traffic.pageViews": {Value: &second}, "traffic.uniqueUsers": {Value: &second}}},
	}
	totals := map[string]MetricValue{"traffic.pageViews": {Value: &total}, "traffic.uniqueUsers": {Value: &total}}
	spec := catalog.Spec{Metrics: []string{"traffic.pageViews", "traffic.uniqueUsers"}, Dimension: "browser"}
	other := remainder(spec, totals, rows)
	if value := other["traffic.pageViews"].Value; value == nil || *value != 10 {
		t.Fatalf("other page views are total minus the listed groups: %+v", other)
	}
	if _, present := other["traffic.uniqueUsers"]; present {
		t.Fatal("distinct users do not add up across browsers, so they have no Other")
	}
}

func TestMetricChangesUsePointsForRatios(t *testing.T) {
	spec := catalog.Spec{Metrics: []string{"traffic.errorRate", "traffic.pageViews"}}
	nowRate, beforeRate, nowViews, beforeViews := 0.05, 0.02, 150.0, 100.0
	changes := metricChanges(spec,
		map[string]MetricValue{"traffic.errorRate": {Value: &nowRate}, "traffic.pageViews": {Value: &nowViews}},
		map[string]MetricValue{"traffic.errorRate": {Value: &beforeRate}, "traffic.pageViews": {Value: &beforeViews}})
	if points := changes["traffic.errorRate"].Points; points == nil || *points < 2.99 || *points > 3.01 {
		t.Fatalf("an error rate moving from 2%% to 5%% is +3 points: %+v", changes)
	}
	if percent := changes["traffic.pageViews"].Percent; percent == nil || *percent != 50 {
		t.Fatalf("page views moving from 100 to 150 is +50%%: %+v", changes)
	}
}

func containsArgument(arguments []any, want string) bool {
	for _, argument := range arguments {
		if value, ok := argument.(string); ok && value == want {
			return true
		}
	}
	return false
}

// Behavior rows repeat every Event once per dimension. A split by event name must read the
// 'all' rows and group by the column; a split by country must read only the country rows.
func TestBehaviorSQLReadsExactlyOneKindOfRow(t *testing.T) {
	byName := normalized(t, metricsQueryOver(6*time.Hour, catalog.Spec{
		Metrics: []string{"behavior.events"}, Shape: catalog.ShapeSeriesByDimension, Dimension: "eventName",
		Groups: []string{"pay_start", "pay_success", "pay_failed"},
	}))
	statement, arguments := byName.regularSQL(byName.Spec.ResolvedMetrics(), byName.window(),
		grouping{interval: 15 * time.Minute, dimension: true, restrict: byName.Spec.Groups}, false)
	if !strings.Contains(statement, "event_name AS grp") || !strings.Contains(statement, "dimension = ?") ||
		!strings.Contains(statement, "event_name IN (?,?,?)") || strings.Contains(statement, "measurement") {
		t.Fatalf("unexpected event-name split: %s", statement)
	}
	if !containsArgument(arguments, "all") {
		t.Fatalf("a column split reads the 'all' rows: %v", arguments)
	}
	if byName.Spec.TopN != 3 {
		t.Fatalf("pinned groups set the limit, got %d", byName.Spec.TopN)
	}

	byCountry := normalized(t, metricsQueryOver(6*time.Hour, catalog.Spec{
		Metrics: []string{"behavior.events"}, Shape: catalog.ShapeBreakdown, Dimension: "country",
		Filters: map[string]string{"eventName": "pay_success"},
	}))
	statement, arguments = byCountry.regularSQL(byCountry.Spec.ResolvedMetrics(), byCountry.window(), grouping{dimension: true}, true)
	if !strings.Contains(statement, "dimension_value AS grp") || !containsArgument(arguments, "country") ||
		containsArgument(arguments, "all") || !strings.Contains(statement, "event_name = ?") {
		t.Fatalf("unexpected country split: %s %v", statement, arguments)
	}

	total := normalized(t, metricsQueryOver(6*time.Hour, catalog.Spec{Metrics: []string{"behavior.events"}, Shape: catalog.ShapeTotal}))
	_, arguments = total.regularSQL(total.Spec.ResolvedMetrics(), total.window(), grouping{}, false)
	if !containsArgument(arguments, "all") {
		t.Fatalf("an unsplit total reads the 'all' rows: %v", arguments)
	}
}
