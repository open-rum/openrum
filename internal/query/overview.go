package query

import (
	"context"
	"database/sql"
	"fmt"
	"math"
	"time"
)

const minimumVitalSamples = 50

type CountMetric struct {
	Value   float64 `json:"value"`
	Samples uint64  `json:"samples"`
}

type CardinalityMetric struct {
	Value       uint64 `json:"value"`
	Samples     uint64 `json:"samples"`
	Approximate bool   `json:"approximate"`
}

type RateMetric struct {
	Value              *float64 `json:"value"`
	Numerator          float64  `json:"numerator"`
	Denominator        float64  `json:"denominator"`
	NumeratorSamples   uint64   `json:"numeratorSamples"`
	DenominatorSamples uint64   `json:"denominatorSamples"`
}

type VitalMetric struct {
	P75        *float64 `json:"p75"`
	Samples    uint64   `json:"samples"`
	Sufficient bool     `json:"sufficient"`
}

type OverviewKPIs struct {
	PageViews      CountMetric       `json:"pageViews"`
	UniqueUsers    CardinalityMetric `json:"uniqueUsers"`
	ErrorRate      RateMetric        `json:"errorRate"`
	APIFailureRate RateMetric        `json:"apiFailureRate"`
	LCP            VitalMetric       `json:"lcp"`
	INP            VitalMetric       `json:"inp"`
	CLS            VitalMetric       `json:"cls"`
}

type OverviewChanges struct {
	PageViewsPercent     *float64 `json:"pageViewsPercent"`
	UniqueUsersPercent   *float64 `json:"uniqueUsersPercent"`
	ErrorRatePoints      *float64 `json:"errorRatePoints"`
	APIFailureRatePoints *float64 `json:"apiFailureRatePoints"`
	LCPPercent           *float64 `json:"lcpPercent"`
	INPPercent           *float64 `json:"inpPercent"`
	CLSPercent           *float64 `json:"clsPercent"`
}

type OverviewComparison struct {
	From     time.Time       `json:"from"`
	To       time.Time       `json:"to"`
	Previous OverviewKPIs    `json:"previous"`
	Changes  OverviewChanges `json:"changes"`
}

type OverviewPoint struct {
	Bucket         time.Time         `json:"bucket"`
	PageViews      CountMetric       `json:"pageViews"`
	UniqueUsers    CardinalityMetric `json:"uniqueUsers"`
	ErrorRate      RateMetric        `json:"errorRate"`
	APIFailureRate RateMetric        `json:"apiFailureRate"`
	LCP            VitalMetric       `json:"lcp"`
	INP            VitalMetric       `json:"inp"`
	CLS            VitalMetric       `json:"cls"`
}

type OverviewIssue struct {
	Fingerprint string     `json:"fingerprint"`
	Title       string     `json:"title"`
	Events      uint64     `json:"events"`
	Users       uint64     `json:"users"`
	LastSeenAt  *time.Time `json:"lastSeenAt"`
}

type OverviewFreshness struct {
	LatestReceivedAt *time.Time `json:"latestReceivedAt"`
	AgeSeconds       *float64   `json:"ageSeconds"`
	Stale            bool       `json:"stale"`
}

type Overview struct {
	From            time.Time          `json:"from"`
	To              time.Time          `json:"to"`
	IntervalSeconds int64              `json:"intervalSeconds"`
	KPIs            OverviewKPIs       `json:"kpis"`
	Comparison      OverviewComparison `json:"comparison"`
	Series          []OverviewPoint    `json:"series"`
	TopIssues       []OverviewIssue    `json:"topIssues"`
	Freshness       OverviewFreshness  `json:"freshness"`
}

type OverviewRepository struct {
	database *sql.DB
	now      func() time.Time
}

func NewOverviewRepository(database *sql.DB) *OverviewRepository {
	return &OverviewRepository{database: database, now: time.Now}
}

func (repository *OverviewRepository) Get(ctx context.Context, requested OverviewFilters) (Overview, error) {
	filters, err := NormalizeOverviewFilters(requested)
	if err != nil {
		return Overview{}, err
	}
	current, err := repository.readKPIs(ctx, filters)
	if err != nil {
		return Overview{}, err
	}
	previousFilters := filters.previousPeriod()
	previous, err := repository.readKPIs(ctx, previousFilters)
	if err != nil {
		return Overview{}, err
	}
	interval := overviewInterval(filters.To.Sub(filters.From))
	if filters.MaxPoints > 0 {
		interval = adaptiveSeriesInterval(filters.To.Sub(filters.From), filters.MaxPoints)
	}
	series, err := repository.readSeries(ctx, filters, interval)
	if err != nil {
		return Overview{}, err
	}
	topIssues, err := repository.readTopIssues(ctx, filters)
	if err != nil {
		return Overview{}, err
	}
	freshness, err := repository.readFreshness(ctx, filters)
	if err != nil {
		return Overview{}, err
	}
	return Overview{
		From: filters.From, To: filters.To, IntervalSeconds: int64(interval / time.Second),
		KPIs: current,
		Comparison: OverviewComparison{
			From: previousFilters.From, To: previousFilters.To, Previous: previous,
			Changes: compareKPIs(current, previous),
		},
		Series:    series,
		TopIssues: topIssues,
		Freshness: freshness,
	}, nil
}

func (repository *OverviewRepository) readTopIssues(ctx context.Context, filters OverviewFilters) ([]OverviewIssue, error) {
	where, arguments := filters.where(true)
	rows, err := repository.database.QueryContext(ctx, `
SELECT fingerprint, argMaxMerge(error_message),
  uniqCombined64Merge(events) AS event_count,
  uniqCombined64Merge(users) AS user_count,
  maxMerge(last_seen) AS last_seen_at
FROM issue_metrics_5m WHERE `+where+`
GROUP BY fingerprint
ORDER BY event_count DESC, last_seen_at DESC, fingerprint
LIMIT 5`, arguments...)
	if err != nil {
		return nil, fmt.Errorf("query overview issues: %w", err)
	}
	defer func() { _ = rows.Close() }()
	results := make([]OverviewIssue, 0)
	for rows.Next() {
		var issue OverviewIssue
		var lastSeen time.Time
		if err := rows.Scan(&issue.Fingerprint, &issue.Title, &issue.Events, &issue.Users, &lastSeen); err != nil {
			return nil, fmt.Errorf("scan overview issue: %w", err)
		}
		lastSeen = lastSeen.UTC()
		issue.LastSeenAt = &lastSeen
		results = append(results, issue)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate overview issues: %w", err)
	}
	return results, nil
}

const overviewKPISelect = `
SELECT
  coalesce(uniqCombined64Merge(page_view_events), 0), sumMerge(page_view_estimated),
  coalesce(uniqCombined64Merge(unique_users), 0),
  coalesce(uniqCombined64Merge(error_events), 0), sumMerge(error_estimated),
  coalesce(uniqCombined64Merge(api_requests), 0), coalesce(uniqCombined64Merge(api_failures), 0),
  quantileTDigestMerge(0.75)(lcp_p75), coalesce(uniqCombined64Merge(lcp_samples), 0),
  quantileTDigestMerge(0.75)(inp_p75), coalesce(uniqCombined64Merge(inp_samples), 0),
  quantileTDigestMerge(0.75)(cls_p75), coalesce(uniqCombined64Merge(cls_samples), 0)
FROM project_metrics_1m WHERE `

func (repository *OverviewRepository) readKPIs(ctx context.Context, filters OverviewFilters) (OverviewKPIs, error) {
	where, arguments := filters.where(true)
	row, err := scanKPIRow(repository.database.QueryRowContext(ctx, overviewKPISelect+where, arguments...))
	if err != nil {
		return OverviewKPIs{}, fmt.Errorf("query overview KPIs: %w", err)
	}
	return row.kpis(), nil
}

func (repository *OverviewRepository) readSeries(ctx context.Context, filters OverviewFilters, interval time.Duration) ([]OverviewPoint, error) {
	where, arguments := filters.where(true)
	minutes := int(interval / time.Minute)
	query := fmt.Sprintf(`
SELECT
  toStartOfInterval(bucket, INTERVAL %d MINUTE) AS point,
  coalesce(uniqCombined64Merge(page_view_events), 0), sumMerge(page_view_estimated),
  coalesce(uniqCombined64Merge(unique_users), 0),
  coalesce(uniqCombined64Merge(error_events), 0), sumMerge(error_estimated),
  coalesce(uniqCombined64Merge(api_requests), 0), coalesce(uniqCombined64Merge(api_failures), 0),
  quantileTDigestMerge(0.75)(lcp_p75), coalesce(uniqCombined64Merge(lcp_samples), 0),
  quantileTDigestMerge(0.75)(inp_p75), coalesce(uniqCombined64Merge(inp_samples), 0),
  quantileTDigestMerge(0.75)(cls_p75), coalesce(uniqCombined64Merge(cls_samples), 0)
FROM project_metrics_1m WHERE %s
GROUP BY point ORDER BY point`, minutes, where)
	rows, err := repository.database.QueryContext(ctx, query, arguments...)
	if err != nil {
		return nil, fmt.Errorf("query overview series: %w", err)
	}
	defer func() { _ = rows.Close() }()
	points := make([]OverviewPoint, 0)
	for rows.Next() {
		var bucket time.Time
		row, scanErr := scanKPIRowWithBucket(rows, &bucket)
		if scanErr != nil {
			return nil, fmt.Errorf("scan overview series: %w", scanErr)
		}
		kpis := row.kpis()
		points = append(points, OverviewPoint{
			Bucket: bucket.UTC(), PageViews: kpis.PageViews, UniqueUsers: kpis.UniqueUsers,
			ErrorRate: kpis.ErrorRate, APIFailureRate: kpis.APIFailureRate,
			LCP: kpis.LCP, INP: kpis.INP, CLS: kpis.CLS,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate overview series: %w", err)
	}
	return points, nil
}

func (repository *OverviewRepository) readFreshness(ctx context.Context, filters OverviewFilters) (OverviewFreshness, error) {
	where, arguments := filters.where(false)
	var rows uint64
	var latest time.Time
	if err := repository.database.QueryRowContext(ctx,
		"SELECT count(), maxMerge(latest_received_at) FROM project_metrics_1m WHERE "+where,
		arguments...,
	).Scan(&rows, &latest); err != nil {
		return OverviewFreshness{}, fmt.Errorf("query overview freshness: %w", err)
	}
	if rows == 0 {
		return OverviewFreshness{}, nil
	}
	latest = latest.UTC()
	age := repository.now().UTC().Sub(latest).Seconds()
	if age < 0 {
		age = 0
	}
	return OverviewFreshness{LatestReceivedAt: &latest, AgeSeconds: &age, Stale: age > 60}, nil
}

type kpiRow struct {
	pageViewSamples uint64
	pageViews       float64
	uniqueUsers     uint64
	errorSamples    uint64
	errors          float64
	apiSamples      uint64
	apiFailures     uint64
	lcp             sql.NullFloat64
	lcpSamples      uint64
	inp             sql.NullFloat64
	inpSamples      uint64
	cls             sql.NullFloat64
	clsSamples      uint64
}

type rowScanner interface {
	Scan(...any) error
}

func scanKPIRow(scanner rowScanner) (kpiRow, error) {
	var row kpiRow
	err := scanner.Scan(
		&row.pageViewSamples, &row.pageViews, &row.uniqueUsers,
		&row.errorSamples, &row.errors, &row.apiSamples, &row.apiFailures,
		&row.lcp, &row.lcpSamples, &row.inp, &row.inpSamples, &row.cls, &row.clsSamples,
	)
	return row, err
}

func scanKPIRowWithBucket(scanner rowScanner, bucket *time.Time) (kpiRow, error) {
	var row kpiRow
	err := scanner.Scan(
		bucket, &row.pageViewSamples, &row.pageViews, &row.uniqueUsers,
		&row.errorSamples, &row.errors, &row.apiSamples, &row.apiFailures,
		&row.lcp, &row.lcpSamples, &row.inp, &row.inpSamples, &row.cls, &row.clsSamples,
	)
	return row, err
}

func (row kpiRow) kpis() OverviewKPIs {
	return OverviewKPIs{
		PageViews:   CountMetric{Value: row.pageViews, Samples: row.pageViewSamples},
		UniqueUsers: CardinalityMetric{Value: row.uniqueUsers, Samples: row.pageViewSamples, Approximate: true},
		ErrorRate: RateMetric{
			Value: ratio(row.errors, row.pageViews), Numerator: row.errors, Denominator: row.pageViews,
			NumeratorSamples: row.errorSamples, DenominatorSamples: row.pageViewSamples,
		},
		APIFailureRate: RateMetric{
			Value: ratio(float64(row.apiFailures), float64(row.apiSamples)), Numerator: float64(row.apiFailures),
			Denominator: float64(row.apiSamples), NumeratorSamples: row.apiFailures, DenominatorSamples: row.apiSamples,
		},
		LCP: vital(row.lcp, row.lcpSamples), INP: vital(row.inp, row.inpSamples), CLS: vital(row.cls, row.clsSamples),
	}
}

func vital(value sql.NullFloat64, samples uint64) VitalMetric {
	var p75 *float64
	if value.Valid {
		p75 = finiteValue(value.Float64, samples)
	}
	return VitalMetric{P75: p75, Samples: samples, Sufficient: samples >= minimumVitalSamples}
}

func finiteValue(value float64, samples uint64) *float64 {
	if samples == 0 || math.IsNaN(value) || math.IsInf(value, 0) {
		return nil
	}
	return &value
}

func ratio(numerator, denominator float64) *float64 {
	if denominator <= 0 || math.IsNaN(numerator) || math.IsNaN(denominator) {
		return nil
	}
	value := numerator / denominator
	return &value
}

func compareKPIs(current, previous OverviewKPIs) OverviewChanges {
	return OverviewChanges{
		PageViewsPercent:     percentChange(current.PageViews.Value, previous.PageViews.Value),
		UniqueUsersPercent:   percentChange(float64(current.UniqueUsers.Value), float64(previous.UniqueUsers.Value)),
		ErrorRatePoints:      ratePointChange(current.ErrorRate.Value, previous.ErrorRate.Value),
		APIFailureRatePoints: ratePointChange(current.APIFailureRate.Value, previous.APIFailureRate.Value),
		LCPPercent:           percentChangeOptional(current.LCP.P75, previous.LCP.P75),
		INPPercent:           percentChangeOptional(current.INP.P75, previous.INP.P75),
		CLSPercent:           percentChangeOptional(current.CLS.P75, previous.CLS.P75),
	}
}

func percentChange(current, previous float64) *float64 {
	if previous == 0 || math.IsNaN(current) || math.IsNaN(previous) {
		return nil
	}
	value := (current - previous) / previous * 100
	return &value
}

func percentChangeOptional(current, previous *float64) *float64 {
	if current == nil || previous == nil {
		return nil
	}
	return percentChange(*current, *previous)
}

func ratePointChange(current, previous *float64) *float64 {
	if current == nil || previous == nil {
		return nil
	}
	value := (*current - *previous) * 100
	return &value
}
