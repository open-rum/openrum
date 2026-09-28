package catalog

import (
	"errors"
	"fmt"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

// ErrInvalidSpec wraps every rejection. The wrapped reason is fixed text that is safe to
// show a user; it never echoes the rejected value.
var ErrInvalidSpec = errors.New("invalid metrics query")

func invalid(format string, arguments ...any) error {
	return fmt.Errorf("%w: "+format, append([]any{ErrInvalidSpec}, arguments...)...)
}

type Shape string

const (
	ShapeTotal             Shape = "total"
	ShapeSeries            Shape = "series"
	ShapeBreakdown         Shape = "breakdown"
	ShapeSeriesByDimension Shape = "seriesByDimension"
	ShapeTable             Shape = "table"
)

type Stack string

const (
	StackNone      Stack = ""
	StackMetrics   Stack = "metrics"
	StackDimension Stack = "dimension"
)

// Spec is one metrics question: which metrics, in what shape, split and filtered how.
// It carries no time range or environment — those belong to the page, not the module.
type Spec struct {
	Metrics     []string
	Shape       Shape
	Dimension   string
	Measurement string
	Filters     map[string]string
	Compare     bool
	TopN        int
	Sort        string
	Order       string
	Sparkline   bool
	Stack       Stack
	// Groups pins the split to these dimension values, in this order, instead of ranking
	// the top N. Nothing outside them is drawn and there is no "Other".
	Groups []string
}

var (
	measurementKeyPattern = regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$`)
	countryPattern        = regexp.MustCompile(`^([A-Z]{2}|unknown)$`)
	apiMethodPattern      = regexp.MustCompile(`^[A-Z]{1,16}$`)
)

const propertyPrefix = "property:"

var metricLimits = map[Shape]int{
	ShapeTotal: 4, ShapeSeries: 4, ShapeBreakdown: 1, ShapeSeriesByDimension: 1, ShapeTable: 6,
}

// Group limits. A stacked or multi-line chart past nine groups plus "Other" stops being
// readable, and the fixed chart palette has exactly ten colours.
const (
	defaultBreakdownTopN = 10
	maxBreakdownTopN     = 50
	// A country ranking may list every country; saved modules still carry this limit.
	maxCountryBreakdownTopN = 250
	defaultDimensionTopN    = 5
	maxDimensionTopN        = 9
	defaultTableTopN        = 10
	maxTableTopN            = 50
	maxGroupValueLength     = 512
)

// Limits are published in the catalog document so the editor offers only valid values.
type Limits struct {
	MaxMetrics       map[Shape]int `json:"maxMetrics"`
	MaxBreakdownTopN int           `json:"maxBreakdownTopN"`
	MaxDimensionTopN int           `json:"maxDimensionTopN"`
	MaxTableTopN     int           `json:"maxTableTopN"`
}

func CurrentLimits() Limits {
	return Limits{
		MaxMetrics: metricLimits, MaxBreakdownTopN: maxBreakdownTopN,
		MaxDimensionTopN: maxDimensionTopN, MaxTableTopN: maxTableTopN,
	}
}

// Validate checks a spec against the catalog and returns it with defaults filled in.
func Validate(requested Spec) (Spec, error) {
	spec := requested
	spec.Dimension = strings.TrimSpace(spec.Dimension)
	spec.Measurement = strings.TrimSpace(spec.Measurement)

	limit, ok := metricLimits[spec.Shape]
	if !ok {
		return Spec{}, invalid("unsupported shape")
	}
	if len(spec.Metrics) == 0 || len(spec.Metrics) > limit {
		return Spec{}, invalid("this shape accepts between 1 and %d metrics", limit)
	}
	resolved := make([]Metric, 0, len(spec.Metrics))
	seen := map[string]bool{}
	for _, id := range spec.Metrics {
		metric, known := Lookup(id)
		if !known {
			return Spec{}, invalid("unknown metric")
		}
		if seen[id] {
			return Spec{}, invalid("a metric may appear only once")
		}
		seen[id] = true
		if len(resolved) > 0 && metric.Source != resolved[0].Source {
			return Spec{}, invalid("all metrics must come from the same source")
		}
		resolved = append(resolved, metric)
	}
	source := sources[resolved[0].Source]

	if err := validateMeasurement(spec, source); err != nil {
		return Spec{}, err
	}
	if spec.Shape != ShapeTable {
		if err := sharedAxis(resolved); err != nil {
			return Spec{}, err
		}
	}
	if err := validateDimension(spec, source, resolved); err != nil {
		return Spec{}, err
	}
	groups, err := validateGroups(spec)
	if err != nil {
		return Spec{}, err
	}
	spec.Groups = groups
	filters, err := validateFilters(spec, source)
	if err != nil {
		return Spec{}, err
	}
	spec.Filters = filters
	if err := validateStack(spec, resolved); err != nil {
		return Spec{}, err
	}
	if spec.Compare && spec.Shape == ShapeSeriesByDimension {
		return Spec{}, invalid("a comparison cannot be drawn over a split series")
	}
	if spec.Sparkline && spec.Shape != ShapeTable {
		return Spec{}, invalid("sparklines are only available on tables")
	}
	topN, err := validateTopN(spec)
	if err != nil {
		return Spec{}, err
	}
	spec.TopN = topN
	if spec.Sort == "" {
		spec.Sort = spec.Metrics[0]
	} else if !slices.Contains(spec.Metrics, spec.Sort) {
		return Spec{}, invalid("the sort metric must be one of the requested metrics")
	}
	switch spec.Order {
	case "":
		spec.Order = "desc"
	case "asc", "desc":
	default:
		return Spec{}, invalid("order must be asc or desc")
	}
	return spec, nil
}

// sharedAxis enforces one unit per chart. Counts must also share their weighting, except
// distinct counts: users and Sessions are never scaled by the sample rate, and showing
// them beside an estimated volume is the long-standing PV and UV pairing.
func sharedAxis(resolved []Metric) error {
	var weighting Weighting
	for _, metric := range resolved {
		if metric.Unit != resolved[0].Unit {
			return invalid("metrics drawn together must share a unit")
		}
		if metric.Unit != UnitCount || metric.Kind == KindDistinct {
			continue
		}
		if weighting == "" {
			weighting = metric.Weighting
		} else if metric.Weighting != weighting {
			return invalid("sample-rate-weighted and unweighted counts cannot share an axis")
		}
	}
	return nil
}

func validateMeasurement(spec Spec, source Source) error {
	if source.KeyColumn == "" {
		if spec.Measurement != "" {
			return invalid("a measurement key is only valid for measurement metrics")
		}
		return nil
	}
	if !measurementKeyPattern.MatchString(spec.Measurement) {
		return invalid("measurement metrics need a valid measurement key")
	}
	return nil
}

func validateDimension(spec Spec, source Source, resolved []Metric) error {
	needsDimension := spec.Shape == ShapeBreakdown || spec.Shape == ShapeSeriesByDimension || spec.Shape == ShapeTable
	if !needsDimension {
		if spec.Dimension != "" {
			return invalid("this shape does not take a dimension")
		}
		return nil
	}
	if spec.Dimension == "" {
		return invalid("this shape needs a dimension")
	}
	if strings.HasPrefix(spec.Dimension, propertyPrefix) {
		if !source.PropertyRows {
			return invalid("property dimensions are only available on measurement and behavior metrics")
		}
		if !measurementKeyPattern.MatchString(strings.TrimPrefix(spec.Dimension, propertyPrefix)) {
			return invalid("invalid property dimension")
		}
		return nil
	}
	for _, metric := range resolved {
		if !slices.Contains(metric.SourceDimensions(), spec.Dimension) {
			return invalid("a requested metric cannot be split by this dimension")
		}
	}
	return nil
}

func validateFilters(spec Spec, source Source) (map[string]string, error) {
	if len(spec.Filters) == 0 {
		return nil, nil
	}
	result := make(map[string]string, len(spec.Filters))
	for key, raw := range spec.Filters {
		value := strings.TrimSpace(raw)
		if value == "" {
			continue
		}
		if _, ok := source.Filters[key]; !ok {
			return nil, invalid("this filter is not available for the requested metrics")
		}
		// Filtering on the field being broken down leaves a one-row breakdown.
		if key == spec.Dimension || (key == "apiMethod" && spec.Dimension == "api") ||
			(key == "apiUrl" && spec.Dimension == "api") {
			return nil, invalid("a module cannot filter on the dimension it is split by")
		}
		if !validFilterValue(key, value) {
			return nil, invalid("a filter value is malformed or too long")
		}
		result[key] = value
	}
	if len(result) == 0 {
		return nil, nil
	}
	return result, nil
}

func validFilterValue(key, value string) bool {
	if !utf8.ValidString(value) || strings.ContainsAny(value, "\x00\r\n") {
		return false
	}
	switch key {
	case "country":
		return countryPattern.MatchString(value)
	case "apiMethod":
		return apiMethodPattern.MatchString(value)
	case "release":
		return len(value) <= 128
	case "route":
		return len(value) <= 512
	case "apiUrl":
		return len(value) <= 2048
	case "eventName":
		return len(value) <= 80
	case "eventKind":
		return slices.Contains(eventKinds, value)
	default:
		return len(value) <= 64
	}
}

func validateStack(spec Spec, resolved []Metric) error {
	switch spec.Stack {
	case StackNone:
		return nil
	case StackMetrics:
		if spec.Shape != ShapeSeries || len(resolved) < 2 {
			return invalid("stacking metrics needs a series of at least two metrics")
		}
		group := resolved[0].CompositionGroup
		for _, metric := range resolved {
			if group == "" || metric.CompositionGroup != group {
				return invalid("only disjoint parts of one whole can be stacked together")
			}
		}
		return nil
	case StackDimension:
		if spec.Shape != ShapeSeriesByDimension {
			return invalid("stacking by dimension needs a split series")
		}
		if !resolved[0].AdditiveOver(spec.Dimension) {
			return invalid("this metric does not add up across the dimension and cannot be stacked")
		}
		return nil
	default:
		return invalid("unsupported stack mode")
	}
}

// validateGroups checks pinned groups. They replace the ranking, so a pinned split takes
// no group limit, and a line chart keeps the same palette ceiling as a ranked one.
func validateGroups(spec Spec) ([]string, error) {
	if len(spec.Groups) == 0 {
		return nil, nil
	}
	var maximum int
	switch spec.Shape {
	case ShapeSeriesByDimension:
		maximum = maxDimensionTopN
	case ShapeBreakdown:
		maximum = maxBreakdownTopN
	case ShapeTable:
		maximum = maxTableTopN
	default:
		return nil, invalid("only a split module can pin its groups")
	}
	if len(spec.Groups) > maximum {
		return nil, invalid("too many pinned groups")
	}
	// Validate runs again on a validated spec, whose limit is already the group count.
	if spec.TopN != 0 && spec.TopN != len(spec.Groups) {
		return nil, invalid("pinned groups replace the group limit")
	}
	result := make([]string, 0, len(spec.Groups))
	for _, raw := range spec.Groups {
		value := strings.TrimSpace(raw)
		// Control characters are refused outright; one of them separates groups in the cache key.
		if value == "" || len(value) > maxGroupValueLength || !utf8.ValidString(value) ||
			strings.IndexFunc(value, unicode.IsControl) >= 0 {
			return nil, invalid("a pinned group is empty, malformed or too long")
		}
		if spec.Dimension == "country" && !countryPattern.MatchString(value) {
			return nil, invalid("a pinned group is empty, malformed or too long")
		}
		if slices.Contains(result, value) {
			return nil, invalid("a group may be pinned only once")
		}
		result = append(result, value)
	}
	return result, nil
}

func validateTopN(spec Spec) (int, error) {
	if len(spec.Groups) > 0 {
		return len(spec.Groups), nil
	}
	var fallback, maximum int
	switch spec.Shape {
	case ShapeBreakdown:
		fallback, maximum = defaultBreakdownTopN, maxBreakdownTopN
		if spec.Dimension == "country" {
			maximum = maxCountryBreakdownTopN
		}
	case ShapeSeriesByDimension:
		fallback, maximum = defaultDimensionTopN, maxDimensionTopN
	case ShapeTable:
		fallback, maximum = defaultTableTopN, maxTableTopN
	default:
		if spec.TopN != 0 {
			return 0, invalid("this shape does not take a group limit")
		}
		return 0, nil
	}
	if spec.TopN == 0 {
		return fallback, nil
	}
	if spec.TopN < 1 || spec.TopN > maximum {
		return 0, invalid("the group limit is out of range")
	}
	return spec.TopN, nil
}

// Source returns the source every metric of a validated spec reads.
func (spec Spec) Source() SourceID {
	metric, _ := Lookup(spec.Metrics[0])
	return metric.Source
}

// ResolvedMetrics returns the catalog entries for a validated spec, in request order.
func (spec Spec) ResolvedMetrics() []Metric {
	result := make([]Metric, 0, len(spec.Metrics))
	for _, id := range spec.Metrics {
		metric, _ := Lookup(id)
		result = append(result, metric)
	}
	return result
}

// Canonical is a stable encoding for cache keys. Metric order is kept because it decides
// series order and colours; filter order is not, because it decides nothing.
func (spec Spec) Canonical() string {
	keys := make([]string, 0, len(spec.Filters))
	for key := range spec.Filters {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	var builder strings.Builder
	for _, part := range []string{
		strings.Join(spec.Metrics, ","), string(spec.Shape), spec.Dimension, spec.Measurement,
		strconv.FormatBool(spec.Compare), strconv.Itoa(spec.TopN), spec.Sort, spec.Order,
		strconv.FormatBool(spec.Sparkline), string(spec.Stack), strings.Join(spec.Groups, "\x1f"),
	} {
		builder.WriteString(part)
		builder.WriteByte('\n')
	}
	for _, key := range keys {
		builder.WriteString(key)
		builder.WriteByte('=')
		builder.WriteString(spec.Filters[key])
		builder.WriteByte('\n')
	}
	return builder.String()
}

// ShapeForWidget maps a saved module to the question it asks. A stat always asks for a
// series with its range totals, so a stat and a trend over the same metric share one
// request, and switching a stat's appearance never issues a new query.
func ShapeForWidget(widgetType, view, dimension string) (Shape, Stack, error) {
	stacked := view == "stacked-area" || view == "stacked-bar"
	switch widgetType {
	case "stat":
		return ShapeSeries, StackNone, nil
	case "timeseries":
		if dimension == "" {
			if stacked {
				return ShapeSeries, StackMetrics, nil
			}
			return ShapeSeries, StackNone, nil
		}
		if stacked {
			return ShapeSeriesByDimension, StackDimension, nil
		}
		return ShapeSeriesByDimension, StackNone, nil
	case "breakdown":
		return ShapeBreakdown, StackNone, nil
	case "ranked-table", "metric-table":
		return ShapeTable, StackNone, nil
	default:
		return "", StackNone, invalid("unsupported module type")
	}
}
