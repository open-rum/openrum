package catalog

import (
	"errors"
	"strings"
	"testing"
)

func TestEveryMetricIsQueryable(t *testing.T) {
	for _, metric := range All() {
		source, ok := LookupSource(metric.Source)
		if !ok {
			t.Fatalf("%s reads an unknown source %q", metric.ID, metric.Source)
		}
		if source.Table == "" {
			t.Fatalf("%s source has no table", metric.ID)
		}
		switch metric.Kind {
		case KindRate, KindMean:
			if metric.Numerator == "" || metric.Denominator == "" {
				t.Fatalf("%s is a %s without numerator and denominator", metric.ID, metric.Kind)
			}
		case KindNewIssues:
			// Answered by a dedicated query, not a merge expression.
		default:
			if metric.Value == "" {
				t.Fatalf("%s has no value expression", metric.ID)
			}
		}
		if metric.Kind != KindNewIssues && metric.Samples == "" {
			t.Fatalf("%s has no sample expression", metric.ID)
		}
		if metric.Label == "" || metric.Description == "" {
			t.Fatalf("%s needs a label and a description", metric.ID)
		}
		for _, dimension := range metric.PartitionDims {
			if dimension != "*" && !contains(metric.SourceDimensions(), dimension) {
				t.Fatalf("%s is additive over %q, which it cannot be split by", metric.ID, dimension)
			}
		}
	}
}

// A composition group is a promise that its members are disjoint parts of one whole. Mixed
// units or weightings would make the stack's height mean nothing.
func TestCompositionGroupsShareUnitAndWeighting(t *testing.T) {
	groups := map[string]Metric{}
	for _, metric := range All() {
		if metric.CompositionGroup == "" {
			continue
		}
		first, seen := groups[metric.CompositionGroup]
		if !seen {
			groups[metric.CompositionGroup] = metric
			continue
		}
		if first.Unit != metric.Unit || first.Weighting != metric.Weighting || first.Source != metric.Source {
			t.Fatalf("group %s mixes %s and %s", metric.CompositionGroup, first.ID, metric.ID)
		}
	}
	if len(groups) == 0 {
		t.Fatal("expected at least one composition group")
	}
}

func TestValidateFillsDefaults(t *testing.T) {
	spec, err := Validate(Spec{Metrics: []string{"traffic.pageViews"}, Shape: ShapeBreakdown, Dimension: "route"})
	if err != nil {
		t.Fatal(err)
	}
	if spec.TopN != 10 || spec.Sort != "traffic.pageViews" || spec.Order != "desc" {
		t.Fatalf("defaults were not filled: %+v", spec)
	}
	country, err := Validate(Spec{Metrics: []string{"traffic.pageViews"}, Shape: ShapeBreakdown, Dimension: "country", TopN: 250})
	if err != nil || country.TopN != 250 {
		t.Fatalf("a country ranking may list every country: %+v %v", country, err)
	}
}

func TestValidateAcceptsUsefulQuestions(t *testing.T) {
	for name, spec := range map[string]Spec{
		"PV and UV together":       {Metrics: []string{"traffic.pageViews", "traffic.uniqueUsers"}, Shape: ShapeSeries},
		"API outcome composition":  {Metrics: []string{"api.clientErrorRate", "api.serverErrorRate", "api.networkErrorRate"}, Shape: ShapeSeries, Stack: StackMetrics},
		"latency percentiles":      {Metrics: []string{"api.durationP50", "api.durationP75", "api.durationP95"}, Shape: ShapeSeries},
		"page views by device":     {Metrics: []string{"traffic.pageViews"}, Shape: ShapeSeriesByDimension, Dimension: "device", Stack: StackDimension},
		"error rate by browser":    {Metrics: []string{"traffic.errorRate"}, Shape: ShapeTable, Dimension: "browser", Compare: true, Sparkline: true},
		"country overview table":   {Metrics: []string{"traffic.sessions", "traffic.errorRate", "vitals.lcpP75"}, Shape: ShapeTable, Dimension: "country"},
		"new issues by type":       {Metrics: []string{"issues.newIssues"}, Shape: ShapeBreakdown, Dimension: "errorType"},
		"issues in one release":    {Metrics: []string{"issues.events"}, Shape: ShapeSeries, Filters: map[string]string{"release": "1.2.0"}},
		"revenue spread":           {Metrics: []string{"measurement.p50", "measurement.p90", "measurement.avg"}, Shape: ShapeSeries, Measurement: "amount"},
		"revenue by payment":       {Metrics: []string{"measurement.sum"}, Shape: ShapeBreakdown, Dimension: "property:payment", Measurement: "amount"},
		"unknown country filter":   {Metrics: []string{"traffic.pageViews"}, Shape: ShapeTotal, Filters: map[string]string{"country": "unknown"}},
		"previous period on stats": {Metrics: []string{"traffic.sessions"}, Shape: ShapeSeries, Compare: true},
		"payment events as lines":  {Metrics: []string{"behavior.events"}, Shape: ShapeSeriesByDimension, Dimension: "eventName", Groups: []string{"pay_start", "pay_success", "pay_failed"}},
		"payment events stacked":   {Metrics: []string{"behavior.events"}, Shape: ShapeSeriesByDimension, Dimension: "eventName", Groups: []string{"pay_success", "pay_failed"}, Stack: StackDimension},
		"top custom events":        {Metrics: []string{"behavior.events", "behavior.users"}, Shape: ShapeTable, Dimension: "eventName", Filters: map[string]string{"eventKind": "custom"}},
		"one event by country":     {Metrics: []string{"behavior.events"}, Shape: ShapeBreakdown, Dimension: "country", Filters: map[string]string{"eventName": "pay_success"}},
		"one event by property":    {Metrics: []string{"behavior.events"}, Shape: ShapeBreakdown, Dimension: "property:method", Filters: map[string]string{"eventName": "pay_success"}},
		"events and users":         {Metrics: []string{"behavior.events", "behavior.users"}, Shape: ShapeSeries, Compare: true},
		"pinned countries":         {Metrics: []string{"traffic.pageViews"}, Shape: ShapeTable, Dimension: "country", Groups: []string{"CN", "US"}},
	} {
		if _, err := Validate(spec); err != nil {
			t.Errorf("%s: %v", name, err)
		}
	}
}

func TestValidateRejectsMisleadingQuestions(t *testing.T) {
	for name, spec := range map[string]Spec{
		"unknown metric":         {Metrics: []string{"traffic.nope"}, Shape: ShapeSeries},
		"duplicate metric":       {Metrics: []string{"traffic.pageViews", "traffic.pageViews"}, Shape: ShapeSeries},
		"mixed sources":          {Metrics: []string{"traffic.pageViews", "api.requests"}, Shape: ShapeSeries},
		"mixed units":            {Metrics: []string{"traffic.pageViews", "traffic.errorRate"}, Shape: ShapeSeries},
		"mixed weighting":        {Metrics: []string{"api.requests", "api.serverErrors"}, Shape: ShapeSeries},
		"stack outside group":    {Metrics: []string{"api.failureRate", "api.serverErrorRate"}, Shape: ShapeSeries, Stack: StackMetrics},
		"stack a rate by dim":    {Metrics: []string{"traffic.errorRate"}, Shape: ShapeSeriesByDimension, Dimension: "browser", Stack: StackDimension},
		"stack UV by dim":        {Metrics: []string{"traffic.uniqueUsers"}, Shape: ShapeSeriesByDimension, Dimension: "browser", Stack: StackDimension},
		"new issues by browser":  {Metrics: []string{"issues.newIssues"}, Shape: ShapeBreakdown, Dimension: "browser"},
		"vital P95 does not":     {Metrics: []string{"vitals.lcpP95"}, Shape: ShapeSeries},
		"property on project":    {Metrics: []string{"traffic.pageViews"}, Shape: ShapeBreakdown, Dimension: "property:plan"},
		"measurement no key":     {Metrics: []string{"measurement.sum"}, Shape: ShapeSeries},
		"key on non-measurement": {Metrics: []string{"traffic.pageViews"}, Shape: ShapeSeries, Measurement: "amount"},
		"measurement by country": {Metrics: []string{"measurement.sum"}, Shape: ShapeSeries, Measurement: "amount", Filters: map[string]string{"country": "CN"}},
		"filter own dimension":   {Metrics: []string{"traffic.pageViews"}, Shape: ShapeBreakdown, Dimension: "browser", Filters: map[string]string{"browser": "Chrome"}},
		"api filter on api dim":  {Metrics: []string{"api.requests"}, Shape: ShapeBreakdown, Dimension: "api", Filters: map[string]string{"apiUrl": "/a"}},
		"compare split series":   {Metrics: []string{"traffic.pageViews"}, Shape: ShapeSeriesByDimension, Dimension: "device", Compare: true},
		"dimension on series":    {Metrics: []string{"traffic.pageViews"}, Shape: ShapeSeries, Dimension: "device"},
		"breakdown without dim":  {Metrics: []string{"traffic.pageViews"}, Shape: ShapeBreakdown},
		"too many groups":        {Metrics: []string{"traffic.pageViews"}, Shape: ShapeSeriesByDimension, Dimension: "device", TopN: 10},
		"two breakdown metrics":  {Metrics: []string{"traffic.pageViews", "traffic.errors"}, Shape: ShapeBreakdown, Dimension: "route"},
		"sparkline off table":    {Metrics: []string{"traffic.pageViews"}, Shape: ShapeSeries, Sparkline: true},
		"sort not requested":     {Metrics: []string{"traffic.pageViews"}, Shape: ShapeTable, Dimension: "route", Sort: "traffic.errors"},
		"bad country":            {Metrics: []string{"traffic.pageViews"}, Shape: ShapeTotal, Filters: map[string]string{"country": "china"}},
		"route too long":         {Metrics: []string{"traffic.pageViews"}, Shape: ShapeTotal, Filters: map[string]string{"route": strings.Repeat("a", 513)}},
		"newline in filter":      {Metrics: []string{"traffic.pageViews"}, Shape: ShapeTotal, Filters: map[string]string{"release": "a\nb"}},
		"api filter on project":  {Metrics: []string{"traffic.pageViews"}, Shape: ShapeTotal, Filters: map[string]string{"apiMethod": "GET"}},
		"unsupported shape":      {Metrics: []string{"traffic.pageViews"}, Shape: "pie"},
		"stack event users":      {Metrics: []string{"behavior.users"}, Shape: ShapeSeriesByDimension, Dimension: "eventName", Stack: StackDimension},
		"stack event property":   {Metrics: []string{"behavior.events"}, Shape: ShapeSeriesByDimension, Dimension: "property:method", Stack: StackDimension},
		"event key":              {Metrics: []string{"behavior.events"}, Shape: ShapeSeries, Measurement: "amount"},
		"bad event kind":         {Metrics: []string{"behavior.events"}, Shape: ShapeTotal, Filters: map[string]string{"eventKind": "scroll"}},
		"event kind on project":  {Metrics: []string{"traffic.pageViews"}, Shape: ShapeTotal, Filters: map[string]string{"eventKind": "custom"}},
		"split and filter name":  {Metrics: []string{"behavior.events"}, Shape: ShapeSeriesByDimension, Dimension: "eventName", Filters: map[string]string{"eventName": "a"}},
		"groups without split":   {Metrics: []string{"behavior.events"}, Shape: ShapeSeries, Groups: []string{"a"}},
		"groups with topN":       {Metrics: []string{"behavior.events"}, Shape: ShapeSeriesByDimension, Dimension: "eventName", Groups: []string{"a"}, TopN: 3},
		"too many lines":         {Metrics: []string{"behavior.events"}, Shape: ShapeSeriesByDimension, Dimension: "eventName", Groups: []string{"a", "b", "c", "d", "e", "f", "g", "h", "i", "j"}},
		"duplicate group":        {Metrics: []string{"behavior.events"}, Shape: ShapeSeriesByDimension, Dimension: "eventName", Groups: []string{"a", " a"}},
		"empty group":            {Metrics: []string{"behavior.events"}, Shape: ShapeSeriesByDimension, Dimension: "eventName", Groups: []string{"a", " "}},
		"control char group":     {Metrics: []string{"behavior.events"}, Shape: ShapeSeriesByDimension, Dimension: "eventName", Groups: []string{"a\x1fb"}},
		"bad country group":      {Metrics: []string{"traffic.pageViews"}, Shape: ShapeTable, Dimension: "country", Groups: []string{"china"}},
	} {
		if _, err := Validate(spec); !errors.Is(err, ErrInvalidSpec) {
			t.Errorf("%s: expected a rejection, got %v", name, err)
		}
	}
}

func TestCanonicalIgnoresFilterOrderButKeepsMetricOrder(t *testing.T) {
	first := Spec{Metrics: []string{"a", "b"}, Filters: map[string]string{"route": "/x", "release": "1"}}
	second := Spec{Metrics: []string{"a", "b"}, Filters: map[string]string{"release": "1", "route": "/x"}}
	if first.Canonical() != second.Canonical() {
		t.Fatal("filter order must not change the cache key")
	}
	reversed := Spec{Metrics: []string{"b", "a"}, Filters: first.Filters}
	if first.Canonical() == reversed.Canonical() {
		t.Fatal("metric order decides series order and must change the key")
	}
	pinned := Spec{Metrics: []string{"a"}, Groups: []string{"x", "y"}}
	swapped := Spec{Metrics: []string{"a"}, Groups: []string{"y", "x"}}
	if pinned.Canonical() == swapped.Canonical() || pinned.Canonical() == first.Canonical() {
		t.Fatal("pinned groups decide what is drawn and in which colour")
	}
}

func TestShapeForWidget(t *testing.T) {
	for _, current := range []struct {
		widget, view, dimension string
		shape                   Shape
		stack                   Stack
	}{
		{"stat", "number", "", ShapeSeries, StackNone},
		{"timeseries", "line", "", ShapeSeries, StackNone},
		{"timeseries", "stacked-area", "", ShapeSeries, StackMetrics},
		{"timeseries", "line", "device", ShapeSeriesByDimension, StackNone},
		{"timeseries", "stacked-bar", "device", ShapeSeriesByDimension, StackDimension},
		{"breakdown", "donut", "device", ShapeBreakdown, StackNone},
		{"ranked-table", "table", "route", ShapeTable, StackNone},
		{"metric-table", "table", "country", ShapeTable, StackNone},
	} {
		shape, stack, err := ShapeForWidget(current.widget, current.view, current.dimension)
		if err != nil || shape != current.shape || stack != current.stack {
			t.Errorf("%s/%s/%s → %s/%s %v", current.widget, current.view, current.dimension, shape, stack, err)
		}
	}
	if _, _, err := ShapeForWidget("top-issues", "table", ""); err == nil {
		t.Fatal("classic module types are not catalog modules")
	}
}

func TestDescribePublishesRulesWithoutSQL(t *testing.T) {
	document := Describe()
	if len(document.Metrics) != len(All()) {
		t.Fatalf("expected every metric, got %d", len(document.Metrics))
	}
	for _, metric := range document.Metrics {
		if metric.ID == "vitals.lcpP75" && (metric.Thresholds == nil || metric.MinSamples != 50) {
			t.Fatalf("vital thresholds were lost: %+v", metric)
		}
		if metric.ID == "issues.events" && metric.MinInterval != 300 {
			t.Fatalf("issue metrics must publish their five-minute floor: %+v", metric)
		}
		if metric.ID == "measurement.sum" && (!metric.RequiresKey || !metric.PropertyDims) {
			t.Fatalf("measurement metrics need a key and accept properties: %+v", metric)
		}
		if metric.ID == "behavior.events" && (metric.RequiresKey || !metric.PropertyDims || metric.Dimensions[0] != "eventName" ||
			!contains(metric.AdditiveDims, "eventName") || contains(metric.AdditiveDims, "property:method")) {
			t.Fatalf("event counts split by name without a key and add up across names: %+v", metric)
		}
		if metric.ID == "traffic.uniqueUsers" && len(metric.AdditiveDims) != 0 {
			t.Fatalf("UV must not be marked additive: %+v", metric)
		}
	}
}

func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
