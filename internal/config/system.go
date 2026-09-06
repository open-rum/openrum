package config

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"strconv"
	"time"
)

type SettingSource string

const (
	SettingSourceDefault    SettingSource = "default"
	SettingSourceInstance   SettingSource = "instance"
	SettingSourceProject    SettingSource = "project"
	SettingSourceDeployment SettingSource = "deployment"
)

type SettingID struct {
	Namespace string
	Key       string
}

type SystemSettingDefinition struct {
	ID              SettingID
	DefaultValue    json.RawMessage
	DeploymentValue json.RawMessage
	Validate        func(json.RawMessage) bool
}

type StoredSystemSetting struct {
	ID        SettingID
	Value     json.RawMessage
	Version   int64
	UpdatedAt time.Time
}

type EffectiveSystemSetting struct {
	ID        SettingID
	Value     json.RawMessage
	Source    SettingSource
	Locked    bool
	Version   int64
	UpdatedAt *time.Time
}

func (configuration Config) FindSystemSetting(id SettingID) (SystemSettingDefinition, bool) {
	for _, definition := range configuration.SystemSettings {
		if definition.ID == id {
			return definition, true
		}
	}
	return SystemSettingDefinition{}, false
}

func ResolveSystemSettings(
	definitions []SystemSettingDefinition,
	stored []StoredSystemSetting,
	projectOverrides map[SettingID]json.RawMessage,
) []EffectiveSystemSetting {
	storedByID := make(map[SettingID]StoredSystemSetting, len(stored))
	for _, setting := range stored {
		storedByID[setting.ID] = setting
	}
	resolved := make([]EffectiveSystemSetting, 0, len(definitions))
	for _, definition := range definitions {
		setting := EffectiveSystemSetting{
			ID: definition.ID, Value: cloneJSON(definition.DefaultValue), Source: SettingSourceDefault,
		}
		if persisted, ok := storedByID[definition.ID]; ok {
			updatedAt := persisted.UpdatedAt.UTC()
			setting.Value = cloneJSON(persisted.Value)
			setting.Source = SettingSourceInstance
			setting.Version = persisted.Version
			setting.UpdatedAt = &updatedAt
		}
		if projectValue, ok := projectOverrides[definition.ID]; ok &&
			(definition.Validate == nil || definition.Validate(projectValue)) {
			setting.Value = cloneJSON(projectValue)
			setting.Source = SettingSourceProject
		}
		if len(definition.DeploymentValue) > 0 {
			setting.Value = cloneJSON(definition.DeploymentValue)
			setting.Source = SettingSourceDeployment
			setting.Locked = true
		}
		resolved = append(resolved, setting)
	}
	return resolved
}

func loadSystemSettings(values func(string) string) ([]SystemSettingDefinition, error) {
	type integerSetting struct {
		id           SettingID
		environment  string
		defaultValue int
		minimum      int
		maximum      int
	}
	settings := []integerSetting{
		{SettingID{"retention", "rawDays"}, "OPENRUM_DEFAULT_RAW_RETENTION_DAYS", 14, 1, 90},
		{SettingID{"retention", "aggregateDays"}, "OPENRUM_DEFAULT_AGGREGATE_RETENTION_DAYS", 90, 1, 730},
		{SettingID{"retention", "sourceMapDays"}, "OPENRUM_DEFAULT_SOURCEMAP_RETENTION_DAYS", 0, 0, 3650},
	}
	definitions := make([]SystemSettingDefinition, 0, len(settings))
	for _, setting := range settings {
		definition := SystemSettingDefinition{
			ID:           setting.id,
			DefaultValue: integerJSON(setting.defaultValue),
			Validate:     integerRangeValidator(setting.minimum, setting.maximum),
		}
		if raw := values(setting.environment); raw != "" {
			value, err := strconv.Atoi(raw)
			if err != nil || value < setting.minimum || value > setting.maximum {
				return nil, fmt.Errorf("%s must be an integer between %d and %d", setting.environment, setting.minimum, setting.maximum)
			}
			definition.DeploymentValue = integerJSON(value)
		}
		definitions = append(definitions, definition)
	}
	return definitions, nil
}

func integerRangeValidator(minimum, maximum int) func(json.RawMessage) bool {
	return func(raw json.RawMessage) bool {
		decoder := json.NewDecoder(bytes.NewReader(raw))
		var value int
		if err := decoder.Decode(&value); err != nil || value < minimum || value > maximum {
			return false
		}
		return decoder.Decode(&struct{}{}) == io.EOF
	}
}

func integerJSON(value int) json.RawMessage {
	return json.RawMessage(strconv.Itoa(value))
}

func cloneJSON(value json.RawMessage) json.RawMessage {
	return append(json.RawMessage(nil), value...)
}
