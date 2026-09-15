package query

import (
	"context"
	"fmt"
	"regexp"
	"strings"
)

// Custom Event measurements, read out of `measurement_metrics_1m`.
//
// Two shapes answer two different questions. The summary is every measurement key with
// its totals, which answers "what is the revenue"; the breakdown is one key split by the
// selected dimension, which answers "revenue by payment method". They are separate
// because the summary is cheap enough to return on every Analysis request while the
// breakdown is only worth its scan once the reader has named a key.
const (
	measurementBreakdownLimit = 100
	// Matches the attribute-key rule in `behaviorPropertyPattern`. Measurement keys come
	// from the same place — a JSON object written by the page — and are truncated to 64
	// characters by `boundedMeasurements` before they are stored.
	measurementNameLimit = 64
)

var measurementNamePattern = regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$`)

type BehaviorMeasurementSummary struct {
	Name    string `json:"name"`
	Samples uint64 `json:"samples"`
	// Total is what was stored. Estimated divides each value by its Event's sample rate
	// and is the only one of the two that means anything below full sampling.
	Total     float64 `json:"total"`
	Estimated float64 `json:"estimated"`
	Average   float64 `json:"average"`
	Minimum   float64 `json:"minimum"`
	Maximum   float64 `json:"maximum"`
	// Monetary values are skewed, so the median is usually the honest "typical" figure
	// and the mean is the one that flatters.
	P50 float64 `json:"p50"`
	P90 float64 `json:"p90"`
}

type MeasurementBreakdownRow struct {
	Value     string  `json:"value"`
	Samples   uint64  `json:"samples"`
	Total     float64 `json:"total"`
	Estimated float64 `json:"estimated"`
	Average   float64 `json:"average"`
}

// ValidMeasurementName reports whether a name can be used as a filter. The pattern is
// the storage rule, not a lookup: an unknown-but-well-formed name returns no rows rather
// than an error, which is what lets the Console ask before the first Event arrives.
func ValidMeasurementName(value string) bool {
	return value != "" && len(value) <= measurementNameLimit && measurementNamePattern.MatchString(value)
}

// measurements returns every measurement key with its totals, read at the `all`
// dimension so the figures are per Event rather than per dimension value.
func (repository *BehaviorRepository) measurements(
	ctx context.Context,
	filters BehaviorFilters,
) ([]BehaviorMeasurementSummary, error) {
	where, arguments := measurementWhere(filters)
	rows, err := repository.database.QueryContext(ctx, `SELECT measurement,
		countMerge(samples),sumMerge(total),sumMerge(estimated),
		minMerge(minimum),maxMerge(maximum),
		quantilesTDigestMerge(0.5,0.9)(quantiles)
		FROM measurement_metrics_1m WHERE `+where+` AND dimension='all'
		GROUP BY measurement ORDER BY measurement LIMIT `+fmt.Sprint(measurementBreakdownLimit),
		arguments...)
	if err != nil {
		return nil, fmt.Errorf("query measurement summary: %w", err)
	}
	defer func() { _ = rows.Close() }()
	result := make([]BehaviorMeasurementSummary, 0)
	for rows.Next() {
		var item BehaviorMeasurementSummary
		// quantilesTDigest returns Float32: the digest stores centroids at single
		// precision, so the driver hands back Array(Float32) and a []float64 target
		// fails to scan.
		quantiles := make([]float32, 0, 2)
		if err := rows.Scan(&item.Name, &item.Samples, &item.Total, &item.Estimated,
			&item.Minimum, &item.Maximum, &quantiles); err != nil {
			return nil, fmt.Errorf("scan measurement summary: %w", err)
		}
		item.Average = measurementAverage(item.Total, item.Samples)
		if len(quantiles) == 2 {
			item.P50, item.P90 = float64(quantiles[0]), float64(quantiles[1])
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

// measurementBreakdown splits one measurement key by the selected dimension.
func (repository *BehaviorRepository) measurementBreakdown(
	ctx context.Context,
	filters BehaviorFilters,
) ([]MeasurementBreakdownRow, error) {
	where, arguments := measurementWhere(filters)
	where += " AND measurement=? AND dimension=?"
	arguments = append(arguments, filters.Measurement, filters.Dimension)
	rows, err := repository.database.QueryContext(ctx, `SELECT dimension_value,
		countMerge(samples),sumMerge(total),sumMerge(estimated)
		FROM measurement_metrics_1m WHERE `+where+`
		GROUP BY dimension_value ORDER BY sumMerge(total) DESC,dimension_value
		LIMIT `+fmt.Sprint(measurementBreakdownLimit), arguments...)
	if err != nil {
		return nil, fmt.Errorf("query measurement breakdown: %w", err)
	}
	defer func() { _ = rows.Close() }()
	result := make([]MeasurementBreakdownRow, 0)
	for rows.Next() {
		var item MeasurementBreakdownRow
		if err := rows.Scan(&item.Value, &item.Samples, &item.Total, &item.Estimated); err != nil {
			return nil, fmt.Errorf("scan measurement breakdown: %w", err)
		}
		item.Average = measurementAverage(item.Total, item.Samples)
		result = append(result, item)
	}
	return result, rows.Err()
}

// measurementWhere mirrors `behaviorBaseWhere` minus the event-kind clause: the
// aggregate only holds Custom Events, so `event_kind` is not a column on it.
func measurementWhere(filters BehaviorFilters) (string, []any) {
	where := "project_id=? AND bucket>=? AND bucket<?"
	arguments := []any{filters.ProjectID, filters.From, filters.To}
	if filters.Environment != "" {
		where += " AND environment=?"
		arguments = append(arguments, filters.Environment)
	}
	if filters.EventName != "" {
		where += " AND event_name=?"
		arguments = append(arguments, filters.EventName)
	}
	return where, arguments
}

// measurementAverage keeps the zero-sample case at zero rather than NaN, which would
// serialize as `null` and force every caller to handle it.
func measurementAverage(total float64, samples uint64) float64 {
	if samples == 0 {
		return 0
	}
	return total / float64(samples)
}

// measurementDimensionSupported reports whether a breakdown can be served for a
// dimension. The aggregate materializes the same set the behavior aggregate does.
func measurementDimensionSupported(dimension string) bool {
	switch dimension {
	case "country", "device", "browser", "source":
		return true
	}
	return strings.HasPrefix(dimension, "property:")
}
