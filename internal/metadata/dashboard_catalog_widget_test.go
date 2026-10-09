package metadata

import (
	"encoding/json"
	"os"
	"testing"
)

// The same cases run in the Console's validator (apps/web). If the two disagree, a module
// could look valid in the editor and then fail to save, or the reverse.
type dashboardWidgetCase struct {
	Name   string          `json:"name"`
	Valid  bool            `json:"valid"`
	Widget json.RawMessage `json:"widget"`
}

func TestSharedDashboardWidgetCases(t *testing.T) {
	contents, err := os.ReadFile("testdata/dashboard_widget_cases.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []dashboardWidgetCase
	if err := json.Unmarshal(contents, &cases); err != nil {
		t.Fatal(err)
	}
	if len(cases) < 20 {
		t.Fatalf("expected the full case matrix, got %d", len(cases))
	}
	for _, current := range cases {
		config, err := json.Marshal(DashboardConfig{SchemaVersion: 1, Widgets: []json.RawMessage{current.Widget}})
		if err != nil {
			t.Fatal(err)
		}
		err = ValidateDashboardConfig(config, nil)
		if current.Valid && err != nil {
			t.Errorf("%s: rejected: %v", current.Name, err)
		}
		if !current.Valid && err == nil {
			t.Errorf("%s: accepted", current.Name)
		}
	}
}

// An older API pod keeps a catalog module it cannot read, as long as it is unchanged.
func TestCatalogModulesSurviveAnOlderValidator(t *testing.T) {
	widget := json.RawMessage(`{"id":"a","type":"future","version":3,"title":"x"}`)
	config, _ := json.Marshal(DashboardConfig{SchemaVersion: 1, Widgets: []json.RawMessage{widget}})
	if err := ValidateDashboardConfig(config, config); err != nil {
		t.Fatalf("an unchanged unknown module must be kept: %v", err)
	}
	edited := json.RawMessage(`{"id":"a","type":"future","version":3,"title":"y"}`)
	changed, _ := json.Marshal(DashboardConfig{SchemaVersion: 1, Widgets: []json.RawMessage{edited}})
	if err := ValidateDashboardConfig(changed, config); err == nil {
		t.Fatal("an unknown module cannot be edited through this validator")
	}
}
