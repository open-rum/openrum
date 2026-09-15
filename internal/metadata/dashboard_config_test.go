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
