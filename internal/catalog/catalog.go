// Package catalog is the code-defined semantic layer behind dashboard modules.
//
// A dashboard module never carries SQL. It names metrics from this catalog, and the catalog
// decides which aggregate table answers them, how their merged states are combined, which
// dimensions they can be split by, and whether splitting them still adds up. Both the query
// endpoint and the saved-configuration validator call the same Validate, so a module that
// saves is a module that queries.
//
// The package imports only the standard library: internal/query already imports
// internal/metadata, so living in either would create a cycle.
package catalog

import (
	"slices"
	"time"
)

type SourceID string

const (
	SourceProject     SourceID = "project"
	SourceAPI         SourceID = "api"
	SourceIssue       SourceID = "issue"
	SourceMeasurement SourceID = "measurement"
	SourceBehavior    SourceID = "behavior"
)

type Unit string

const (
	UnitCount  Unit = "count"
	UnitRatio  Unit = "ratio"
	UnitMS     Unit = "ms"
	UnitScore  Unit = "score"
	UnitNumber Unit = "number"
)

// Weighting records whether a value was scaled back up by the Event's sample rate.
// Estimated counts and sampled counts cannot share an axis or a stack: at a 10% sample
// rate the estimated series is ten times the sampled one, and drawing them together
// invents a ratio the data does not have.
type Weighting string

const (
	WeightingEstimated Weighting = "estimated"
	WeightingSampled   Weighting = "sampled"
	WeightingNone      Weighting = "none"
)

type Kind string

const (
	KindCount     Kind = "count"
	KindDistinct  Kind = "distinct"
	KindRate      Kind = "rate"
	KindQuantile  Kind = "quantile"
	KindExtremum  Kind = "extremum"
	KindMean      Kind = "mean"
	KindNewIssues Kind = "newIssues"
)

// Direction says which way is better, so a comparison badge can be toned without the
// Console hard-coding a list of metrics.
type Direction string

const (
	DirectionUp      Direction = "up"
	DirectionDown    Direction = "down"
	DirectionNeutral Direction = "neutral"
)

type Family string

const (
	FamilyTraffic     Family = "traffic"
	FamilyVitals      Family = "vitals"
	FamilyAPI         Family = "api"
	FamilyIssues      Family = "issues"
	FamilyMeasurement Family = "measurement"
	FamilyBehavior    Family = "behavior"
)

type Thresholds struct {
	Good float64 `json:"good"`
	Poor float64 `json:"poor"`
}

// allDimensions marks a metric that adds up across every dimension its source offers.
var allDimensions = []string{"*"}

type Metric struct {
	ID          string
	Family      Family
	Label       string
	Description string
	Source      SourceID
	Unit        Unit
	Weighting   Weighting
	Kind        Kind
	Direction   Direction
	Semantic    string

	// Value is the merge expression for count, distinct, quantile and extremum kinds.
	// Rate and mean kinds use Numerator and Denominator instead.
	Value       string
	Numerator   string
	Denominator string
	Samples     string

	// A value computed from fewer samples is still returned, but marked insufficient.
	MinSamples uint64

	AdditiveOverTime bool
	// PartitionDims lists the dimensions across which values sum to the total: only
	// those can be stacked or given an "Other" row, and only those have a meaningful share.
	PartitionDims []string
	// Dimensions restricts the allowed breakdowns. Nil means every dimension of the source.
	Dimensions []string
	// Metrics in one group are disjoint parts of one whole and may be stacked together.
	CompositionGroup string

	Approximate bool
	Thresholds  *Thresholds
}

// AdditiveOver reports whether values split by dimension sum back to the total.
func (metric Metric) AdditiveOver(dimension string) bool {
	if len(metric.PartitionDims) == 1 && metric.PartitionDims[0] == "*" {
		return true
	}
	return slices.Contains(metric.PartitionDims, dimension)
}

type Source struct {
	ID         SourceID
	Table      string
	Resolution time.Duration
	// Dimensions maps a catalog dimension to its SQL expression over a column.
	Dimensions map[string]string
	// DimensionRows marks a table that stores one (dimension, dimension_value) pair per
	// row. Every read selects exactly one kind of row — 'all' unless the question is split
	// by one of RowDimensions — so an Event is never counted once per dimension. A split
	// by a row dimension groups by dimension_value, and no other row dimension can be
	// filtered at the same time. Column dimensions are read from the 'all' rows.
	DimensionRows bool
	RowDimensions []string
	// PropertyRows marks row tables that also carry one `property:<key>` row per Custom
	// Event attribute.
	PropertyRows bool
	// KeyColumn names the column a required measurement key selects, if the source has one.
	KeyColumn string
	Filters   map[string]FilterColumn
}

// FilterColumn describes how a widget filter narrows a source.
type FilterColumn struct {
	Column string
	// Prefix marks a leading sort-key column. It prunes far more of the table than a
	// trailing column does, which the query budget rewards.
	Prefix bool
	// Unknown maps the "unknown" value shown for an empty dimension back to ''.
	Unknown bool
}

var sources = map[SourceID]Source{}
var metrics = map[string]Metric{}
var metricOrder []string

func register(metric Metric) {
	if _, exists := metrics[metric.ID]; exists {
		panic("catalog: duplicate metric " + metric.ID)
	}
	metrics[metric.ID] = metric
	metricOrder = append(metricOrder, metric.ID)
}

// Lookup returns a metric by id.
func Lookup(id string) (Metric, bool) {
	metric, ok := metrics[id]
	return metric, ok
}

// LookupSource returns a source by id.
func LookupSource(id SourceID) (Source, bool) {
	source, ok := sources[id]
	return source, ok
}

// All returns every metric in catalog order.
func All() []Metric {
	result := make([]Metric, 0, len(metricOrder))
	for _, id := range metricOrder {
		result = append(result, metrics[id])
	}
	return result
}

// SourceDimensions returns the dimensions a metric may be broken down by. Property
// dimensions are open-ended and are validated by pattern rather than listed.
func (metric Metric) SourceDimensions() []string {
	if metric.Dimensions != nil {
		return metric.Dimensions
	}
	source := sources[metric.Source]
	result := make([]string, 0, len(source.Dimensions)+len(source.RowDimensions))
	for _, dimension := range dimensionOrder {
		if _, ok := source.Dimensions[dimension]; ok {
			result = append(result, dimension)
		}
	}
	return append(result, source.RowDimensions...)
}

// IsColumnDimension reports whether a split reads a column rather than dimension rows.
func (source Source) IsColumnDimension(dimension string) bool {
	_, ok := source.Dimensions[dimension]
	return ok
}
