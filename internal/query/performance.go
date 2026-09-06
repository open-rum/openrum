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
}

type PerformanceMetric struct {
	P75        *float64 `json:"p75"`
	Samples    uint64   `json:"samples"`
	Sufficient bool     `json:"sufficient"`
}

type RoutePerformance struct {
	Route     string            `json:"route"`
	PageViews uint64            `json:"pageViews"`
	LCP       PerformanceMetric `json:"lcp"`
	INP       PerformanceMetric `json:"inp"`
	CLS       PerformanceMetric `json:"cls"`
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
}

type PerformanceFacet struct {
	Value  string            `json:"value"`
	Metric PerformanceMetric `json:"metric"`
}

type PerformanceDistribution struct {
	From    float64 `json:"from"`
	To      float64 `json:"to"`
	Samples uint64  `json:"samples"`
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
	From   time.Time               `json:"from"`
	To     time.Time               `json:"to"`
	Routes []RoutePerformance      `json:"routes"`
	Trend  []PerformanceTrendPoint `json:"trend"`
	Detail *PerformanceDetail      `json:"detail,omitempty"`
}

type PerformanceRepository struct{ database *sql.DB }

func NewPerformanceRepository(database *sql.DB) *PerformanceRepository {
	return &PerformanceRepository{database: database}
}

func NormalizePerformanceFilters(filters PerformanceFilters) (PerformanceFilters, error) {
	filters.From, filters.To = filters.From.UTC(), filters.To.UTC()
	filters.Environment, filters.Release, filters.Route = strings.TrimSpace(filters.Environment), strings.TrimSpace(filters.Release), strings.TrimSpace(filters.Route)
	filters.Metric = strings.ToUpper(strings.TrimSpace(filters.Metric))
	if filters.Metric == "" {
		filters.Metric = "LCP"
	}
	if filters.ProjectID == uuid.Nil || filters.From.IsZero() || !filters.From.Before(filters.To) || filters.To.Sub(filters.From) > 30*24*time.Hour ||
		len(filters.Environment) > 64 || len(filters.Release) > 128 || len(filters.Route) > 1024 ||
		(filters.Metric != "LCP" && filters.Metric != "INP" && filters.Metric != "CLS") || containsControl(filters.Environment+filters.Release+filters.Route) {
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
	result := PerformanceResult{From: filters.From, To: filters.To, Routes: routes, Trend: []PerformanceTrendPoint{}}
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
	interval := performanceInterval(filters.To.Sub(filters.From))
	rows, err := repository.database.QueryContext(ctx, `SELECT toStartOfInterval(bucket, INTERVAL `+interval+`) AS point,
		quantileTDigestMerge(0.75)(lcp_p75),coalesce(uniqCombined64Merge(lcp_samples),0),
		quantileTDigestMerge(0.75)(inp_p75),coalesce(uniqCombined64Merge(inp_samples),0),
		quantileTDigestMerge(0.75)(cls_p75),coalesce(uniqCombined64Merge(cls_samples),0)
		FROM project_metrics_1m WHERE `+where+` GROUP BY point ORDER BY point`, arguments...)
	if err != nil {
		return nil, fmt.Errorf("query performance overview trend: %w", err)
	}
	defer func() { _ = rows.Close() }()
	result := make([]PerformanceTrendPoint, 0)
	for rows.Next() {
		var current PerformanceTrendPoint
		var lcp, inp, cls sql.NullFloat64
		if err := rows.Scan(
			&current.Bucket,
			&lcp,
			&current.LCP.Samples,
			&inp,
			&current.INP.Samples,
			&cls,
			&current.CLS.Samples,
		); err != nil {
			return nil, err
		}
		current.Bucket = current.Bucket.UTC()
		current.LCP = finalizeNullableMetric(lcp, current.LCP.Samples)
		current.INP = finalizeNullableMetric(inp, current.INP.Samples)
		current.CLS = finalizeNullableMetric(cls, current.CLS.Samples)
		result = append(result, current)
	}
	return result, rows.Err()
}

func (repository *PerformanceRepository) routes(ctx context.Context, filters PerformanceFilters) ([]RoutePerformance, error) {
	where, arguments := performanceAggregateWhere(filters, false)
	rows, err := repository.database.QueryContext(ctx, `SELECT route,
		coalesce(uniqCombined64Merge(page_view_events),0),
		quantileTDigestMerge(0.75)(lcp_p75),coalesce(uniqCombined64Merge(lcp_samples),0),
		quantileTDigestMerge(0.75)(inp_p75),coalesce(uniqCombined64Merge(inp_samples),0),
		quantileTDigestMerge(0.75)(cls_p75),coalesce(uniqCombined64Merge(cls_samples),0)
		FROM project_metrics_1m WHERE `+where+` AND route!='' GROUP BY route
		ORDER BY `+metricQuantileColumn(filters.Metric)+` DESC LIMIT 100`, arguments...)
	if err != nil {
		return nil, fmt.Errorf("query performance routes: %w", err)
	}
	defer func() { _ = rows.Close() }()
	results := make([]RoutePerformance, 0)
	for rows.Next() {
		var current RoutePerformance
		var lcp, inp, cls sql.NullFloat64
		if err := rows.Scan(&current.Route, &current.PageViews, &lcp, &current.LCP.Samples, &inp, &current.INP.Samples, &cls, &current.CLS.Samples); err != nil {
			return nil, err
		}
		current.LCP = finalizeNullableMetric(lcp, current.LCP.Samples)
		current.INP = finalizeNullableMetric(inp, current.INP.Samples)
		current.CLS = finalizeNullableMetric(cls, current.CLS.Samples)
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
	quantile, samples := metricColumns(filters.Metric)
	interval := performanceInterval(filters.To.Sub(filters.From))
	rows, err := repository.database.QueryContext(ctx, `SELECT toStartOfInterval(bucket, INTERVAL `+interval+`) AS point,
		quantileTDigestMerge(0.75)(`+quantile+`),coalesce(uniqCombined64Merge(`+samples+`),0)
		FROM project_metrics_1m WHERE `+where+` GROUP BY point ORDER BY point`, arguments...)
	if err != nil {
		return nil, fmt.Errorf("query performance trend: %w", err)
	}
	defer func() { _ = rows.Close() }()
	result := make([]PerformancePoint, 0)
	for rows.Next() {
		var current PerformancePoint
		var value sql.NullFloat64
		if err := rows.Scan(&current.Bucket, &value, &current.Metric.Samples); err != nil {
			return nil, err
		}
		current.Bucket = current.Bucket.UTC()
		current.Metric = finalizeNullableMetric(value, current.Metric.Samples)
		result = append(result, current)
	}
	return result, rows.Err()
}

func (repository *PerformanceRepository) facets(ctx context.Context, filters PerformanceFilters, dimension string) ([]PerformanceFacet, error) {
	where, arguments := performanceAggregateWhere(filters, true)
	quantile, samples := metricColumns(filters.Metric)
	rows, err := repository.database.QueryContext(ctx, `SELECT `+dimension+`,quantileTDigestMerge(0.75)(`+quantile+`),coalesce(uniqCombined64Merge(`+samples+`),0)
		FROM project_metrics_1m WHERE `+where+` AND `+dimension+`!='' GROUP BY `+dimension+` ORDER BY uniqCombined64Merge(`+samples+`) DESC LIMIT 20`, arguments...)
	if err != nil {
		return nil, fmt.Errorf("query performance %s facets: %w", dimension, err)
	}
	defer func() { _ = rows.Close() }()
	result := make([]PerformanceFacet, 0)
	for rows.Next() {
		var current PerformanceFacet
		var value sql.NullFloat64
		if err := rows.Scan(&current.Value, &value, &current.Metric.Samples); err != nil {
			return nil, err
		}
		current.Metric = finalizeNullableMetric(value, current.Metric.Samples)
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
	where := "project_id=? AND bucket>=? AND bucket<?"
	arguments := []any{filters.ProjectID, filters.From, filters.To}
	for _, item := range []struct{ column, value string }{{"environment", filters.Environment}, {"release", filters.Release}} {
		if item.value != "" {
			where += " AND " + item.column + "=?"
			arguments = append(arguments, item.value)
		}
	}
	if includeRoute {
		where += " AND route=?"
		arguments = append(arguments, filters.Route)
	}
	return where, arguments
}

func performanceRawWhere(filters PerformanceFilters) (string, []any) {
	where := "project_id=? AND timestamp>=? AND timestamp<? AND metric_name=? AND route=? AND NOT has(ingest_flags,'synthetic')"
	arguments := []any{filters.ProjectID, filters.From, filters.To, filters.Metric, filters.Route}
	for _, item := range []struct{ column, value string }{{"environment", filters.Environment}, {"release", filters.Release}} {
		if item.value != "" {
			where += " AND " + item.column + "=?"
			arguments = append(arguments, item.value)
		}
	}
	return where, arguments
}

func metricColumns(metric string) (string, string) {
	switch metric {
	case "INP":
		return "inp_p75", "inp_samples"
	case "CLS":
		return "cls_p75", "cls_samples"
	default:
		return "lcp_p75", "lcp_samples"
	}
}

func metricQuantileColumn(metric string) string {
	column, _ := metricColumns(metric)
	return "quantileTDigestMerge(0.75)(" + column + ")"
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

func performanceInterval(window time.Duration) string {
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

func finalizeMetric(value float64, samples uint64) PerformanceMetric {
	metric := PerformanceMetric{Samples: samples, Sufficient: samples >= minimumPerformanceSamples}
	if samples > 0 && !math.IsNaN(value) && !math.IsInf(value, 0) {
		metric.P75 = &value
	}
	return metric
}

func finalizeNullableMetric(value sql.NullFloat64, samples uint64) PerformanceMetric {
	if !value.Valid {
		return PerformanceMetric{Samples: samples, Sufficient: samples >= minimumPerformanceSamples}
	}
	return finalizeMetric(value.Float64, samples)
}

func containsControl(value string) bool {
	for _, character := range value {
		if character < 0x20 || character == 0x7f {
			return true
		}
	}
	return false
}
