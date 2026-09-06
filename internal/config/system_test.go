package config

import (
	"encoding/json"
	"testing"
	"time"
)

func TestResolveSystemSettingsPrecedence(t *testing.T) {
	id := SettingID{Namespace: "retention", Key: "rawDays"}
	updatedAt := time.Date(2026, 9, 4, 1, 2, 3, 0, time.FixedZone("test", 8*60*60))
	definition := SystemSettingDefinition{ID: id, DefaultValue: json.RawMessage("14")}
	stored := []StoredSystemSetting{{ID: id, Value: json.RawMessage("30"), Version: 2, UpdatedAt: updatedAt}}

	resolved := ResolveSystemSettings([]SystemSettingDefinition{definition}, stored, map[SettingID]json.RawMessage{id: json.RawMessage("7")})
	if string(resolved[0].Value) != "7" || resolved[0].Source != SettingSourceProject || resolved[0].Locked {
		t.Fatalf("project override resolution = %+v", resolved[0])
	}

	definition.DeploymentValue = json.RawMessage("21")
	resolved = ResolveSystemSettings([]SystemSettingDefinition{definition}, stored, map[SettingID]json.RawMessage{id: json.RawMessage("7")})
	if string(resolved[0].Value) != "21" || resolved[0].Source != SettingSourceDeployment || !resolved[0].Locked {
		t.Fatalf("deployment resolution = %+v", resolved[0])
	}
	if resolved[0].Version != 2 || resolved[0].UpdatedAt == nil || !resolved[0].UpdatedAt.Equal(updatedAt.UTC()) {
		t.Fatalf("persisted metadata was not preserved: %+v", resolved[0])
	}
}

func TestLoadSystemSettingsValidatesDeploymentValues(t *testing.T) {
	_, err := loadSystemSettings(func(key string) string {
		if key == "OPENRUM_DEFAULT_RAW_RETENTION_DAYS" {
			return "91"
		}
		return ""
	})
	if err == nil {
		t.Fatal("loadSystemSettings() error = nil, want range validation")
	}
}
