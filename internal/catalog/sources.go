package catalog

import "time"

// dimensionOrder fixes the order dimensions are listed in, so the catalog document and
// the editor that is built from it do not reshuffle between requests.
var dimensionOrder = []string{
	"eventName", "route", "release", "country", "browser", "device", "api", "apiMethod", "errorType", "source",
}

// DimensionLabels are the Console's names for each breakdown dimension.
var DimensionLabels = map[string]string{
	"route":     "页面路由",
	"release":   "版本",
	"country":   "国家/地区",
	"browser":   "浏览器",
	"device":    "设备类型",
	"api":       "API",
	"apiMethod": "请求方法",
	"errorType": "错误类型",
	"source":    "来源",
	"eventName": "事件名称",
}

// Measurement and behavior rows are written by the 0009 and 0006 materialized views with
// exactly these dimensions, plus one row per `property:<key>` attribute on Custom Events.
var measurementDimensions = []string{"country", "device", "browser", "source"}
var behaviorRowDimensions = measurementDimensions

// Event kinds as the 0006 view derives them.
var eventKinds = []string{"page_view", "navigation", "click", "custom"}

// Empty strings are shown as "unknown" so a group of Events with no value is visible
// rather than silently merged into a blank row. The measurement view applies the same
// rule when it writes dimension_value, so both paths agree.
func unknownIfEmpty(column string) string {
	return "if(" + column + " = '', 'unknown', toString(" + column + "))"
}

func init() {
	commonDimensions := map[string]string{
		"route":   unknownIfEmpty("route"),
		"release": unknownIfEmpty("release"),
		"country": unknownIfEmpty("country"),
		"browser": unknownIfEmpty("browser"),
		"device":  unknownIfEmpty("device_type"),
	}
	commonFilters := map[string]FilterColumn{
		"release": {Column: "release", Prefix: true},
		"route":   {Column: "route", Prefix: true},
		"country": {Column: "country", Unknown: true},
		"browser": {Column: "browser", Unknown: true},
		"device":  {Column: "device_type", Unknown: true},
	}

	sources[SourceProject] = Source{
		ID: SourceProject, Table: "project_metrics_1m", Resolution: time.Minute,
		Dimensions: commonDimensions, Filters: commonFilters,
	}
	sources[SourceAPI] = Source{
		ID: SourceAPI, Table: "api_metrics_1m", Resolution: time.Minute,
		Dimensions: map[string]string{
			"route":     unknownIfEmpty("route"),
			"release":   unknownIfEmpty("release"),
			"api":       "concat(toString(api_method), ' ', api_url_normalized)",
			"apiMethod": unknownIfEmpty("api_method"),
		},
		Filters: map[string]FilterColumn{
			"release":   {Column: "release", Prefix: true},
			"route":     {Column: "route", Prefix: true},
			"apiMethod": {Column: "api_method"},
			"apiUrl":    {Column: "api_url_normalized"},
		},
	}
	issueDimensions := map[string]string{"errorType": errorTypeDimension}
	for key, expression := range commonDimensions {
		issueDimensions[key] = expression
	}
	sources[SourceIssue] = Source{
		// The rollup is written in five-minute buckets. A series is never drawn finer.
		ID: SourceIssue, Table: "issue_metrics_5m", Resolution: 5 * time.Minute,
		Dimensions: issueDimensions, Filters: commonFilters,
	}
	sources[SourceMeasurement] = Source{
		ID: SourceMeasurement, Table: "measurement_metrics_1m", Resolution: time.Minute,
		DimensionRows: true, RowDimensions: measurementDimensions, PropertyRows: true, KeyColumn: "measurement",
		Filters: map[string]FilterColumn{
			"eventName": {Column: "event_name", Prefix: true},
		},
	}
	// Behavior rows are keyed by event kind and name ahead of the dimension, so a split by
	// event name is a column split over the 'all' rows, and filtering on either prunes the
	// sort key.
	sources[SourceBehavior] = Source{
		ID: SourceBehavior, Table: "behavior_metrics_1m", Resolution: time.Minute,
		Dimensions:    map[string]string{"eventName": "event_name"},
		DimensionRows: true, RowDimensions: behaviorRowDimensions, PropertyRows: true,
		Filters: map[string]FilterColumn{
			"eventKind": {Column: "event_kind", Prefix: true},
			"eventName": {Column: "event_name", Prefix: true},
		},
	}
}

// errorTypeDimension is a marker, not SQL: error_type is an argMax state per row, so a
// breakdown by it needs a two-level query that resolves each fingerprint's type first.
const errorTypeDimension = "@errorType"

// IsTwoLevelDimension reports whether a dimension cannot be grouped on directly.
func IsTwoLevelDimension(source SourceID, dimension string) bool {
	return source == SourceIssue && dimension == "errorType"
}
