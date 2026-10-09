package catalog

import (
	"slices"
	"sort"
)

// Document is the catalog as the Console sees it. It carries every rule the editor needs
// to offer only valid combinations, and none of the SQL.
type Document struct {
	Version    int              `json:"version"`
	Families   []FamilyDocument `json:"families"`
	Metrics    []MetricDocument `json:"metrics"`
	Dimensions []DimensionLabel `json:"dimensions"`
	Filters    []string         `json:"filters"`
	Limits     Limits           `json:"limits"`
}

type FamilyDocument struct {
	ID    Family `json:"id"`
	Label string `json:"label"`
}

type DimensionLabel struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

type MetricDocument struct {
	ID               string      `json:"id"`
	Family           Family      `json:"family"`
	Label            string      `json:"label"`
	Description      string      `json:"description"`
	Source           SourceID    `json:"source"`
	Unit             Unit        `json:"unit"`
	Weighting        Weighting   `json:"weighting"`
	Kind             Kind        `json:"kind"`
	Direction        Direction   `json:"direction"`
	Semantic         string      `json:"semantic,omitempty"`
	Shapes           []Shape     `json:"shapes"`
	Dimensions       []string    `json:"dimensions"`
	PropertyDims     bool        `json:"propertyDimensions"`
	AdditiveDims     []string    `json:"additiveDimensions"`
	Filters          []string    `json:"filters"`
	Compare          bool        `json:"compare"`
	CompositionGroup string      `json:"compositionGroup,omitempty"`
	AdditiveOverTime bool        `json:"additiveOverTime"`
	MinSamples       uint64      `json:"minSamples,omitempty"`
	MinInterval      int64       `json:"minIntervalSeconds"`
	RequiresKey      bool        `json:"requiresMeasurementKey"`
	Approximate      bool        `json:"approximate"`
	Thresholds       *Thresholds `json:"thresholds,omitempty"`
}

// DocumentVersion changes whenever a published rule changes meaning, so a cached copy in
// the Console can be told apart from the current one.
const DocumentVersion = 2

var familyLabels = []FamilyDocument{
	{FamilyTraffic, "流量与会话"},
	{FamilyVitals, "Web Vitals"},
	{FamilyAPI, "API"},
	{FamilyIssues, "错误"},
	{FamilyMeasurement, "业务指标"},
	{FamilyBehavior, "用户行为"},
}

// Describe builds the catalog document.
func Describe() Document {
	document := Document{
		Version: DocumentVersion, Families: familyLabels,
		Filters: []string{"release", "route", "country", "browser", "device", "apiMethod", "apiUrl", "eventKind", "eventName"},
		Limits:  CurrentLimits(),
	}
	for _, dimension := range dimensionOrder {
		document.Dimensions = append(document.Dimensions, DimensionLabel{ID: dimension, Label: DimensionLabels[dimension]})
	}
	for _, metric := range All() {
		document.Metrics = append(document.Metrics, describeMetric(metric))
	}
	return document
}

func describeMetric(metric Metric) MetricDocument {
	source := sources[metric.Source]
	dimensions := metric.SourceDimensions()
	additive := make([]string, 0)
	for _, dimension := range dimensions {
		if metric.AdditiveOver(dimension) {
			additive = append(additive, dimension)
		}
	}
	filters := make([]string, 0, len(source.Filters))
	for key := range source.Filters {
		filters = append(filters, key)
	}
	sort.Strings(filters)
	shapes := []Shape{ShapeTotal, ShapeSeries}
	if len(dimensions) > 0 {
		shapes = append(shapes, ShapeBreakdown, ShapeSeriesByDimension, ShapeTable)
	}
	return MetricDocument{
		ID: metric.ID, Family: metric.Family, Label: metric.Label, Description: metric.Description,
		Source: metric.Source, Unit: metric.Unit, Weighting: metric.Weighting, Kind: metric.Kind,
		Direction: metric.Direction, Semantic: metric.Semantic, Shapes: shapes,
		Dimensions: slices.Clone(dimensions), PropertyDims: source.PropertyRows && metric.Dimensions == nil,
		AdditiveDims: additive, Filters: filters, Compare: true, CompositionGroup: metric.CompositionGroup,
		AdditiveOverTime: metric.AdditiveOverTime, MinSamples: metric.MinSamples,
		MinInterval: int64(source.Resolution.Seconds()), RequiresKey: source.KeyColumn != "",
		Approximate: metric.Approximate, Thresholds: metric.Thresholds,
	}
}
