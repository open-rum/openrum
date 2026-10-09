package query

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/google/uuid"
)

var ErrInvalidPerformanceFilters = errors.New("invalid performance filters")

const minimumPerformanceSamples = 75

type PerformanceFilters struct {
	ProjectID   uuid.UUID
	From        time.Time
	To          time.Time
	Environment string
	Release     string
	Route       string
	Metric      string
	Percentile  string
	Browser     string
	DeviceType  string
	Country     string
}

type PerformanceMetric struct {
	P50        *float64 `json:"p50"`
	P75        *float64 `json:"p75"`
	P90        *float64 `json:"p90"`
	P95        *float64 `json:"p95"`
	P99        *float64 `json:"p99"`
	Samples    uint64   `json:"samples"`
	Sufficient bool     `json:"sufficient"`
}

type RoutePerformance struct {
	Route     string            `json:"route"`
	PageViews uint64            `json:"pageViews"`
	LCP       PerformanceMetric `json:"lcp"`
	INP       PerformanceMetric `json:"inp"`
	CLS       PerformanceMetric `json:"cls"`
	FCP       PerformanceMetric `json:"fcp"`
	TTFB      PerformanceMetric `json:"ttfb"`
}

type PerformancePoint struct {
	Bucket time.Time         `json:"bucket"`
	Metric PerformanceMetric `json:"metric"`
}

type PerformanceTrendPoint struct {
	Bucket time.Time         `json:"bucket"`
	LCP    PerformanceMetric `json:"lcp"`
	INP    PerformanceMetric `json:"inp"`
	CLS    PerformanceMetric `json:"cls"`
	FCP    PerformanceMetric `json:"fcp"`
	TTFB   PerformanceMetric `json:"ttfb"`
}

type PerformanceFacet struct {
	Value  string            `json:"value"`
	Metric PerformanceMetric `json:"metric"`
}

type PerformanceDistribution struct {
	From     float64 `json:"from"`
	To       float64 `json:"to"`
	Samples  uint64  `json:"samples"`
	Overflow bool    `json:"overflow,omitempty"`
}

type PerformanceSample struct {
	EventID    uuid.UUID `json:"eventId"`
	Timestamp  time.Time `json:"timestamp"`
	Value      float64   `json:"value"`
	PageURL    string    `json:"pageUrl"`
	Browser    string    `json:"browser,omitempty"`
	DeviceType string    `json:"deviceType,omitempty"`
	Country    string    `json:"country,omitempty"`
	Release    string    `json:"release,omitempty"`
}

type PerformanceDetail struct {
	Route        string                    `json:"route"`
	Metric       string                    `json:"metric"`
	Trend        []PerformancePoint        `json:"trend"`
	Distribution []PerformanceDistribution `json:"distribution"`
	Browsers     []PerformanceFacet        `json:"browsers"`
	DeviceTypes  []PerformanceFacet        `json:"deviceTypes"`
	Samples      []PerformanceSample       `json:"samples"`
}

type PerformanceResult struct {
	From time.Time `json:"from"`
	To   time.Time `json:"to"`
	// IntervalSeconds is the bucket width shared by the overview and route trends.
	IntervalSeconds int                                  `json:"intervalSeconds"`
	Routes          []RoutePerformance                   `json:"routes"`
	Trend           []PerformanceTrendPoint              `json:"trend"`
	Detail          *PerformanceDetail                   `json:"detail,omitempty"`
	Summary         RoutePerformance                     `json:"summary"`
	Facets          map[string][]PerformanceFilterOption `json:"facets"`
}

type PerformanceFilterOption struct {
	Value   string `json:"value"`
	Samples uint64 `json:"samples"`
}

type PerformanceRepository struct{ database *sql.DB }

func NewPerformanceRepository(database *sql.DB) *PerformanceRepository {
	return &PerformanceRepository{database: database}
}

func NormalizePerformanceFilters(filters PerformanceFilters) (PerformanceFilters, error) {
	filters.From, filters.To = filters.From.UTC(), filters.To.UTC()
	filters.Environment, filters.Release, filters.Route = strings.TrimSpace(filters.Environment), strings.TrimSpace(filters.Release), strings.TrimSpace(filters.Route)
	filters.Metric = strings.ToUpper(strings.TrimSpace(filters.Metric))
	filters.Browser, filters.DeviceType, filters.Country = strings.TrimSpace(filters.Browser), strings.ToLower(strings.TrimSpace(filters.DeviceType)), strings.ToUpper(strings.TrimSpace(filters.Country))
	filters.Percentile = strings.ToLower(strings.TrimSpace(filters.Percentile))
	if filters.Percentile == "" {
		filters.Percentile = "p75"
	}
	if _, ok := performanceQuantiles[filters.Percentile]; !ok {
		return PerformanceFilters{}, ErrInvalidPerformanceFilters
	}
	if len(filters.Browser) > 64 || len(filters.DeviceType) > 32 || (filters.Country != "" && (len(filters.Country) != 2 || filters.Country[0] < 'A' || filters.Country[0] > 'Z' || filters.Country[1] < 'A' || filters.Country[1] > 'Z')) || containsControl(filters.Browser+filters.DeviceType) {
		return PerformanceFilters{}, ErrInvalidPerformanceFilters
	}
	if filters.Metric == "" {
		filters.Metric = "LCP"
	}
	if filters.ProjectID == uuid.Nil || filters.From.IsZero() || !filters.From.Before(filters.To) || filters.To.Sub(filters.From) > 30*24*time.Hour ||
		len(filters.Environment) > 64 || len(filters.Release) > 128 || len(filters.Route) > 1024 ||
		(filters.Metric != "LCP" && filters.Metric != "INP" && filters.Metric != "CLS" && filters.Metric != "FCP" && filters.Metric != "TTFB") || containsControl(filters.Environment+filters.Release+filters.Route) {
		return PerformanceFilters{}, ErrInvalidPerformanceFilters
	}
	return filters, nil
}

func (repository *PerformanceRepository) Get(ctx context.Context, requested PerformanceFilters) (PerformanceResult, error) {
	filters, err := NormalizePerformanceFilters(requested)
	if err != nil {
		return PerformanceResult{}, err
	}
	routes, err := repository.routes(ctx, filters)
	if err != nil {
		return PerformanceResult{}, err
	}
	result := PerformanceResult{
		From: filters.From, To: filters.To, Routes: routes, Trend: []PerformanceTrendPoint{},
		IntervalSeconds: int(performanceInterval(filters.To.Sub(filters.From)) / time.Second),
	}
	result.Summary, err = repository.summary(ctx, filters)
	if err != nil {
		return PerformanceResult{}, err
	}
	result.Facets, err = repository.filterOptions(ctx, filters)
	if err != nil {
		return PerformanceResult{}, err
	}
	if filters.Route == "" {
		result.Trend, err = repository.overviewTrend(ctx, filters)
		if err != nil {
			return PerformanceResult{}, err
		}
	}
	if filters.Route != "" {
		detail, err := repository.detail(ctx, filters)
		if err != nil {
			return PerformanceResult{}, err
		}
		result.Detail = &detail
	}
	return result, nil
}

func (repository *PerformanceRepository) overviewTrend(ctx context.Context, filters PerformanceFilters) ([]PerformanceTrendPoint, error) {
	where, arguments := performanceAggregateWhere(filters, false)
	interval := performanceIntervalSQL(performanceInterval(filters.To.Sub(filters.From)))
	rows, err := repository.database.QueryContext(ctx, `SELECT toStartOfInterval(timestamp, INTERVAL `+interval+`) AS point,
		`+performanceMetricSelect("LCP")+`,`+performanceMetricSelect("INP")+`,`+performanceMetricSelect("CLS")+`,`+performanceMetricSelect("FCP")+`,`+performanceMetricSelect("TTFB")+`
		FROM rum_events WHERE `+where+` GROUP BY point ORDER BY point`, arguments...)
	if err != nil {
		return nil, fmt.Errorf("query performance overview trend: %w", err)
	}
	defer func() { _ = rows.Close() }()
	result := make([]PerformanceTrendPoint, 0)
	for rows.Next() {
		var current PerformanceTrendPoint
		var lcp, inp, cls, fcp, ttfb performanceMetricScan
		if err := rows.Scan(append([]any{&current.Bucket}, performanceScanTargets(&lcp, &inp, &cls, &fcp, &ttfb)...)...); err != nil {
			return nil, err
		}
		current.Bucket = current.Bucket.UTC()
		current.LCP, current.INP, current.CLS, current.FCP, current.TTFB = lcp.metric(), inp.metric(), cls.metric(), fcp.metric(), ttfb.metric()
		result = append(result, current)
	}
	return result, rows.Err()
}

func (repository *PerformanceRepository) routes(ctx context.Context, filters PerformanceFilters) ([]RoutePerformance, error) {
	where, arguments := performanceAggregateWhere(filters, false)
	rows, err := repository.database.QueryContext(ctx, `SELECT route,
		uniqCombined64If(event_id,event_type='page_view'),
		`+performanceMetricSelect("LCP")+`,`+performanceMetricSelect("INP")+`,`+performanceMetricSelect("CLS")+`,`+performanceMetricSelect("FCP")+`,`+performanceMetricSelect("TTFB")+`
		FROM rum_events WHERE `+where+` AND route!='' GROUP BY route
		HAVING `+performanceSampleColumn("LCP")+`+`+performanceSampleColumn("INP")+`+`+performanceSampleColumn("CLS")+`+`+performanceSampleColumn("FCP")+`+`+performanceSampleColumn("TTFB")+`>0
		ORDER BY if(isNaN(`+performanceQuantileColumn(filters.Metric, filters.Percentile)+`),-1,`+performanceQuantileColumn(filters.Metric, filters.Percentile)+`) DESC, route LIMIT 100`, arguments...)
	if err != nil {
		return nil, fmt.Errorf("query performance routes: %w", err)
	}
	defer func() { _ = rows.Close() }()
	results := make([]RoutePerformance, 0)
	for rows.Next() {
		var current RoutePerformance
		var lcp, inp, cls, fcp, ttfb performanceMetricScan
		if err := rows.Scan(append([]any{&current.Route, &current.PageViews}, performanceScanTargets(&lcp, &inp, &cls, &fcp, &ttfb)...)...); err != nil {
			return nil, err
		}
		current.LCP, current.INP, current.CLS, current.FCP, current.TTFB = lcp.metric(), inp.metric(), cls.metric(), fcp.metric(), ttfb.metric()
		results = append(results, current)
	}
	return results, rows.Err()
}

func (repository *PerformanceRepository) detail(ctx context.Context, filters PerformanceFilters) (PerformanceDetail, error) {
	detail := PerformanceDetail{Route: filters.Route, Metric: filters.Metric, Trend: []PerformancePoint{}, Distribution: []PerformanceDistribution{}, Browsers: []PerformanceFacet{}, DeviceTypes: []PerformanceFacet{}, Samples: []PerformanceSample{}}
	var err error
	if detail.Trend, err = repository.trend(ctx, filters); err != nil {
		return detail, err
	}
	if detail.Distribution, err = repository.distribution(ctx, filters); err != nil {
		return detail, err
	}
	if detail.Browsers, err = repository.facets(ctx, filters, "browser"); err != nil {
		return detail, err
	}
	if detail.DeviceTypes, err = repository.facets(ctx, filters, "device_type"); err != nil {
		return detail, err
	}
	detail.Samples, err = repository.samples(ctx, filters)
	return detail, err
}

func (repository *PerformanceRepository) trend(ctx context.Context, filters PerformanceFilters) ([]PerformancePoint, error) {
	where, arguments := performanceAggregateWhere(filters, true)
	interval := performanceIntervalSQL(performanceInterval(filters.To.Sub(filters.From)))
	rows, err := repository.database.QueryContext(ctx, `SELECT toStartOfInterval(timestamp, INTERVAL `+interval+`) AS point,
		`+performanceMetricSelect(filters.Metric)+`
		FROM rum_events WHERE `+where+` GROUP BY point ORDER BY point`, arguments...)
	if err != nil {
		return nil, fmt.Errorf("query performance trend: %w", err)
	}
	defer func() { _ = rows.Close() }()
	result := make([]PerformancePoint, 0)
	for rows.Next() {
		var current PerformancePoint
		var value performanceMetricScan
		if err := rows.Scan(append([]any{&current.Bucket}, performanceScanTargets(&value)...)...); err != nil {
			return nil, err
		}
		current.Bucket = current.Bucket.UTC()
		current.Metric = value.metric()
		result = append(result, current)
	}
	return result, rows.Err()
}

func (repository *PerformanceRepository) facets(ctx context.Context, filters PerformanceFilters, dimension string) ([]PerformanceFacet, error) {
	where, arguments := performanceAggregateWhere(filters, true)
	samples := performanceSampleColumn(filters.Metric)
	rows, err := repository.database.QueryContext(ctx, `SELECT `+dimension+`,`+performanceMetricSelect(filters.Metric)+`
		FROM rum_events WHERE `+where+` AND `+dimension+`!='' GROUP BY `+dimension+` ORDER BY `+samples+` DESC LIMIT 20`, arguments...)
	if err != nil {
		return nil, fmt.Errorf("query performance %s facets: %w", dimension, err)
	}
	defer func() { _ = rows.Close() }()
	result := make([]PerformanceFacet, 0)
	for rows.Next() {
		var current PerformanceFacet
		var value performanceMetricScan
		if err := rows.Scan(append([]any{&current.Value}, performanceScanTargets(&value)...)...); err != nil {
			return nil, err
		}
		current.Metric = value.metric()
		result = append(result, current)
	}
	return result, rows.Err()
}

func (repository *PerformanceRepository) distribution(ctx context.Context, filters PerformanceFilters) ([]PerformanceDistribution, error) {
	width := metricBucketWidth(filters.Metric)
	where, arguments := performanceRawWhere(filters)
	arguments = append([]any{width}, arguments...)
	rows, err := repository.database.QueryContext(ctx, `SELECT least(toUInt32(floor(metric_value / ?)),20) AS bucket,count()
		FROM rum_events WHERE `+where+` AND metric_value>=0 GROUP BY bucket ORDER BY bucket`, arguments...)
	if err != nil {
		return nil, fmt.Errorf("query performance distribution: %w", err)
	}
	defer func() { _ = rows.Close() }()
	result := make([]PerformanceDistribution, 0)
	for rows.Next() {
		var bucket uint32
		var current PerformanceDistribution
		if err := rows.Scan(&bucket, &current.Samples); err != nil {
			return nil, err
		}
		current.From, current.To = float64(bucket)*width, float64(bucket+1)*width
		current.Overflow = bucket == 20
		result = append(result, current)
	}
	return result, rows.Err()
}

func (repository *PerformanceRepository) samples(ctx context.Context, filters PerformanceFilters) ([]PerformanceSample, error) {
	where, arguments := performanceRawWhere(filters)
	rows, err := repository.database.QueryContext(ctx, `SELECT event_id,timestamp,metric_value,page_url_normalized,browser,device_type,country,release
		FROM rum_events WHERE `+where+` ORDER BY metric_value DESC,timestamp DESC LIMIT 25`, arguments...)
	if err != nil {
		return nil, fmt.Errorf("query performance samples: %w", err)
	}
	defer func() { _ = rows.Close() }()
	result := make([]PerformanceSample, 0)
	for rows.Next() {
		var current PerformanceSample
		if err := rows.Scan(&current.EventID, &current.Timestamp, &current.Value, &current.PageURL, &current.Browser, &current.DeviceType, &current.Country, &current.Release); err != nil {
			return nil, err
		}
		current.Timestamp = current.Timestamp.UTC()
		result = append(result, current)
	}
	return result, rows.Err()
}

func performanceAggregateWhere(filters PerformanceFilters, includeRoute bool) (string, []any) {
	// Prune unrelated types using the (project_id,event_type,timestamp) sort key.
	// PV counts and all five vital distributions retain the same population.
	where := "project_id=? AND event_type IN ('page_view','web_vital') AND timestamp>=? AND timestamp<? AND NOT has(ingest_flags,'synthetic')"
	arguments := []any{filters.ProjectID, filters.From, filters.To}
	for _, item := range []struct{ column, value string }{{"environment", filters.Environment}, {"release", filters.Release}, {"browser", filters.Browser}, {"device_type", filters.DeviceType}, {"country", filters.Country}} {
		if item.value != "" {
			where += " AND " + item.column + "=?"
			arguments = append(arguments, item.value)
		}
	}
	if includeRoute || filters.Route != "" {
		where += " AND route=?"
		arguments = append(arguments, filters.Route)
	}
	return where, arguments
}

func performanceRawWhere(filters PerformanceFilters) (string, []any) {
	where := "project_id=? AND timestamp>=? AND timestamp<? AND event_type='web_vital' AND isFinite(metric_value) AND metric_value>=0 AND metric_name=? AND route=? AND NOT has(ingest_flags,'synthetic')"
	arguments := []any{filters.ProjectID, filters.From, filters.To, filters.Metric, filters.Route}
	for _, item := range []struct{ column, value string }{{"environment", filters.Environment}, {"release", filters.Release}, {"browser", filters.Browser}, {"device_type", filters.DeviceType}, {"country", filters.Country}} {
		if item.value != "" {
			where += " AND " + item.column + "=?"
			arguments = append(arguments, item.value)
		}
	}
	return where, arguments
}

func metricBucketWidth(metric string) float64 {
	if metric == "CLS" {
		return 0.05
	}
	if metric == "INP" {
		return 50
	}
	return 250
}

// performanceInterval follows the Console's ~30-bucket policy (docs/agents/time-series.md)
// over raw events, whose finest resolution is one minute.
func performanceInterval(window time.Duration) time.Duration {
	return ConsoleSeriesInterval(window, time.Minute)
}

// legacySeriesInterval is the pre-policy density still used by the analytics and API
// trends when the caller passes no point budget; see docs/agents/time-series.md.
func legacySeriesInterval(window time.Duration) string {
	switch {
	case window <= 6*time.Hour:
		return "1 MINUTE"
	case window <= 48*time.Hour:
		return "15 MINUTE"
	case window <= 14*24*time.Hour:
		return "1 HOUR"
	default:
		return "6 HOUR"
	}
}

func performanceIntervalSQL(interval time.Duration) string {
	return fmt.Sprintf("%d MINUTE", int(interval/time.Minute))
}

func finalizeMetric(value float64, samples uint64) PerformanceMetric {
	metric := PerformanceMetric{Samples: samples, Sufficient: samples >= minimumPerformanceSamples}
	if samples > 0 && !math.IsNaN(value) && !math.IsInf(value, 0) {
		metric.P75 = &value
	}
	return metric
}

func containsControl(value string) bool {
	for _, character := range value {
		if character < 0x20 || character == 0x7f {
			return true
		}
	}
	return false
}

var performanceQuantiles = map[string]string{"p50": "0.5", "p75": "0.75", "p90": "0.9", "p95": "0.95", "p99": "0.99"}
var performancePercentiles = []string{"p50", "p75", "p90", "p95", "p99"}

// Keep every percentile and its sample count on the same retained raw-event population.
// The legacy Nullable TDigest states are not parameter-compatible on ClickHouse 25.8.
func performanceQuantileColumn(metric, percentile string) string {
	index := 2
	for position, candidate := range performancePercentiles {
		if candidate == percentile {
			index = position + 1
			break
		}
	}
	// Identical aggregate expressions share one digest per metric for all levels.
	return fmt.Sprintf("quantilesTDigestIf(0.5,0.75,0.9,0.95,0.99)(metric_value,%s)[%d]", performanceMetricPredicate(metric), index)
}
func performanceMetricPredicate(metric string) string {
	switch metric {
	case "INP", "CLS", "FCP", "TTFB":
	default:
		metric = "LCP"
	}
	return "event_type='web_vital' AND metric_name='" + metric + "' AND isFinite(metric_value) AND metric_value>=0"
}
func performanceSampleColumn(metric string) string {
	return "uniqCombined64If(event_id," + performanceMetricPredicate(metric) + ")"
}
func performanceMetricSelect(metric string) string {
	columns := make([]string, 0, 6)
	for _, percentile := range performancePercentiles {
		columns = append(columns, performanceQuantileColumn(metric, percentile))
	}
	return strings.Join(append(columns, performanceSampleColumn(metric)), ",")
}

type performanceMetricScan struct {
	values  [5]sql.NullFloat64
	samples uint64
}

func performanceScanTargets(metrics ...*performanceMetricScan) []any {
	targets := make([]any, 0, len(metrics)*6)
	for _, metric := range metrics {
		for index := range metric.values {
			targets = append(targets, &metric.values[index])
		}
		targets = append(targets, &metric.samples)
	}
	return targets
}
func (scan performanceMetricScan) metric() PerformanceMetric {
	result := PerformanceMetric{Samples: scan.samples, Sufficient: scan.samples >= minimumPerformanceSamples}
	for index, target := range []**float64{&result.P50, &result.P75, &result.P90, &result.P95, &result.P99} {
		value := scan.values[index]
		if scan.samples > 0 && value.Valid && !math.IsNaN(value.Float64) && !math.IsInf(value.Float64, 0) {
			*target = &value.Float64
		}
	}
	return result
}

func (repository *PerformanceRepository) summary(ctx context.Context, filters PerformanceFilters) (RoutePerformance, error) {
	where, arguments := performanceAggregateWhere(filters, false)
	var result RoutePerformance
	var lcp, inp, cls, fcp, ttfb performanceMetricScan
	err := repository.database.QueryRowContext(ctx, `SELECT uniqCombined64If(event_id,event_type='page_view'),`+performanceMetricSelect("LCP")+`,`+performanceMetricSelect("INP")+`,`+performanceMetricSelect("CLS")+`,`+performanceMetricSelect("FCP")+`,`+performanceMetricSelect("TTFB")+` FROM rum_events WHERE `+where, arguments...).Scan(append([]any{&result.PageViews}, performanceScanTargets(&lcp, &inp, &cls, &fcp, &ttfb)...)...)
	if err != nil {
		return result, fmt.Errorf("query performance summary: %w", err)
	}
	result.Route, result.LCP, result.INP, result.CLS, result.FCP, result.TTFB = filters.Route, lcp.metric(), inp.metric(), cls.metric(), fcp.metric(), ttfb.metric()
	return result, nil
}

func (repository *PerformanceRepository) filterOptions(ctx context.Context, filters PerformanceFilters) (map[string][]PerformanceFilterOption, error) {
	result := make(map[string][]PerformanceFilterOption)
	for _, dimension := range []struct{ key, column string }{{"routes", "route"}, {"browsers", "browser"}, {"deviceTypes", "device_type"}, {"countries", "country"}, {"releases", "release"}} {
		facetFilters := filters
		switch dimension.column {
		case "route":
			facetFilters.Route = ""
		case "browser":
			facetFilters.Browser = ""
		case "device_type":
			facetFilters.DeviceType = ""
		case "country":
			facetFilters.Country = ""
		case "release":
			facetFilters.Release = ""
		}
		where, arguments := performanceAggregateWhere(facetFilters, false)
		// HAVING already excludes groups without this metric. Push that predicate
		// down so each facet scans only its relevant metric rather than all rows.
		where += " AND " + performanceMetricPredicate(filters.Metric)
		samples := performanceSampleColumn(filters.Metric)
		rows, err := repository.database.QueryContext(ctx, `SELECT `+dimension.column+`,`+samples+` AS option_samples FROM rum_events WHERE `+where+` AND `+dimension.column+`!='' GROUP BY `+dimension.column+` HAVING option_samples>0 ORDER BY option_samples DESC, `+dimension.column+` LIMIT 100`, arguments...)
		if err != nil {
			return nil, fmt.Errorf("query performance filter options: %w", err)
		}
		options := make([]PerformanceFilterOption, 0)
		for rows.Next() {
			var option PerformanceFilterOption
			if err := rows.Scan(&option.Value, &option.Samples); err != nil {
				_ = rows.Close()
				return nil, err
			}
			options = append(options, option)
		}
		err = rows.Err()
		_ = rows.Close()
		if err != nil {
			return nil, err
		}
		result[dimension.key] = options
	}
	return result, nil
}
