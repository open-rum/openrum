package query

import (
	"math"
	"strings"
	"time"

	"openrum/internal/catalog"
)

// defaultMetricsBudgetUnits allows a 30-day comparison over a one-minute rollup without
// any filter. A unit is one aggregate bucket scanned, so the five-minute issue table
// costs a fifth of a one-minute table over the same range.
const defaultMetricsBudgetUnits = int64(2 * 30 * 24 * 60)

// MetricsBudget bounds catalog queries before they reach ClickHouse. A query the budget
// refuses is answered with 422, never a partial result.
type MetricsBudget struct {
	MaxUnits int64
}

func DefaultMetricsBudget() MetricsBudget {
	return MetricsBudget{MaxUnits: defaultMetricsBudgetUnits}
}

func (budget MetricsBudget) Check(requested MetricsQuery) error {
	query, err := NormalizeMetricsQuery(requested)
	if err != nil {
		return err
	}
	maximum := budget.MaxUnits
	if maximum <= 0 {
		maximum = defaultMetricsBudgetUnits
	}
	if metricsQueryUnits(query) > maximum {
		return ErrQueryTooExpensive
	}
	return nil
}

func metricsQueryUnits(query MetricsQuery) int64 {
	spec := query.Spec
	source := query.source()
	resolutionMinutes := max(1, int64(source.Resolution/time.Minute))
	rangeMinutes := int64(math.Ceil(query.To.Sub(query.From).Minutes()))
	regular, newIssues := partitionMetrics(spec.Metrics)
	scanned := int64(0)
	if len(regular) > 0 {
		scanned += rangeMinutes
	}
	// New Issues look back 30 days for an earlier occurrence, and that scan is real.
	if newIssues != nil {
		scanned += rangeMinutes + int64(newIssueLookback/time.Minute)
	}
	units := max(1, scanned/resolutionMinutes)

	// Property rows exist once per attribute on every Event, so they are the widest part
	// of the measurement table.
	if strings.HasPrefix(spec.Dimension, "property:") {
		units *= 4
	}
	switch spec.Shape {
	case catalog.ShapeSeriesByDimension:
		units *= 2
	case catalog.ShapeTable:
		if spec.Sparkline {
			units *= 2
		}
	}
	if spec.Compare {
		units *= 2
	}
	// Each further metric adds a quarter: they share the scan but not the merge.
	units = units * int64(3+len(spec.Metrics)) / 4

	// A leading sort-key filter prunes most of the table; a trailing one prunes less.
	if query.Environment != "" {
		units = max(1, units/4)
	}
	for key := range spec.Filters {
		if source.Filters[key].Prefix {
			units = max(1, units/4)
		} else {
			units = max(1, units/2)
		}
	}
	return units
}
