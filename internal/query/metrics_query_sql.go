package query

import (
	"context"
	"database/sql"
	"fmt"
	"sort"
	"strings"
	"time"

	"openrum/internal/catalog"
)

// Every statement carries its own deadline so ClickHouse stops even if the client has
// already gone away, matching the Go-side timeout the handler applies.
const metricsQuerySettings = " SETTINGS max_execution_time=10, timeout_overflow_mode='throw'"

// window is a half-open time range. offset shifts a previous period onto the current
// bucket grid, so a comparison series overlays by index even when the range length is not
// a whole number of intervals.
type window struct {
	from   time.Time
	to     time.Time
	offset time.Duration
}

func (query MetricsQuery) window() window { return window{from: query.From, to: query.To} }

func (query MetricsQuery) previousWindow() window {
	duration := query.To.Sub(query.From)
	return window{from: query.From.Add(-duration), to: query.From, offset: duration}
}

// grouping says how cells are keyed: by time bucket, by dimension value, both, or neither.
type grouping struct {
	interval  time.Duration
	dimension bool
	// restrict limits dimension values to the ranked groups. With other set, values outside
	// it fold into one NULL-keyed group instead of being dropped, so "Other" cannot collide
	// with a real value.
	restrict []string
	other    bool
}

type rowKey struct {
	point int64
	group string
	other bool
}

type cells = map[rowKey]map[string]MetricValue

// aggregate runs the statements needed for the requested metrics and merges their cells.
// New Issues have their own statement; everything else shares one.
func (repository *MetricsRepository) aggregate(ctx context.Context, query MetricsQuery, ids []string, current window, group grouping) (cells, error) {
	regular, newIssues := partitionMetrics(ids)
	merged := cells{}
	if len(regular) > 0 {
		statement, arguments := query.regularSQL(regular, current, group, false)
		if err := repository.scanInto(ctx, statement, arguments, regular, group, merged); err != nil {
			return nil, err
		}
	}
	if newIssues != nil {
		statement, arguments := query.newIssuesSQL(current, group, false)
		if err := repository.scanInto(ctx, statement, arguments, []catalog.Metric{*newIssues}, group, merged); err != nil {
			return nil, err
		}
	}
	return merged, nil
}

// aggregateRanked groups by dimension, ordered by the sort metric, with one row beyond the
// limit so the caller can tell whether groups were cut off.
func (repository *MetricsRepository) aggregateRanked(ctx context.Context, query MetricsQuery, ids []string, current window) (cells, []string, error) {
	regular, newIssues := partitionMetrics(ids)
	// Pinned groups restrict the ranking to themselves; the limit already equals their count.
	group := grouping{dimension: true, restrict: query.Spec.Groups}
	var statement string
	var arguments []any
	var scanned []catalog.Metric
	if newIssues != nil {
		statement, arguments = query.newIssuesSQL(current, group, true)
		scanned = []catalog.Metric{*newIssues}
	} else {
		statement, arguments = query.regularSQL(regular, current, group, true)
		scanned = regular
	}
	rows, err := repository.database.QueryContext(ctx, statement, arguments...)
	if err != nil {
		return nil, nil, fmt.Errorf("query ranked metrics: %w", err)
	}
	defer func() { _ = rows.Close() }()
	result := cells{}
	order := make([]string, 0)
	for rows.Next() {
		key, cell, err := scanCell(rows, scanned, group)
		if err != nil {
			return nil, nil, fmt.Errorf("scan ranked metrics: %w", err)
		}
		result[key] = cell
		order = append(order, key.group)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, fmt.Errorf("iterate ranked metrics: %w", err)
	}
	return result, order, nil
}

func partitionMetrics(ids []string) ([]catalog.Metric, *catalog.Metric) {
	var regular []catalog.Metric
	var newIssues *catalog.Metric
	for _, id := range ids {
		metric, _ := catalog.Lookup(id)
		if metric.Kind == catalog.KindNewIssues {
			current := metric
			newIssues = &current
			continue
		}
		regular = append(regular, metric)
	}
	return regular, newIssues
}

func (repository *MetricsRepository) scanInto(ctx context.Context, statement string, arguments []any, metrics []catalog.Metric, group grouping, into cells) error {
	rows, err := repository.database.QueryContext(ctx, statement, arguments...)
	if err != nil {
		return fmt.Errorf("query metrics: %w", err)
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		key, cell, err := scanCell(rows, metrics, group)
		if err != nil {
			return fmt.Errorf("scan metrics: %w", err)
		}
		if _, ok := into[key]; !ok {
			into[key] = map[string]MetricValue{}
		}
		for id, value := range cell {
			into[key][id] = value
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate metrics: %w", err)
	}
	return nil
}

// Each metric is scanned as three columns — a, b and samples — so one scan loop serves
// every kind: a is the value (or numerator), b the denominator where there is one.
func scanCell(scanner rowScanner, metrics []catalog.Metric, group grouping) (rowKey, map[string]MetricValue, error) {
	var point time.Time
	var value sql.NullString
	destinations := make([]any, 0, 2+3*len(metrics))
	if group.interval > 0 {
		destinations = append(destinations, &point)
	}
	if group.dimension {
		destinations = append(destinations, &value)
	}
	numerators := make([]float64, len(metrics))
	denominators := make([]float64, len(metrics))
	samples := make([]uint64, len(metrics))
	for index := range metrics {
		destinations = append(destinations, &numerators[index], &denominators[index], &samples[index])
	}
	if err := scanner.Scan(destinations...); err != nil {
		return rowKey{}, nil, err
	}
	key := rowKey{}
	if group.interval > 0 {
		key.point = point.UTC().Unix()
	}
	if group.dimension {
		if value.Valid {
			key.group = value.String
		} else {
			key.other = true
		}
	}
	cell := make(map[string]MetricValue, len(metrics))
	for index, metric := range metrics {
		cell[metric.ID] = metricValue(metric, numerators[index], denominators[index], samples[index])
	}
	return key, cell, nil
}

func metricValue(metric catalog.Metric, a, b float64, samples uint64) MetricValue {
	value := MetricValue{Samples: samples, Sufficient: samples >= metric.MinSamples}
	switch metric.Kind {
	case catalog.KindRate, catalog.KindMean:
		numerator, denominator := a, b
		value.Value = ratio(numerator, denominator)
		value.Numerator, value.Denominator = &numerator, &denominator
	case catalog.KindQuantile, catalog.KindExtremum:
		value.Value = finiteValue(a, samples)
	default:
		value.Value = finiteValue(a, 1)
		value.Sufficient = true
	}
	return value
}

// catalogMetricColumns renders the three scan columns for one metric.
func catalogMetricColumns(metric catalog.Metric, index int) string {
	var a, b string
	switch metric.Kind {
	case catalog.KindRate, catalog.KindMean:
		a, b = metric.Numerator, metric.Denominator
	case catalog.KindQuantile, catalog.KindExtremum:
		// An empty digest merges to NULL on nullable columns and NaN elsewhere; both become
		// NaN here and a missing value in Go.
		a, b = "ifNull(toFloat64("+metric.Value+"), nan)", "0"
	default:
		a, b = metric.Value, "0"
	}
	return fmt.Sprintf("toFloat64(%s) AS a%d, toFloat64(%s) AS b%d, toUInt64(%s) AS s%d",
		a, index, b, index, metric.Samples, index)
}

// sortExpression orders groups by the sort metric's value, with the value computed the
// same way Go computes it so the SQL order and the displayed numbers agree.
func sortExpression(metric catalog.Metric, index int) string {
	switch metric.Kind {
	case catalog.KindRate, catalog.KindMean:
		return fmt.Sprintf("if(b%d > 0, a%d / b%d, NULL)", index, index, index)
	case catalog.KindQuantile, catalog.KindExtremum:
		return fmt.Sprintf("if(isNaN(a%d) OR s%d = 0, NULL, a%d)", index, index, index)
	default:
		return fmt.Sprintf("a%d", index)
	}
}

func (query MetricsQuery) orderBy(metrics []catalog.Metric) string {
	sortIndex := 0
	for index, metric := range metrics {
		if metric.ID == query.Spec.Sort {
			sortIndex = index
		}
	}
	metric := metrics[sortIndex]
	direction := "DESC"
	if query.Spec.Order == "asc" {
		direction = "ASC"
	}
	clauses := make([]string, 0, 3)
	// A value from too few samples is noise, so it never outranks a well-sampled one.
	if metric.MinSamples > 0 {
		clauses = append(clauses, fmt.Sprintf("(s%d >= %d) DESC", sortIndex, metric.MinSamples))
	}
	clauses = append(clauses, sortExpression(metric, sortIndex)+" "+direction+" NULLS LAST", "grp ASC")
	return fmt.Sprintf(" ORDER BY %s LIMIT %d", strings.Join(clauses, ", "), query.Spec.TopN+1)
}

func pointExpression(column string, current window, interval time.Duration) string {
	minutes := int(interval / time.Minute)
	if current.offset == 0 {
		return fmt.Sprintf("toStartOfInterval(%s, INTERVAL %d MINUTE)", column, minutes)
	}
	return fmt.Sprintf("toStartOfInterval(addSeconds(%s, %d), INTERVAL %d MINUTE)",
		column, int64(current.offset/time.Second), minutes)
}

// groupExpression returns the SQL for the dimension, and any predicate that restricts it.
func groupExpression(base string, group grouping) (string, string, []any) {
	if len(group.restrict) == 0 {
		return base, "", nil
	}
	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(group.restrict)), ",")
	arguments := make([]any, 0, len(group.restrict))
	for _, value := range group.restrict {
		arguments = append(arguments, value)
	}
	if group.other {
		return fmt.Sprintf("if(%s IN (%s), %s, NULL)", base, placeholders, base), "", arguments
	}
	return base, fmt.Sprintf("%s IN (%s)", base, placeholders), arguments
}

// where renders the source predicate: project, window, environment, the widget's filters,
// and — for measurement rows — which key and dimension rows to read.
func (query MetricsQuery) where(source catalog.Source, from, to time.Time, dimensionRows string) (string, []any) {
	clauses := []string{"project_id = ?", "bucket >= ?", "bucket < ?"}
	arguments := []any{query.ProjectID, from, to}
	if query.Environment != "" {
		clauses = append(clauses, "environment = ?")
		arguments = append(arguments, query.Environment)
	}
	if source.KeyColumn != "" {
		clauses = append(clauses, source.KeyColumn+" = ?")
		arguments = append(arguments, query.Spec.Measurement)
	}
	if source.DimensionRows {
		clauses = append(clauses, "dimension = ?")
		arguments = append(arguments, dimensionRows)
	}
	filterClauses, filterArguments := query.filterPredicates(source)
	clauses = append(clauses, filterClauses...)
	arguments = append(arguments, filterArguments...)
	return strings.Join(clauses, " AND "), arguments
}

func (query MetricsQuery) filterPredicates(source catalog.Source) ([]string, []any) {
	keys := make([]string, 0, len(query.Spec.Filters))
	for key := range query.Spec.Filters {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	clauses := make([]string, 0, len(keys))
	arguments := make([]any, 0, len(keys))
	for _, key := range keys {
		column := source.Filters[key]
		value := query.Spec.Filters[key]
		if column.Unknown && value == "unknown" {
			value = ""
		}
		clauses = append(clauses, column.Column+" = ?")
		arguments = append(arguments, value)
	}
	return clauses, arguments
}

func (query MetricsQuery) regularSQL(metrics []catalog.Metric, current window, group grouping, ranked bool) (string, []any) {
	source := query.source()
	if group.dimension && catalog.IsTwoLevelDimension(source.ID, query.Spec.Dimension) {
		return query.errorTypeSQL(metrics, current, group, ranked)
	}
	// A column split reads the 'all' rows; a row split reads that dimension's rows.
	dimensionRows := "all"
	columnSplit := source.IsColumnDimension(query.Spec.Dimension)
	if group.dimension && !columnSplit {
		dimensionRows = query.Spec.Dimension
	}
	where, arguments := query.where(source, current.from, current.to, dimensionRows)
	selects := make([]string, 0, 2+len(metrics))
	groupBy := make([]string, 0, 2)
	var groupArguments []any
	if group.interval > 0 {
		selects = append(selects, pointExpression("bucket", current, group.interval)+" AS point")
		groupBy = append(groupBy, "point")
	}
	if group.dimension {
		base := "dimension_value"
		if columnSplit {
			base = source.Dimensions[query.Spec.Dimension]
		}
		expression, predicate, restrictArguments := groupExpression(base, group)
		selects = append(selects, expression+" AS grp")
		groupBy = append(groupBy, "grp")
		if predicate != "" {
			where += " AND " + predicate
			arguments = append(arguments, restrictArguments...)
		} else {
			groupArguments = restrictArguments
		}
	}
	for index, metric := range metrics {
		selects = append(selects, catalogMetricColumns(metric, index))
	}
	statement := "SELECT " + strings.Join(selects, ", ") + " FROM " + source.Table + " WHERE " + where
	if len(groupBy) > 0 {
		statement += " GROUP BY " + strings.Join(groupBy, ", ")
	}
	if ranked {
		statement += query.orderBy(metrics)
	}
	// Placeholders in the SELECT list (the "Other" fold) precede those in WHERE.
	return statement + metricsQuerySettings, append(groupArguments, arguments...)
}

// Outer merges for the two-level error-type query, keyed by metric. The inner level has
// already resolved each fingerprint's type and re-emitted its states with -MergeState.
var errorTypeColumns = map[string]string{
	"issues.events":       "coalesce(uniqCombined64Merge(e), 0)",
	"issues.users":        "coalesce(uniqCombined64Merge(u), 0)",
	"issues.sessions":     "coalesce(uniqCombined64Merge(ss), 0)",
	"issues.activeIssues": "uniqExact(fingerprint)",
}

// errorTypeSQL answers a breakdown by error type. error_type is an argMax state per row,
// so each fingerprint's type is resolved first; grouping the raw rows by it directly would
// split one Issue across types.
func (query MetricsQuery) errorTypeSQL(metrics []catalog.Metric, current window, group grouping, ranked bool) (string, []any) {
	source := query.source()
	where, arguments := query.where(source, current.from, current.to, "")
	innerSelects := []string{"fingerprint", "argMaxMerge(error_type) AS et",
		"uniqCombined64MergeState(events) AS e", "uniqCombined64MergeState(users) AS u",
		"uniqCombined64MergeState(sessions) AS ss"}
	innerGroup := []string{"fingerprint"}
	outerSelects := make([]string, 0, 2+len(metrics))
	outerGroup := make([]string, 0, 2)
	if group.interval > 0 {
		innerSelects = append([]string{pointExpression("bucket", current, group.interval) + " AS point"}, innerSelects...)
		innerGroup = append([]string{"point"}, innerGroup...)
		outerSelects = append(outerSelects, "point")
		outerGroup = append(outerGroup, "point")
	}
	expression, predicate, restrictArguments := groupExpression("if(et = '', 'unknown', et)", group)
	outerSelects = append(outerSelects, expression+" AS grp")
	outerGroup = append(outerGroup, "grp")
	for index, metric := range metrics {
		column := errorTypeColumns[metric.ID]
		outerSelects = append(outerSelects, fmt.Sprintf("toFloat64(%s) AS a%d, toFloat64(0) AS b%d, toUInt64(coalesce(uniqCombined64Merge(e), 0)) AS s%d",
			column, index, index, index))
	}
	statement := "SELECT " + strings.Join(outerSelects, ", ") + " FROM (SELECT " + strings.Join(innerSelects, ", ") +
		" FROM " + source.Table + " WHERE " + where + " GROUP BY " + strings.Join(innerGroup, ", ") + ")"
	var selectArguments, outerArguments []any
	if predicate != "" {
		statement += " WHERE " + predicate
		outerArguments = restrictArguments
	} else {
		selectArguments = restrictArguments
	}
	statement += " GROUP BY " + strings.Join(outerGroup, ", ")
	if ranked {
		statement += query.orderBy(metrics)
	}
	combined := append(append(selectArguments, arguments...), outerArguments...)
	return statement + metricsQuerySettings, combined
}

// newIssuesSQL counts Issues whose first occurrence in this environment falls inside the
// window, looking back newIssueLookback for an earlier one. It is one scan with no JOIN or
// IN-subquery, so it stays correct on a Distributed table. Widget filters narrow which new
// Issues are counted without changing what "new" means: "new in release X" is an Issue new
// overall that was seen in X, not one merely first seen in X, which would recount old
// regressions every release.
func (query MetricsQuery) newIssuesSQL(current window, group grouping, ranked bool) (string, []any) {
	source := query.source()
	innerWhere := []string{"project_id = ?", "bucket >= ?", "bucket < ?"}
	arguments := []any{query.ProjectID, current.from.Add(-newIssueLookback), current.to}
	if query.Environment != "" {
		innerWhere = append(innerWhere, "environment = ?")
		arguments = append(arguments, query.Environment)
	}
	having := "fs >= ? AND fs < ?"
	arguments = append(arguments, current.from, current.to)
	filterClauses, filterArguments := query.filterPredicates(source)
	if len(filterClauses) > 0 {
		having += " AND max(bucket >= ? AND bucket < ? AND " + strings.Join(filterClauses, " AND ") + ") = 1"
		arguments = append(arguments, current.from, current.to)
		arguments = append(arguments, filterArguments...)
	}
	inner := "SELECT fingerprint, minMerge(first_seen) AS fs, argMaxMerge(error_type) AS et FROM " + source.Table +
		" WHERE " + strings.Join(innerWhere, " AND ") + " GROUP BY fingerprint HAVING " + having

	selects := make([]string, 0, 3)
	groupBy := make([]string, 0, 2)
	var selectArguments, outerArguments []any
	outerWhere := ""
	if group.interval > 0 {
		selects = append(selects, pointExpression("fs", current, group.interval)+" AS point")
		groupBy = append(groupBy, "point")
	}
	if group.dimension {
		expression, predicate, restrictArguments := groupExpression("if(et = '', 'unknown', et)", group)
		selects = append(selects, expression+" AS grp")
		groupBy = append(groupBy, "grp")
		if predicate != "" {
			outerWhere = " WHERE " + predicate
			outerArguments = restrictArguments
		} else {
			selectArguments = restrictArguments
		}
	}
	selects = append(selects, "toFloat64(count()) AS a0, toFloat64(0) AS b0, toUInt64(count()) AS s0")
	statement := "SELECT " + strings.Join(selects, ", ") + " FROM (" + inner + ")" + outerWhere
	if len(groupBy) > 0 {
		statement += " GROUP BY " + strings.Join(groupBy, ", ")
	}
	if ranked {
		newIssues, _ := catalog.Lookup("issues.newIssues")
		statement += query.orderBy([]catalog.Metric{newIssues})
	}
	combined := append(append(selectArguments, arguments...), outerArguments...)
	return statement + metricsQuerySettings, combined
}
