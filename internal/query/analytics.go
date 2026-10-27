package query

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"openrum/internal/search"
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
	// Query narrows the events by their properties with the shared search, for example
	// attributes.plan:pro. The catalog, property list and measurements describe the whole
	// event and ignore it.
	Query string
}

// behaviorSchema is what the Events search accepts: the event's own properties.
// behaviorSchema is what the Events search narrows by: the dimensions every page shares and
// the events' own properties. Country, device and browser are also rollup dimensions.
var behaviorSchema = search.Schema{
	Fields: []search.Field{
		{Key: "country", Exprs: []string{"country"}, Type: search.Enum, Normalize: upperCountry},
		{Key: "device", Aliases: []string{"deviceType"}, Exprs: []string{"device_type"}, Type: search.Enum},
		{Key: "browser", Exprs: []string{"browser"}, Type: search.Enum},
		{Key: "route", Aliases: []string{"page"}, Exprs: []string{"route", "page_url_normalized"}, Type: search.Text},
		{Key: "release", Exprs: []string{"release"}, Type: search.Text},
	},
	AttributeExpr: "attributes",
	AttributeKey:  behaviorPropertyPattern.MatchString,
}

// behaviorRollupDimensions are the search fields behavior_metrics_1m also keeps as rows.
var behaviorRollupDimensions = map[string]bool{"country": true, "device": true, "browser": true}

// behaviorRollupSearch is the one shape the rollup answers directly: a single condition that
// a dimension (a property, country, device or browser) equals one of some values.
// behavior_metrics_1m counts every value of every such dimension, so the totals and trend for
// plan=pro read the "property:plan" rows whose value is pro. Anything else, such as two
// conditions together, "contains" or a route, reads raw events.
func behaviorRollupSearch(filters BehaviorFilters) (string, []string, bool) {
	terms, err := search.Parse(filters.Query)
	if err != nil || len(terms) != 1 {
		return "", nil, false
	}
	term := terms[0]
	if term.Negated || (term.Operator != search.OpEquals && term.Operator != search.OpIn) {
		return "", nil, false
	}
	if key, isAttribute := strings.CutPrefix(term.Field, "attributes."); isAttribute {
		return "property:" + key, term.Values, true
	}
	field, ok := behaviorSchema.Lookup(term.Field)
	if !ok || !behaviorRollupDimensions[field.Key] {
		return "", nil, false
	}
	values := term.Values
	if field.Normalize != nil {
		values = make([]string, 0, len(term.Values))
		for _, value := range term.Values {
			normalized, valid := field.Normalize(value)
			if !valid {
				return "", nil, false
			}
			values = append(values, normalized)
		}
	}
	return field.Key, values, true
}

// behaviorUsesRawEvents reports whether the search must read rum_events: either it is not the
// single-dimension shape, or the breakdown splits on a different dimension.
func behaviorUsesRawEvents(filters BehaviorFilters) bool {
	if filters.Query == "" {
		return false
	}
	dimension, _, ok := behaviorRollupSearch(filters)
	return !ok || filters.Dimension != dimension
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
	// TopValues are the property's most frequent values, filled only when one event is
	// selected: across events the same property name rarely means the same thing.
	TopValues []BehaviorPropertyValue `json:"topValues,omitempty"`
}

type BehaviorPropertyValue struct {
	Value  string `json:"value"`
	Events uint64 `json:"events"`
}

// behaviorPropertyTopValues is how many values each property lists in the event detail.
const behaviorPropertyTopValues = 5

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
	// Window is the stretch of time the samples were read from: the whole range when it is
	// at most a day, otherwise the day before the event last occurred in it. Nil when the
	// event did not occur at all.
	Window *BehaviorSampleWindow `json:"window,omitempty"`
}

type BehaviorSampleWindow struct {
	From time.Time `json:"from"`
	To   time.Time `json:"to"`
}

// behaviorSampleSpan is how much raw data one samples request may scan.
const behaviorSampleSpan = 24 * time.Hour

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
		containsControl(filters.EventKind+filters.Dimension) || !validBehaviorKind(filters.EventKind) || !validBehaviorDimension(filters.Dimension) ||
		!boundedQueryDimension(filters.Query, search.MaxLength) {
		return BehaviorFilters{}, ErrInvalidBehaviorFilters
	}
	filters.Measurement = strings.TrimSpace(filters.Measurement)
	// A breakdown needs a real dimension to split on, and `all` is not one.
	if filters.Measurement != "" &&
		(!ValidMeasurementName(filters.Measurement) || !measurementDimensionSupported(filters.Dimension)) {
		return BehaviorFilters{}, ErrInvalidBehaviorFilters
	}
	filters.Query = strings.TrimSpace(filters.Query)
	if _, _, err := behaviorSchema.ParseAndCompile(filters.Query, search.Raw); err != nil {
		return BehaviorFilters{}, errors.Join(ErrInvalidBehaviorFilters, err)
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
	// Raw events cost far more per minute than the rollup; a property search that needs them
	// fits a week with an event selected, and a day without one.
	if behaviorUsesRawEvents(filters) {
		units *= 4
	}
	if units > behaviorBudgetUnits {
		return ErrBehaviorQueryTooExpensive
	}
	return nil
}

func (repository *BehaviorRepository) Get(ctx context.Context, requested BehaviorFilters) (BehaviorAnalytics, error) {
	ctx = boundedQueryContext(ctx)
	filters, err := NormalizeBehaviorFilters(requested)
	if err != nil {
		return BehaviorAnalytics{}, err
	}
	if err := CheckBehaviorBudget(filters); err != nil {
		return BehaviorAnalytics{}, err
	}
	interval := legacySeriesInterval(filters.To.Sub(filters.From))
	if filters.MaxPoints > 0 {
		interval = fmt.Sprintf("%d MINUTE", int(adaptiveSeriesInterval(filters.To.Sub(filters.From), filters.MaxPoints)/time.Minute))
	}
	if behaviorUsesRawEvents(filters) {
		return repository.getRaw(ctx, filters, interval)
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
	ctx = boundedQueryContext(ctx)
	filters, err := NormalizeBehaviorFilters(requested)
	if err != nil || (filters.EventKind == "" && filters.EventName == "") {
		return BehaviorSamplePage{}, ErrInvalidBehaviorFilters
	}
	empty := BehaviorSamplePage{Samples: make([]BehaviorSample, 0), Limit: behaviorSampleLimit}
	// Raw events are scanned for one day at most. A longer range reads the day before the
	// event last occurred in it, so a quiet final day does not hide every sample.
	window := BehaviorSampleWindow{From: filters.From, To: filters.To}
	if filters.To.Sub(filters.From) > behaviorSampleSpan {
		latest, found, err := repository.lastOccurrence(ctx, filters)
		if err != nil {
			return BehaviorSamplePage{}, err
		}
		if !found {
			return empty, nil
		}
		window.To = latest.Add(time.Minute)
		if window.To.After(filters.To) {
			window.To = filters.To
		}
		window.From = window.To.Add(-behaviorSampleSpan)
		if window.From.Before(filters.From) {
			window.From = filters.From
		}
	}
	filters.From, filters.To = window.From, window.To
	if err := normalizeBehaviorSampleEvent(&filters); err != nil {
		return BehaviorSamplePage{}, err
	}
	where, arguments := behaviorRawWhere(filters)
	compiled, _, _ := behaviorSchema.ParseAndCompile(filters.Query, search.Raw)
	extra, extraArguments := compiled.WhereSQL()
	where += extra
	arguments = append(arguments, extraArguments...)
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
	result := empty
	result.Window = &window
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
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if filters.EventKind == "" && filters.EventName == "" || len(result) == 0 {
		return result, nil
	}
	values, err := repository.propertyValues(ctx, filters)
	if err != nil {
		return nil, err
	}
	for index := range result {
		result[index].TopValues = values[result[index].Name]
	}
	return result, nil
}

// propertyValues reads the most frequent values of every property of the selected event
// from the rollup in one pass.
func (repository *BehaviorRepository) propertyValues(ctx context.Context, filters BehaviorFilters) (map[string][]BehaviorPropertyValue, error) {
	where, arguments := behaviorBaseWhere(filters)
	rows, err := repository.database.QueryContext(ctx, `SELECT dimension,dimension_value,
		uniqCombined64Merge(events) AS event_count
		FROM behavior_metrics_1m WHERE `+where+` AND startsWith(dimension,'property:')
		GROUP BY dimension,dimension_value ORDER BY event_count DESC,dimension_value
		LIMIT `+strconv.Itoa(behaviorPropertyTopValues)+` BY dimension`, arguments...)
	if err != nil {
		return nil, fmt.Errorf("query behavior property values: %w", err)
	}
	defer func() { _ = rows.Close() }()
	result := map[string][]BehaviorPropertyValue{}
	for rows.Next() {
		var dimension string
		var value BehaviorPropertyValue
		if err := rows.Scan(&dimension, &value.Value, &value.Events); err != nil {
			return nil, fmt.Errorf("scan behavior property value: %w", err)
		}
		name := strings.TrimPrefix(dimension, "property:")
		result[name] = append(result[name], value)
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
	// A single-dimension search reads that dimension's rows, whose value it names, instead of
	// the rows of the requested dimension. Callers only get here when the breakdown splits on
	// the same dimension (behaviorUsesRawEvents), so the totals and breakdown agree.
	if searched, values, ok := behaviorRollupSearch(filters); ok && filters.Query != "" && dimension != "all" {
		where += " AND dimension=? AND dimension_value IN (" + strings.TrimSuffix(strings.Repeat("?,", len(values)), ",") + ")"
		arguments = append(arguments, searched)
		for _, value := range values {
			arguments = append(arguments, value)
		}
		return where, arguments
	}
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

// lastOccurrence is the start of the last minute in which the selected event occurred in
// the range, read from the rollup.
func (repository *BehaviorRepository) lastOccurrence(ctx context.Context, filters BehaviorFilters) (time.Time, bool, error) {
	where, arguments := behaviorBaseWhere(filters)
	var latest time.Time
	var rows uint64
	if err := repository.database.QueryRowContext(ctx, `SELECT max(bucket),count()
		FROM behavior_metrics_1m WHERE `+where, arguments...).Scan(&latest, &rows); err != nil {
		return time.Time{}, false, fmt.Errorf("query behavior last occurrence: %w", err)
	}
	return latest.UTC(), rows > 0, nil
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

const behaviorRawMetrics = `uniqCombined64(event_id),sum(1.0/greatest(toFloat64(sample_rate),0.000001)),
	uniqCombined64If(anonymous_user_id,anonymous_user_id!=''),
	uniqCombined64If(session_id,session_id!=toUUID('00000000-0000-0000-0000-000000000000'))`

// behaviorRawDimension is the raw-table expression of a breakdown dimension, matching how
// behavior_metrics_mv labels each value.
func behaviorRawDimension(dimension string) (string, []any) {
	switch dimension {
	case "country":
		return "if(country='','unknown',toString(country))", nil
	case "device":
		return "if(device_type='','unknown',toString(device_type))", nil
	case "browser":
		return "if(browser='','unknown',toString(browser))", nil
	case "source":
		return "if(domain(referrer)='','direct',domain(referrer))", nil
	}
	return "attributes[?]", []any{strings.TrimPrefix(dimension, "property:")}
}

// getRaw answers a property search the rollup cannot: totals, trend and breakdown are counted
// from the events themselves. The catalog, properties and measurements still come from the
// rollup, because they describe the whole event, not the searched slice.
func (repository *BehaviorRepository) getRaw(ctx context.Context, filters BehaviorFilters, interval string) (BehaviorAnalytics, error) {
	raw := filters
	if err := normalizeBehaviorSampleEvent(&raw); err != nil {
		return BehaviorAnalytics{}, err
	}
	where, arguments := behaviorRawWhere(raw)
	compiled, _, _ := behaviorSchema.ParseAndCompile(filters.Query, search.Raw)
	extra, extraArguments := compiled.WhereSQL()
	where += extra
	arguments = append(arguments, extraArguments...)

	var totals BehaviorMetric
	var latest sql.NullTime
	if err := repository.database.QueryRowContext(ctx, `SELECT `+behaviorRawMetrics+`,max(received_at)
		FROM rum_events WHERE `+where, arguments...).Scan(
		&totals.Events, &totals.Estimated, &totals.UniqueUsers, &totals.UniqueSessions, &latest); err != nil {
		return BehaviorAnalytics{}, fmt.Errorf("query behavior raw totals: %w", err)
	}
	totals.Approximate = true
	var latestAt *time.Time
	if latest.Valid && totals.Events > 0 {
		value := latest.Time.UTC()
		latestAt = &value
	}

	trend := make([]BehaviorTrendPoint, 0)
	rows, err := repository.database.QueryContext(ctx, `SELECT toStartOfInterval(timestamp, INTERVAL `+interval+`) AS point,`+behaviorRawMetrics+`
		FROM rum_events WHERE `+where+` GROUP BY point ORDER BY point`, arguments...)
	if err != nil {
		return BehaviorAnalytics{}, fmt.Errorf("query behavior raw trend: %w", err)
	}
	for rows.Next() {
		var point BehaviorTrendPoint
		if err := rows.Scan(&point.Bucket, &point.Metric.Events, &point.Metric.Estimated, &point.Metric.UniqueUsers, &point.Metric.UniqueSessions); err != nil {
			_ = rows.Close()
			return BehaviorAnalytics{}, fmt.Errorf("scan behavior raw trend: %w", err)
		}
		point.Bucket, point.Metric.Approximate = point.Bucket.UTC(), true
		trend = append(trend, point)
	}
	err = rows.Err()
	_ = rows.Close()
	if err != nil {
		return BehaviorAnalytics{}, err
	}

	dimension, dimensionArguments := behaviorRawDimension(filters.Dimension)
	breakdownWhere, breakdownArguments := where, append([]any(nil), arguments...)
	if strings.HasPrefix(filters.Dimension, "property:") {
		breakdownWhere += " AND mapContains(attributes,?)"
		breakdownArguments = append(breakdownArguments, strings.TrimPrefix(filters.Dimension, "property:"))
	}
	limit := behaviorDimensionLimit(filters.Dimension)
	breakdown := make([]BehaviorBreakdown, 0, limit)
	rows, err = repository.database.QueryContext(ctx, `SELECT `+dimension+` AS value,`+behaviorRawMetrics+` AS event_count
		FROM rum_events WHERE `+breakdownWhere+` GROUP BY value ORDER BY uniqCombined64(event_id) DESC,value LIMIT ?`,
		append(append(dimensionArguments, breakdownArguments...), limit+1)...)
	if err != nil {
		return BehaviorAnalytics{}, fmt.Errorf("query behavior raw breakdown: %w", err)
	}
	for rows.Next() {
		var item BehaviorBreakdown
		if err := rows.Scan(&item.Value, &item.Metric.Events, &item.Metric.Estimated, &item.Metric.UniqueUsers, &item.Metric.UniqueSessions); err != nil {
			_ = rows.Close()
			return BehaviorAnalytics{}, fmt.Errorf("scan behavior raw breakdown: %w", err)
		}
		item.Metric.Approximate = true
		breakdown = append(breakdown, item)
		if len(breakdown) > limit {
			_ = rows.Close()
			return BehaviorAnalytics{}, ErrBehaviorCardinalityExceeded
		}
	}
	err = rows.Err()
	_ = rows.Close()
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
	return BehaviorAnalytics{
		From: filters.From, To: filters.To, Dimension: filters.Dimension, Interval: interval,
		Totals: totals, Trend: trend, Breakdown: breakdown, Catalog: catalog, Properties: properties,
		Measurements: measurements, Freshness: behaviorFreshness(latestAt, repository.now()),
		SampleCount: totals.Events, RowLimit: limit,
	}, nil
}
