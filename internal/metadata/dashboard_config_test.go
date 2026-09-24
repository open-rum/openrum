package metadata

import (
	"encoding/json"
	"fmt"
	"testing"
)

func TestDashboardCountryMapValidation(t *testing.T) {
	for _, tc := range []struct {
		name, moduleType, source, dimension, view string
		valid                                     bool
	}{
		{"country map", "breakdown", "events", "country", "map", true},
		{"country bars", "breakdown", "events", "country", "bar", true},
		{"country table", "breakdown", "events", "country", "table", true},
		{"country donut", "breakdown", "events", "country", "donut", true},
		{"device donut", "breakdown", "events", "device", "donut", true},
		{"browser donut", "breakdown", "events", "browser", "donut", true},
		{"source donut", "breakdown", "events", "source", "donut", true},
		{"property donut", "breakdown", "events", "property:plan", "donut", true},
		{"trend donut", "timeseries", "events", "country", "donut", false},
		{"stat donut", "stat", "events", "country", "donut", false},
		{"overview donut", "breakdown", "overview", "country", "donut", false},
		{"device map", "breakdown", "events", "device", "map", false},
		{"browser map", "breakdown", "events", "browser", "map", false},
		{"property map", "breakdown", "events", "property:plan", "map", false},
		{"trend map", "timeseries", "events", "country", "map", false},
		{"stat map", "stat", "events", "country", "map", false},
		{"overview map", "breakdown", "overview", "country", "map", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			raw := json.RawMessage(fmt.Sprintf(`{"schemaVersion":1,"widgets":[{"id":"country-map","type":%q,"version":1,"title":"国家分布","size":"half","view":%q,"data":{"source":%q,"metrics":["estimated"],"dimension":%q}}]}`, tc.moduleType, tc.view, tc.source, tc.dimension))
			err := ValidateDashboardConfig(raw, nil)
			if (err == nil) != tc.valid {
				t.Fatalf("valid=%v error=%v", tc.valid, err)
			}
		})
	}
}

func TestDashboardStatAppearanceValidation(t *testing.T) {
	for _, tc := range []struct {
		name, moduleType, view, field string
		valid                         bool
	}{
		{"legacy", "stat", "number", "", true},
		{"plain", "stat", "number", `,"statAppearance":"plain"`, true},
		{"right", "stat", "number", `,"statAppearance":"line-right"`, true},
		{"right-bar", "stat", "number", `,"statAppearance":"bar-right"`, true},
		{"bottom", "stat", "number", `,"statAppearance":"line-bottom"`, true},
		{"area", "stat", "number", `,"statAppearance":"area-bottom"`, true},
		{"unknown", "stat", "number", `,"statAppearance":"rainbow"`, false},
		{"empty", "stat", "number", `,"statAppearance":""`, false},
		{"null", "stat", "number", `,"statAppearance":null`, false},
		{"object", "stat", "number", `,"statAppearance":{}`, false},
		{"non-stat", "timeseries", "line", `,"statAppearance":"plain"`, false},
		{"non-stat-bar", "timeseries", "bar", `,"statAppearance":"bar-right"`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			raw := json.RawMessage(fmt.Sprintf(`{"schemaVersion":1,"widgets":[{"id":"stat-pv","type":%q,"version":1,"title":"PV","size":"half","view":%q,"data":{"source":"overview","metrics":["pageViews"]}%s}]}`, tc.moduleType, tc.view, tc.field))
			if err := ValidateDashboardConfig(raw, nil); (err == nil) != tc.valid {
				t.Fatalf("valid=%v error=%v", tc.valid, err)
			}
		})
	}
}
