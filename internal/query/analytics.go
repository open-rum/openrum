package query

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
)

const (
	behaviorBreakdownLimit = 100
	behaviorSampleLimit    = 50
	behaviorMaxRange       = 30 * 24 * time.Hour
	behaviorBudgetUnits    = int64(3 * 7 * 24 * 60)
)

var (
	ErrInvalidBehaviorFilters      = errors.New("invalid behavior analytics filters")
	ErrBehaviorQueryTooExpensive   = errors.New("behavior analytics query exceeds its scan budget")
	ErrBehaviorCardinalityExceeded = errors.New("behavior analytics dimension exceeds its cardinality budget")
	behaviorPropertyPattern        = regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$`)
)

type BehaviorFilters struct {
	ProjectID   uuid.UUID
	From        time.Time
	To          time.Time
	Environment string
	EventKind   string
	EventName   string
	Dimension   string
	MaxPoints   int
	// Measurement names a Custom Event measurement to break down by Dimension. Empty
	// leaves the breakdown out; the per-key summary is returned either way.
	Measurement string
}

type BehaviorMetric struct {
	Events         uint64  `json:"events"`
	Estimated      float64 `json:"estimated"`
	UniqueUsers    uint64  `json:"uniqueUsers"`
	UniqueSessions uint64  `json:"uniqueSessions"`
	Approximate    bool    `json:"approximate"`
}

type BehaviorTrendPoint struct {
	Bucket time.Time      `json:"bucket"`
	Metric BehaviorMetric `json:"metric"`
}

type BehaviorBreakdown struct {
	Value  string         `json:"value"`
	Metric BehaviorMetric `json:"metric"`
}

type BehaviorEventSummary struct {
	Kind   string         `json:"kind"`
	Name   string         `json:"name"`
	Metric BehaviorMetric `json:"metric"`
}

type BehaviorPropertySummary struct {
	Name        string `json:"name"`
	Events      uint64 `json:"events"`
	Cardinality uint64 `json:"cardinality"`
}

type BehaviorFreshness struct {
	LatestReceivedAt *time.Time `json:"latestReceivedAt"`
	AgeSeconds       *float64   `json:"ageSeconds"`
	Stale            bool       `json:"stale"`
}

type BehaviorAnalytics struct {
	From       time.Time                 `json:"from"`
	To         time.Time                 `json:"to"`
	Dimension  string                    `json:"dimension"`
	Interval   string                    `json:"interval"`
	Totals     BehaviorMetric            `json:"totals"`
	Trend      []BehaviorTrendPoint      `json:"trend"`
	Breakdown  []BehaviorBreakdown       `json:"breakdown"`
	Catalog    []BehaviorEventSummary    `json:"catalog"`
	Properties []BehaviorPropertySummary `json:"properties"`
	// Numeric Custom Event measurements. Summary is every key; Breakdown is the one
	// named by the Measurement filter, split by Dimension, and is null without it.
	Measurements         []BehaviorMeasurementSummary `json:"measurements"`
	MeasurementBreakdown []MeasurementBreakdownRow    `json:"measurementBreakdown,omitempty"`
	Freshness            BehaviorFreshness            `json:"freshness"`
	SampleCount          uint64                       `json:"sampleCount"`
	RowLimit             int                          `json:"rowLimit"`
}

type BehaviorSample struct {
	EventID     uuid.UUID         `json:"eventId"`
	Timestamp   time.Time         `json:"timestamp"`
	Kind        string            `json:"kind"`
	Name        string            `json:"name"`
	Route       string            `json:"route,omitempty"`
	PageURL     string            `json:"pageUrl,omitempty"`
	Browser     string            `json:"browser,omitempty"`
	Device      string            `json:"device,omitempty"`
	Country     string            `json:"country,omitempty"`
	SessionID   uuid.UUID         `json:"sessionId"`
	VisitorID   string            `json:"visitorId,omitempty"`
	Attributes  map[string]string `json:"attributes"`
	Breadcrumbs []string          `json:"breadcrumbs"`
}

type BehaviorSamplePage struct {
	Samples []BehaviorSample `json:"samples"`
	Limit   int              `json:"limit"`
}

type BehaviorRepository struct {
	database *sql.DB
	now      func() time.Time
}

func NewBehaviorRepository(database *sql.DB) *BehaviorRepository {
	return &BehaviorRepository{database: database, now: time.Now}
}

func NormalizeBehaviorFilters(filters BehaviorFilters) (BehaviorFilters, error) {
	filters.From, filters.To = filters.From.UTC(), filters.To.UTC()
	filters.Environment = strings.TrimSpace(filters.Environment)
	filters.EventKind = strings.TrimSpace(filters.EventKind)
	filters.EventName = strings.TrimSpace(filters.EventName)
	filters.Dimension = strings.TrimSpace(filters.Dimension)
	if filters.Dimension == "" {
		filters.Dimension = "country"
	}
	if filters.ProjectID == uuid.Nil || filters.From.IsZero() || !filters.From.Before(filters.To) ||
		filters.To.Sub(filters.From) > behaviorMaxRange || !validSeriesPointBudget(filters.MaxPoints) ||
		!boundedQueryDimension(filters.Environment, 64) || !boundedQueryDimension(filters.EventName, 80) ||
		containsControl(filters.EventKind+filters.Dimension) || !validBehaviorKind(filters.EventKind) || !validBehaviorDimension(filters.Dimension) {
		return BehaviorFilters{}, ErrInvalidBehaviorFilters
	}
	filters.Measurement = strings.TrimSpace(filters.Measurement)
	// A breakdown needs a real dimension to split on, and `all` is not one.
	if filters.Measurement != "" &&
		(!ValidMeasurementName(filters.Measurement) || !measurementDimensionSupported(filters.Dimension)) {
		return BehaviorFilters{}, ErrInvalidBehaviorFilters
	}
	return filters, nil
}

func CheckBehaviorBudget(requested BehaviorFilters) error {
	filters, err := NormalizeBehaviorFilters(requested)
	if err != nil {
		return err
	}
	units := int64(filters.To.Sub(filters.From).Minutes()+0.999) * 3
	if strings.HasPrefix(filters.Dimension, "property:") {
		units *= 4
	}
	if filters.Environment != "" {
		units = max(1, units/4)
	}
	if filters.EventKind != "" || filters.EventName != "" {
		units = max(1, units/4)
	}
	// The measurement breakdown adds a scan of a second aggregate. It is charged rather
	// than exempted so a wide range cannot be made affordable by moving to it.
	if filters.Measurement != "" {
		units += units / 2
	}
	if units > behaviorBudgetUnits {
		return ErrBehaviorQueryTooExpensive
	}
	return nil
}

func (repository *BehaviorRepository) Get(ctx context.Context, requested BehaviorFilters) (BehaviorAnalytics, error) {
	filters, err := NormalizeBehaviorFilters(requested)
	if err != nil {
		return BehaviorAnalytics{}, err
	}
	if err := CheckBehaviorBudget(filters); err != nil {
		return BehaviorAnalytics{}, err
	}
	interval := performanceInterval(filters.To.Sub(filters.From))
	if filters.MaxPoints > 0 {
		interval = fmt.Sprintf("%d MINUTE", int(adaptiveSeriesInterval(filters.To.Sub(filters.From), filters.MaxPoints)/time.Minute))
	}
	totals, latest, err := repository.totals(ctx, filters)
	if err != nil {
		return BehaviorAnalytics{}, err
	}
	trend, err := repository.trend(ctx, filters, interval)
	if err != nil {
		return BehaviorAnalytics{}, err
	}
	breakdown, err := repository.breakdown(ctx, filters)
	if err != nil {
		return BehaviorAnalytics{}, err
	}
	catalog, err := repository.catalog(ctx, filters)
	if err != nil {
		return BehaviorAnalytics{}, err
	}
	properties, err := repository.properties(ctx, filters)
	if err != nil {
		return BehaviorAnalytics{}, err
	}
	measurements, err := repository.measurements(ctx, filters)
	if err != nil {
		return BehaviorAnalytics{}, err
	}
	var measurementBreakdown []MeasurementBreakdownRow
	if filters.Measurement != "" {
		measurementBreakdown, err = repository.measurementBreakdown(ctx, filters)
		if err != nil {
			return BehaviorAnalytics{}, err
		}
	}
	return BehaviorAnalytics{
		From: filters.From, To: filters.To, Dimension: filters.Dimension, Interval: interval,
		Totals: totals, Trend: trend, Breakdown: breakdown, Catalog: catalog, Properties: properties,
		Measurements: measurements, MeasurementBreakdown: measurementBreakdown,
		Freshness:   behaviorFreshness(latest, repository.now()),
		SampleCount: totals.Events, RowLimit: behaviorDimensionLimit(filters.Dimension),
	}, nil
}

func (repository *BehaviorRepository) ListSamples(ctx context.Context, requested BehaviorFilters) (BehaviorSamplePage, error) {
	filters, err := NormalizeBehaviorFilters(requested)
	if err != nil || filters.To.Sub(filters.From) > 24*time.Hour || (filters.EventKind == "" && filters.EventName == "") {
		return BehaviorSamplePage{}, ErrInvalidBehaviorFilters
	}
	if err := normalizeBehaviorSampleEvent(&filters); err != nil {
		return BehaviorSamplePage{}, err
	}
	where, arguments := behaviorRawWhere(filters)
	rows, err := repository.database.QueryContext(ctx, `SELECT event_id,timestamp,
		multiIf(event_type='page_view' AND navigation_type='route_change','navigation',event_type='page_view','page_view',custom_name='ui.click','click','custom') AS behavior_kind,
		if(event_type='custom' AND custom_name!='ui.click',custom_name,behavior_kind) AS behavior_name,
		route,page_url_normalized,browser,device_type,toString(country),session_id,anonymous_user_id,attributes,breadcrumbs
		FROM rum_events WHERE `+where+`
		ORDER BY timestamp DESC,received_at DESC,event_id DESC LIMIT 1 BY event_id LIMIT ?`, append(arguments, behaviorSampleLimit)...)
	if err != nil {
		return BehaviorSamplePage{}, fmt.Errorf("query behavior samples: %w", err)
	}
	defer func() { _ = rows.Close() }()
	result := BehaviorSamplePage{Samples: make([]BehaviorSample, 0), Limit: behaviorSampleLimit}
	for rows.Next() {
		var sample BehaviorSample
		if err := rows.Scan(&sample.EventID, &sample.Timestamp, &sample.Kind, &sample.Name, &sample.Route, &sample.PageURL,
			&sample.Browser, &sample.Device, &sample.Country, &sample.SessionID, &sample.VisitorID, &sample.Attributes, &sample.Breadcrumbs); err != nil {
			return BehaviorSamplePage{}, fmt.Errorf("scan behavior sample: %w", err)
		}
		sample.Timestamp = sample.Timestamp.UTC()
		if sample.Attributes == nil {
			sample.Attributes = map[string]string{}
		}
		if sample.Breadcrumbs == nil {
			sample.Breadcrumbs = []string{}
		}
		result.Samples = append(result.Samples, sample)
	}
	return result, rows.Err()
}

func (repository *BehaviorRepository) catalog(ctx context.Context, filters BehaviorFilters) ([]BehaviorEventSummary, error) {
	filters.EventKind, filters.EventName = "", ""
	where, arguments := behaviorWhere(filters, "all")
	rows, err := repository.database.QueryContext(ctx, `SELECT event_kind,event_name,
		uniqCombined64Merge(events) AS event_count,sumMerge(estimated),coalesce(uniqCombined64Merge(unique_users),0),coalesce(uniqCombined64Merge(unique_sessions),0)
		FROM behavior_metrics_1m WHERE `+where+`
		GROUP BY event_kind,event_name ORDER BY event_count DESC,event_kind,event_name LIMIT 200`, arguments...)
	if err != nil {
		return nil, fmt.Errorf("query behavior event catalog: %w", err)
	}
	defer func() { _ = rows.Close() }()
	result := make([]BehaviorEventSummary, 0)
	for rows.Next() {
		var item BehaviorEventSummary
		if err := rows.Scan(&item.Kind, &item.Name, &item.Metric.Events, &item.Metric.Estimated, &item.Metric.UniqueUsers, &item.Metric.UniqueSessions); err != nil {
			return nil, fmt.Errorf("scan behavior event catalog: %w", err)
		}
		item.Metric.Approximate = true
		result = append(result, item)
	}
	return result, rows.Err()
}

func (repository *BehaviorRepository) properties(ctx context.Context, filters BehaviorFilters) ([]BehaviorPropertySummary, error) {
	where, arguments := behaviorBaseWhere(filters)
	rows, err := repository.database.QueryContext(ctx, `SELECT dimension,
		uniqCombined64Merge(events) AS event_count,uniqCombined64(dimension_value) AS cardinality
		FROM behavior_metrics_1m WHERE `+where+` AND startsWith(dimension,'property:')
		GROUP BY dimension ORDER BY event_count DESC,dimension LIMIT 100`, arguments...)
	if err != nil {
		return nil, fmt.Errorf("query behavior properties: %w", err)
	}
	defer func() { _ = rows.Close() }()
	result := make([]BehaviorPropertySummary, 0)
	for rows.Next() {
		var item BehaviorPropertySummary
		if err := rows.Scan(&item.Name, &item.Events, &item.Cardinality); err != nil {
			return nil, fmt.Errorf("scan behavior property: %w", err)
		}
		item.Name = strings.TrimPrefix(item.Name, "property:")
		result = append(result, item)
	}
	return result, rows.Err()
}

func (repository *BehaviorRepository) totals(ctx context.Context, filters BehaviorFilters) (BehaviorMetric, *time.Time, error) {
	where, arguments := behaviorWhere(filters, filters.Dimension)
	var metric BehaviorMetric
	var latest sql.NullTime
	err := repository.database.QueryRowContext(ctx, `SELECT
		coalesce(uniqCombined64Merge(events),0),coalesce(sumMerge(estimated),0),
		coalesce(uniqCombined64Merge(unique_users),0),coalesce(uniqCombined64Merge(unique_sessions),0),
		maxMerge(latest_received_at)
		FROM behavior_metrics_1m WHERE `+where, arguments...).Scan(
		&metric.Events, &metric.Estimated, &metric.UniqueUsers, &metric.UniqueSessions, &latest,
	)
	if err != nil {
		return BehaviorMetric{}, nil, fmt.Errorf("query behavior totals: %w", err)
	}
	metric.Approximate = true
	if !latest.Valid || metric.Events == 0 {
		return metric, nil, nil
	}
	value := latest.Time.UTC()
	return metric, &value, nil
}

func (repository *BehaviorRepository) trend(ctx context.Context, filters BehaviorFilters, interval string) ([]BehaviorTrendPoint, error) {
	where, arguments := behaviorWhere(filters, filters.Dimension)
	rows, err := repository.database.QueryContext(ctx, `SELECT toStartOfInterval(bucket, INTERVAL `+interval+`) AS point,
		uniqCombined64Merge(events),sumMerge(estimated),coalesce(uniqCombined64Merge(unique_users),0),coalesce(uniqCombined64Merge(unique_sessions),0)
		FROM behavior_metrics_1m WHERE `+where+` GROUP BY point ORDER BY point`, arguments...)
	if err != nil {
		return nil, fmt.Errorf("query behavior trend: %w", err)
	}
	defer func() { _ = rows.Close() }()
	result := make([]BehaviorTrendPoint, 0)
	for rows.Next() {
		var point BehaviorTrendPoint
		if err := rows.Scan(&point.Bucket, &point.Metric.Events, &point.Metric.Estimated, &point.Metric.UniqueUsers, &point.Metric.UniqueSessions); err != nil {
			return nil, fmt.Errorf("scan behavior trend: %w", err)
		}
		point.Bucket, point.Metric.Approximate = point.Bucket.UTC(), true
		result = append(result, point)
	}
	return result, rows.Err()
}

func behaviorDimensionLimit(dimension string) int {
	// Allow the full set of ISO countries/regions plus unknown on a world map.
	// Higher-cardinality device, browser and custom dimensions keep their budget.
	if dimension == "country" {
		return 250
	}
	return behaviorBreakdownLimit
}

func (repository *BehaviorRepository) breakdown(ctx context.Context, filters BehaviorFilters) ([]BehaviorBreakdown, error) {
	limit := behaviorDimensionLimit(filters.Dimension)
	where, arguments := behaviorWhere(filters, filters.Dimension)
	rows, err := repository.database.QueryContext(ctx, `SELECT dimension_value,
		uniqCombined64Merge(events) AS event_count,sumMerge(estimated),coalesce(uniqCombined64Merge(unique_users),0),coalesce(uniqCombined64Merge(unique_sessions),0)
		FROM behavior_metrics_1m WHERE `+where+`
		GROUP BY dimension_value ORDER BY event_count DESC,dimension_value LIMIT ?`, append(arguments, limit+1)...)
	if err != nil {
		return nil, fmt.Errorf("query behavior breakdown: %w", err)
	}
	defer func() { _ = rows.Close() }()
	result := make([]BehaviorBreakdown, 0, limit)
	for rows.Next() {
		var item BehaviorBreakdown
		if err := rows.Scan(&item.Value, &item.Metric.Events, &item.Metric.Estimated, &item.Metric.UniqueUsers, &item.Metric.UniqueSessions); err != nil {
			return nil, fmt.Errorf("scan behavior breakdown: %w", err)
		}
		item.Metric.Approximate = true
		result = append(result, item)
		if len(result) > limit {
			return nil, ErrBehaviorCardinalityExceeded
		}
	}
	return result, rows.Err()
}

func behaviorWhere(filters BehaviorFilters, dimension string) (string, []any) {
	where, arguments := behaviorBaseWhere(filters)
	where += " AND dimension=?"
	arguments = append(arguments, dimension)
	return where, arguments
}

func behaviorBaseWhere(filters BehaviorFilters) (string, []any) {
	where := "project_id=? AND bucket>=? AND bucket<?"
	arguments := []any{filters.ProjectID, filters.From, filters.To}
	if filters.Environment != "" {
		where += " AND environment=?"
		arguments = append(arguments, filters.Environment)
	}
	if filters.EventKind != "" {
		where += " AND event_kind=?"
		arguments = append(arguments, filters.EventKind)
	}
	if filters.EventName != "" {
		where += " AND event_name=?"
		arguments = append(arguments, filters.EventName)
	}
	return where, arguments
}

func behaviorRawWhere(filters BehaviorFilters) (string, []any) {
	where := "project_id=? AND timestamp>=? AND timestamp<? AND event_type IN ('page_view','custom') AND NOT has(ingest_flags,'synthetic')"
	arguments := []any{filters.ProjectID, filters.From, filters.To}
	if filters.Environment != "" {
		where += " AND environment=?"
		arguments = append(arguments, filters.Environment)
	}
	switch filters.EventKind {
	case "page_view":
		where += " AND event_type='page_view' AND navigation_type!='route_change'"
	case "navigation":
		where += " AND event_type='page_view' AND navigation_type='route_change'"
	case "click":
		where += " AND event_type='custom' AND custom_name='ui.click'"
	case "custom":
		where += " AND event_type='custom' AND custom_name!='ui.click'"
	}
	if filters.EventName != "" && filters.EventKind == "custom" {
		where += " AND custom_name=?"
		arguments = append(arguments, filters.EventName)
	}
	return where, arguments
}

func normalizeBehaviorSampleEvent(filters *BehaviorFilters) error {
	switch filters.EventName {
	case "page_view", "navigation", "click":
		if filters.EventKind != "" && filters.EventKind != filters.EventName {
			return ErrInvalidBehaviorFilters
		}
		filters.EventKind = filters.EventName
	case "":
		return nil
	default:
		if filters.EventKind != "" && filters.EventKind != "custom" {
			return ErrInvalidBehaviorFilters
		}
		filters.EventKind = "custom"
	}
	return nil
}

func validBehaviorKind(value string) bool {
	return value == "" || value == "page_view" || value == "navigation" || value == "click" || value == "custom"
}

func validBehaviorDimension(value string) bool {
	switch value {
	case "country", "device", "browser", "source":
		return true
	}
	return strings.HasPrefix(value, "property:") && behaviorPropertyPattern.MatchString(strings.TrimPrefix(value, "property:"))
}

func behaviorFreshness(latest *time.Time, now time.Time) BehaviorFreshness {
	result := BehaviorFreshness{LatestReceivedAt: latest}
	if latest == nil {
		return result
	}
	age := max(0, now.UTC().Sub(latest.UTC()).Seconds())
	result.AgeSeconds, result.Stale = &age, age > 120
	return result
}
