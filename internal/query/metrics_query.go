package query

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"openrum/internal/catalog"
)

// newIssueLookback is how long an Issue must have been quiet to count as new again. A
// true "first seen ever" cannot be answered in a bounded scan, and is capped by the
// aggregate TTL anyway, so the definition says so: new, or back after 30 quiet days.
const newIssueLookback = 30 * 24 * time.Hour

var ErrInvalidMetricsQuery = errors.New("invalid metrics query")

// MetricsQuery is one catalog question over one time window.
type MetricsQuery struct {
	ProjectID   uuid.UUID
	From        time.Time
	To          time.Time
	Environment string
	MaxPoints   int
	Spec        catalog.Spec
}

// NormalizeMetricsQuery validates the window and the spec. A zero point budget means the
// Console's shared budget: this endpoint has no legacy callers whose density could shift.
func NormalizeMetricsQuery(requested MetricsQuery) (MetricsQuery, error) {
	query := requested
	query.Environment = strings.TrimSpace(query.Environment)
	if query.ProjectID == uuid.Nil || query.From.IsZero() || query.To.IsZero() || !query.To.After(query.From) ||
		query.To.Sub(query.From) > MaxOverviewRange || !validSeriesPointBudget(query.MaxPoints) {
		return MetricsQuery{}, ErrInvalidMetricsQuery
	}
	if query.Environment != "" && !queryEnvironmentPattern.MatchString(query.Environment) {
		return MetricsQuery{}, ErrInvalidMetricsQuery
	}
	if query.MaxPoints == 0 {
		query.MaxPoints = ConsoleSeriesMaxPoints
	}
	spec, err := catalog.Validate(query.Spec)
	if err != nil {
		return MetricsQuery{}, err
	}
	query.Spec = spec
	query.From = query.From.UTC()
	query.To = query.To.UTC()
	return query, nil
}

func (query MetricsQuery) source() catalog.Source {
	source, _ := catalog.LookupSource(query.Spec.Source())
	return source
}

func (query MetricsQuery) interval() time.Duration {
	return max(query.source().Resolution, adaptiveSeriesInterval(query.To.Sub(query.From), query.MaxPoints))
}

// MetricValue is one metric's value in one cell. A value computed from fewer samples than
// the metric needs is still returned, marked insufficient, rather than hidden.
type MetricValue struct {
	Value       *float64 `json:"value"`
	Samples     uint64   `json:"samples"`
	Sufficient  bool     `json:"sufficient"`
	Numerator   *float64 `json:"numerator,omitempty"`
	Denominator *float64 `json:"denominator,omitempty"`
}

// MetricChange is a change against the previous period: percentage points for ratios,
// percent for everything else, matching the classic overview.
type MetricChange struct {
	Percent *float64 `json:"percent,omitempty"`
	Points  *float64 `json:"points,omitempty"`
}

type MetricMeta struct {
	ID               string              `json:"id"`
	Label            string              `json:"label"`
	Description      string              `json:"description"`
	Unit             catalog.Unit        `json:"unit"`
	Weighting        catalog.Weighting   `json:"weighting"`
	Kind             catalog.Kind        `json:"kind"`
	Direction        catalog.Direction   `json:"direction"`
	Semantic         string              `json:"semantic,omitempty"`
	Approximate      bool                `json:"approximate"`
	AdditiveOverTime bool                `json:"additiveOverTime"`
	Additive         bool                `json:"additive"`
	MinSamples       uint64              `json:"minSamples,omitempty"`
	Thresholds       *catalog.Thresholds `json:"thresholds,omitempty"`
}

type MetricsComparison struct {
	From          time.Time               `json:"from"`
	To            time.Time               `json:"to"`
	OffsetSeconds int64                   `json:"offsetSeconds"`
	Totals        map[string]MetricValue  `json:"totals,omitempty"`
	Changes       map[string]MetricChange `json:"changes,omitempty"`
}

type MetricSeries struct {
	Metric string         `json:"metric"`
	Points []*MetricValue `json:"points"`
}

type MetricsRow struct {
	Value     string                  `json:"value"`
	Values    map[string]MetricValue  `json:"values"`
	Previous  map[string]MetricValue  `json:"previous,omitempty"`
	Changes   map[string]MetricChange `json:"changes,omitempty"`
	Sparkline []*MetricValue          `json:"sparkline,omitempty"`
}

type DimensionSeries struct {
	Value  string         `json:"value"`
	Other  bool           `json:"other,omitempty"`
	Points []*MetricValue `json:"points"`
}

// MetricsResult answers a MetricsQuery. Which fields are set depends on the shape; every
// series is laid on the dense Buckets grid, where a bucket without data is null, never 0.
type MetricsResult struct {
	From                  time.Time              `json:"from"`
	To                    time.Time              `json:"to"`
	Shape                 catalog.Shape          `json:"shape"`
	Source                catalog.SourceID       `json:"source"`
	Dimension             string                 `json:"dimension,omitempty"`
	Metrics               []MetricMeta           `json:"metrics"`
	IntervalSeconds       int64                  `json:"intervalSeconds,omitempty"`
	Buckets               []time.Time            `json:"buckets,omitempty"`
	Totals                map[string]MetricValue `json:"totals,omitempty"`
	Comparison            *MetricsComparison     `json:"comparison,omitempty"`
	Series                []MetricSeries         `json:"series,omitempty"`
	PreviousSeries        []MetricSeries         `json:"previousSeries,omitempty"`
	Rows                  []MetricsRow           `json:"rows,omitempty"`
	Other                 map[string]MetricValue `json:"other,omitempty"`
	Groups                []DimensionSeries      `json:"groups,omitempty"`
	LimitReached          bool                   `json:"limitReached"`
	TopN                  int                    `json:"topN,omitempty"`
	NewIssuesLookbackFrom *time.Time             `json:"newIssuesLookbackFrom,omitempty"`
	Freshness             OverviewFreshness      `json:"freshness"`
}

type MetricsRepository struct {
	database *sql.DB
}

func NewMetricsRepository(database *sql.DB) *MetricsRepository {
	return &MetricsRepository{database: database}
}

// Run answers one catalog question.
func (repository *MetricsRepository) Run(ctx context.Context, requested MetricsQuery) (MetricsResult, error) {
	query, err := NormalizeMetricsQuery(requested)
	if err != nil {
		return MetricsResult{}, err
	}
	spec := query.Spec
	result := MetricsResult{
		From: query.From, To: query.To, Shape: spec.Shape, Source: spec.Source(),
		Dimension: spec.Dimension, Metrics: describeMetrics(spec),
	}
	if hasNewIssues(spec) {
		lookback := query.From.Add(-newIssueLookback)
		result.NewIssuesLookbackFrom = &lookback
	}
	current := query.window()
	switch spec.Shape {
	case catalog.ShapeTotal:
		err = repository.runTotal(ctx, query, current, &result)
	case catalog.ShapeSeries:
		err = repository.runSeries(ctx, query, current, &result)
	case catalog.ShapeBreakdown, catalog.ShapeTable:
		err = repository.runRanked(ctx, query, current, &result)
	case catalog.ShapeSeriesByDimension:
		err = repository.runSeriesByDimension(ctx, query, current, &result)
	default:
		err = fmt.Errorf("%w: unsupported shape", catalog.ErrInvalidSpec)
	}
	if err != nil {
		return MetricsResult{}, err
	}
	return result, nil
}

func describeMetrics(spec catalog.Spec) []MetricMeta {
	resolved := spec.ResolvedMetrics()
	result := make([]MetricMeta, 0, len(resolved))
	for _, metric := range resolved {
		result = append(result, MetricMeta{
			ID: metric.ID, Label: metric.Label, Description: metric.Description, Unit: metric.Unit,
			Weighting: metric.Weighting, Kind: metric.Kind, Direction: metric.Direction, Semantic: metric.Semantic,
			Approximate: metric.Approximate, AdditiveOverTime: metric.AdditiveOverTime,
			Additive:   spec.Dimension != "" && metric.AdditiveOver(spec.Dimension),
			MinSamples: metric.MinSamples, Thresholds: metric.Thresholds,
		})
	}
	return result
}

func hasNewIssues(spec catalog.Spec) bool {
	for _, metric := range spec.ResolvedMetrics() {
		if metric.Kind == catalog.KindNewIssues {
			return true
		}
	}
	return false
}

func (repository *MetricsRepository) runTotal(ctx context.Context, query MetricsQuery, current window, result *MetricsResult) error {
	totals, err := repository.aggregate(ctx, query, query.Spec.Metrics, current, grouping{})
	if err != nil {
		return err
	}
	result.Totals = totals[rowKey{}]
	return repository.compareTotals(ctx, query, result)
}

func (repository *MetricsRepository) runSeries(ctx context.Context, query MetricsQuery, current window, result *MetricsResult) error {
	interval := query.interval()
	buckets := seriesBuckets(query.From, query.To, interval)
	result.IntervalSeconds = int64(interval / time.Second)
	result.Buckets = buckets
	totals, err := repository.aggregate(ctx, query, query.Spec.Metrics, current, grouping{})
	if err != nil {
		return err
	}
	result.Totals = totals[rowKey{}]
	points, err := repository.aggregate(ctx, query, query.Spec.Metrics, current, grouping{interval: interval})
	if err != nil {
		return err
	}
	result.Series = layOnGrid(query.Spec, buckets, points, "", false)
	if !query.Spec.Compare {
		return nil
	}
	if err := repository.compareTotals(ctx, query, result); err != nil {
		return err
	}
	previous := query.previousWindow()
	previousPoints, err := repository.aggregate(ctx, query, query.Spec.Metrics, previous, grouping{interval: interval})
	if err != nil {
		return err
	}
	result.PreviousSeries = layOnGrid(query.Spec, buckets, previousPoints, "", false)
	return nil
}

func (repository *MetricsRepository) compareTotals(ctx context.Context, query MetricsQuery, result *MetricsResult) error {
	if !query.Spec.Compare {
		return nil
	}
	previous := query.previousWindow()
	totals, err := repository.aggregate(ctx, query, query.Spec.Metrics, previous, grouping{})
	if err != nil {
		return err
	}
	result.Comparison = &MetricsComparison{
		From: previous.from, To: previous.to, OffsetSeconds: int64(previous.offset / time.Second),
		Totals: totals[rowKey{}], Changes: metricChanges(query.Spec, result.Totals, totals[rowKey{}]),
	}
	return nil
}

// runRanked answers breakdowns and tables: the top groups by the sort metric, the range
// total they are shares of, and — for metrics that add up — what the rest amounted to.
func (repository *MetricsRepository) runRanked(ctx context.Context, query MetricsQuery, current window, result *MetricsResult) error {
	spec := query.Spec
	result.TopN = spec.TopN
	totals, err := repository.aggregate(ctx, query, spec.Metrics, current, grouping{})
	if err != nil {
		return err
	}
	result.Totals = totals[rowKey{}]
	values, cells, limitReached, err := repository.rankGroups(ctx, query, current)
	if err != nil {
		return err
	}
	result.LimitReached = limitReached
	rows := make([]MetricsRow, 0, len(values))
	for _, value := range values {
		rows = append(rows, MetricsRow{Value: value, Values: cells[rowKey{group: value}]})
	}
	if limitReached {
		result.Other = remainder(spec, result.Totals, rows)
	}
	if spec.Compare && len(values) > 0 {
		previous := query.previousWindow()
		previousCells, err := repository.aggregate(ctx, query, spec.Metrics, previous, grouping{dimension: true, restrict: values})
		if err != nil {
			return err
		}
		for index := range rows {
			before := previousCells[rowKey{group: rows[index].Value}]
			rows[index].Previous = before
			rows[index].Changes = metricChanges(spec, rows[index].Values, before)
		}
		if err := repository.compareTotals(ctx, query, result); err != nil {
			return err
		}
	}
	if spec.Sparkline && len(values) > 0 {
		interval := query.interval()
		buckets := seriesBuckets(query.From, query.To, interval)
		result.IntervalSeconds = int64(interval / time.Second)
		result.Buckets = buckets
		lines, err := repository.aggregate(ctx, query, []string{spec.Sort}, current,
			grouping{interval: interval, dimension: true, restrict: values})
		if err != nil {
			return err
		}
		for index := range rows {
			rows[index].Sparkline = layOnGrid(catalog.Spec{Metrics: []string{spec.Sort}}, buckets, lines, rows[index].Value, false)[0].Points
		}
	}
	result.Rows = rows
	return nil
}

// runSeriesByDimension ranks the groups once over the whole range, then draws each of the
// top groups over time. Groups past the limit fold into "Other" only for metrics whose
// values add up; an "Other" line of error rates or percentiles would be meaningless.
func (repository *MetricsRepository) runSeriesByDimension(ctx context.Context, query MetricsQuery, current window, result *MetricsResult) error {
	spec := query.Spec
	result.TopN = spec.TopN
	interval := query.interval()
	buckets := seriesBuckets(query.From, query.To, interval)
	result.IntervalSeconds = int64(interval / time.Second)
	result.Buckets = buckets
	values, _, limitReached, err := repository.rankGroups(ctx, query, current)
	if err != nil {
		return err
	}
	result.LimitReached = limitReached
	if len(values) == 0 {
		result.Groups = []DimensionSeries{}
		return nil
	}
	metric := spec.ResolvedMetrics()[0]
	withOther := limitReached && metric.AdditiveOver(spec.Dimension)
	points, err := repository.aggregate(ctx, query, spec.Metrics, current,
		grouping{interval: interval, dimension: true, restrict: values, other: withOther})
	if err != nil {
		return err
	}
	groups := make([]DimensionSeries, 0, len(values)+1)
	for _, value := range values {
		groups = append(groups, DimensionSeries{Value: value, Points: layOnGrid(spec, buckets, points, value, false)[0].Points})
	}
	if withOther {
		groups = append(groups, DimensionSeries{Value: "other", Other: true, Points: layOnGrid(spec, buckets, points, "", true)[0].Points})
	}
	result.Groups = groups
	return nil
}

// rankGroups returns the top groups, ordered, plus the cells of every requested metric
// for them. The sort metric decides the order; any metric answered by a different query
// (new Issues beside the others) is fetched for exactly those groups afterwards.
func (repository *MetricsRepository) rankGroups(ctx context.Context, query MetricsQuery, current window) ([]string, map[rowKey]map[string]MetricValue, bool, error) {
	spec := query.Spec
	// A split series over pinned groups draws exactly those, in the order given, so their
	// colours never reshuffle when the ranking would have changed.
	if len(spec.Groups) > 0 && spec.Shape == catalog.ShapeSeriesByDimension {
		return spec.Groups, map[rowKey]map[string]MetricValue{}, false, nil
	}
	sortMetric, _ := catalog.Lookup(spec.Sort)
	leading, trailing := splitBySortQuery(spec, sortMetric)
	ranked, order, err := repository.aggregateRanked(ctx, query, leading, current)
	if err != nil {
		return nil, nil, false, err
	}
	limitReached := len(order) > spec.TopN
	if limitReached {
		order = order[:spec.TopN]
	}
	if len(trailing) > 0 && len(order) > 0 {
		rest, err := repository.aggregate(ctx, query, trailing, current, grouping{dimension: true, restrict: order})
		if err != nil {
			return nil, nil, false, err
		}
		for key, cell := range rest {
			if _, ok := ranked[key]; !ok {
				ranked[key] = map[string]MetricValue{}
			}
			for id, value := range cell {
				ranked[key][id] = value
			}
		}
	}
	return order, ranked, limitReached, nil
}

// splitBySortQuery separates the metrics answered together with the sort metric from the
// ones that need their own query.
func splitBySortQuery(spec catalog.Spec, sortMetric catalog.Metric) ([]string, []string) {
	sortIsNew := sortMetric.Kind == catalog.KindNewIssues
	var leading, trailing []string
	for _, metric := range spec.ResolvedMetrics() {
		if (metric.Kind == catalog.KindNewIssues) == sortIsNew {
			leading = append(leading, metric.ID)
		} else {
			trailing = append(trailing, metric.ID)
		}
	}
	return leading, trailing
}

// remainder is "Other": the range total minus the listed groups, for metrics that add up
// across the dimension. Computing it from the total costs no extra scan.
func remainder(spec catalog.Spec, totals map[string]MetricValue, rows []MetricsRow) map[string]MetricValue {
	other := map[string]MetricValue{}
	for _, metric := range spec.ResolvedMetrics() {
		total, ok := totals[metric.ID]
		if !ok || !metric.AdditiveOver(spec.Dimension) || total.Value == nil {
			continue
		}
		sum := 0.0
		samples := uint64(0)
		for _, row := range rows {
			if current := row.Values[metric.ID]; current.Value != nil {
				sum += *current.Value
				samples += current.Samples
			}
		}
		rest := max(0, *total.Value-sum)
		restSamples := uint64(0)
		if total.Samples > samples {
			restSamples = total.Samples - samples
		}
		other[metric.ID] = MetricValue{Value: &rest, Samples: restSamples, Sufficient: true}
	}
	if len(other) == 0 {
		return nil
	}
	return other
}

func metricChanges(spec catalog.Spec, current, previous map[string]MetricValue) map[string]MetricChange {
	if current == nil || previous == nil {
		return nil
	}
	changes := map[string]MetricChange{}
	for _, metric := range spec.ResolvedMetrics() {
		now, before := current[metric.ID], previous[metric.ID]
		if metric.Unit == catalog.UnitRatio {
			changes[metric.ID] = MetricChange{Points: ratePointChange(now.Value, before.Value)}
		} else {
			changes[metric.ID] = MetricChange{Percent: percentChangeOptional(now.Value, before.Value)}
		}
	}
	return changes
}

// layOnGrid places aggregated cells on the dense bucket grid. A bucket with no row is
// nil — no data, not zero — except for new Issues: that query covers the whole window,
// so a bucket in which no Issue first appeared is a computed zero, not a gap.
func layOnGrid(spec catalog.Spec, buckets []time.Time, cells map[rowKey]map[string]MetricValue, group string, other bool) []MetricSeries {
	series := make([]MetricSeries, 0, len(spec.Metrics))
	for _, metric := range spec.ResolvedMetrics() {
		points := make([]*MetricValue, len(buckets))
		for index, bucket := range buckets {
			cell, ok := cells[rowKey{point: bucket.Unix(), group: group, other: other}]
			if value, present := cell[metric.ID]; ok && present {
				copied := value
				points[index] = &copied
				continue
			}
			if metric.Kind == catalog.KindNewIssues {
				zero := 0.0
				points[index] = &MetricValue{Value: &zero, Sufficient: true}
			}
		}
		series = append(series, MetricSeries{Metric: metric.ID, Points: points})
	}
	return series
}
