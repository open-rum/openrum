package metadata

import (
	"encoding/json"
	"testing"

	"openrum/internal/config"
)

func TestResolveProjectRetentionPolicyHonorsPrecedence(t *testing.T) {
	rawID := config.SettingID{Namespace: "retention", Key: "rawDays"}
	aggregateID := config.SettingID{Namespace: "retention", Key: "aggregateDays"}
	definitions := []config.SystemSettingDefinition{
		{ID: rawID, DefaultValue: json.RawMessage(`14`), DeploymentValue: json.RawMessage(`30`)},
		{ID: aggregateID, DefaultValue: json.RawMessage(`90`)},
	}
	stored := []config.StoredSystemSetting{{ID: aggregateID, Value: json.RawMessage(`180`)}}

	policy, err := resolveProjectRetentionPolicy(7, definitions, stored)
	if err != nil {
		t.Fatal(err)
	}
	if policy.RawDays != 30 || policy.AggregateDays != 180 {
		t.Fatalf("policy=%+v", policy)
	}
}

func TestResolveProjectRetentionPolicyRequiresCompleteBoundedPolicy(t *testing.T) {
	_, err := resolveProjectRetentionPolicy(14, []config.SystemSettingDefinition{{
		ID: config.SettingID{Namespace: "retention", Key: "rawDays"}, DefaultValue: json.RawMessage(`14`),
	}}, nil)
	if err == nil {
		t.Fatal("expected incomplete policy error")
	}
}
