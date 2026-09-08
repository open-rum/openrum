package metadata

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"

	"openrum/internal/config"
	"openrum/internal/filter"
)

var ErrInvalidProjectConfig = errors.New("invalid project SDK configuration")

type ProjectSDKConfig struct {
	ProjectID           uuid.UUID  `json:"projectId"`
	Version             int64      `json:"version"`
	EffectiveAt         time.Time  `json:"effectiveAt"`
	EventSampleRate     float64    `json:"eventSampleRate"`
	APISampleRate       float64    `json:"apiSampleRate"`
	ErrorSampleRate     float64    `json:"errorSampleRate"`
	EmergencySampleRate *float64   `json:"emergencySampleRate,omitempty"`
	EmergencyExpiresAt  *time.Time `json:"emergencyExpiresAt,omitempty"`
	// Filters carries only the rules a browser should act on. The consumer
	// applies the full set, so this is a bandwidth optimisation rather than
	// the authoritative copy.
	Filters filter.Settings `json:"filters"`
}

type ProjectRetentionPolicy struct {
	RawDays       int
	AggregateDays int
}

type ProjectConfigRepository struct{ database *sql.DB }

func NewProjectConfigRepository(database *sql.DB) *ProjectConfigRepository {
	return &ProjectConfigRepository{database: database}
}

func (repository *ProjectConfigRepository) Get(ctx context.Context, projectID uuid.UUID, now time.Time) (ProjectSDKConfig, error) {
	var config ProjectSDKConfig
	var filters []byte
	err := repository.database.QueryRowContext(ctx, `SELECT id,sdk_config_version,sdk_config_effective_at,
		event_sample_rate,api_sample_rate,error_sample_rate,emergency_sample_rate,emergency_expires_at,inbound_filters
		FROM projects WHERE id=$1 AND status='active'`, projectID).Scan(&config.ProjectID, &config.Version,
		&config.EffectiveAt, &config.EventSampleRate, &config.APISampleRate, &config.ErrorSampleRate,
		&config.EmergencySampleRate, &config.EmergencyExpiresAt, &filters)
	if errors.Is(err, sql.ErrNoRows) {
		return ProjectSDKConfig{}, ErrNotFound
	}
	if err != nil {
		return ProjectSDKConfig{}, err
	}
	stored, err := decodeFilterSettings(filters)
	if err != nil {
		return ProjectSDKConfig{}, err
	}
	config.Filters = stored.ClientEnforced()
	config.EffectiveAt = config.EffectiveAt.UTC()
	if config.EmergencyExpiresAt != nil {
		expires := config.EmergencyExpiresAt.UTC()
		config.EmergencyExpiresAt = &expires
	}
	if config.EmergencyExpiresAt == nil || !now.UTC().Before(*config.EmergencyExpiresAt) {
		config.EmergencySampleRate, config.EmergencyExpiresAt = nil, nil
	}
	return config, nil
}

func (repository *ProjectConfigRepository) GetRetentionPolicy(
	ctx context.Context,
	projectID uuid.UUID,
	definitions []config.SystemSettingDefinition,
) (ProjectRetentionPolicy, error) {
	var projectRawDays int
	if err := repository.database.QueryRowContext(ctx,
		"SELECT retention_days FROM projects WHERE id=$1 AND status='active'", projectID,
	).Scan(&projectRawDays); errors.Is(err, sql.ErrNoRows) {
		return ProjectRetentionPolicy{}, ErrNotFound
	} else if err != nil {
		return ProjectRetentionPolicy{}, fmt.Errorf("read project retention override: %w", err)
	}

	instanceSettings, err := NewInstanceSettingRepository(repository.database).List(ctx)
	if err != nil {
		return ProjectRetentionPolicy{}, fmt.Errorf("read instance retention settings: %w", err)
	}
	stored := make([]config.StoredSystemSetting, 0, len(instanceSettings))
	for _, setting := range instanceSettings {
		stored = append(stored, config.StoredSystemSetting{
			ID: config.SettingID{Namespace: setting.Namespace, Key: setting.Key}, Value: setting.Value,
			Version: setting.Version, UpdatedAt: setting.UpdatedAt,
		})
	}
	return resolveProjectRetentionPolicy(projectRawDays, definitions, stored)
}

func resolveProjectRetentionPolicy(
	projectRawDays int,
	definitions []config.SystemSettingDefinition,
	stored []config.StoredSystemSetting,
) (ProjectRetentionPolicy, error) {
	rawID := config.SettingID{Namespace: "retention", Key: "rawDays"}
	aggregateID := config.SettingID{Namespace: "retention", Key: "aggregateDays"}
	override, err := json.Marshal(projectRawDays)
	if err != nil {
		return ProjectRetentionPolicy{}, err
	}
	resolved := config.ResolveSystemSettings(definitions, stored, map[config.SettingID]json.RawMessage{rawID: override})
	policy := ProjectRetentionPolicy{}
	for _, setting := range resolved {
		switch setting.ID {
		case rawID:
			if err := json.Unmarshal(setting.Value, &policy.RawDays); err != nil {
				return ProjectRetentionPolicy{}, fmt.Errorf("decode effective raw retention: %w", err)
			}
		case aggregateID:
			if err := json.Unmarshal(setting.Value, &policy.AggregateDays); err != nil {
				return ProjectRetentionPolicy{}, fmt.Errorf("decode effective aggregate retention: %w", err)
			}
		}
	}
	if policy.RawDays < 1 || policy.RawDays > 90 || policy.AggregateDays < 1 || policy.AggregateDays > 730 {
		return ProjectRetentionPolicy{}, fmt.Errorf("effective retention policy is incomplete or outside supported bounds")
	}
	return policy, nil
}

func (repository *ProjectConfigRepository) SetEmergency(ctx context.Context, actorID, projectID uuid.UUID, rate *float64, expiresAt *time.Time) (ProjectSDKConfig, error) {
	now := time.Now().UTC()
	if (rate == nil) != (expiresAt == nil) || rate != nil && (*rate < 0 || *rate > 1 || !expiresAt.After(now) || expiresAt.After(now.Add(24*time.Hour))) {
		return ProjectSDKConfig{}, ErrInvalidProjectConfig
	}
	transaction, err := repository.database.BeginTx(ctx, nil)
	if err != nil {
		return ProjectSDKConfig{}, err
	}
	defer func() { _ = transaction.Rollback() }()
	var organizationID uuid.UUID
	err = transaction.QueryRowContext(ctx, "SELECT organization_id FROM projects WHERE id=$1 FOR UPDATE", projectID).Scan(&organizationID)
	if errors.Is(err, sql.ErrNoRows) {
		return ProjectSDKConfig{}, ErrNotFound
	}
	if err != nil {
		return ProjectSDKConfig{}, err
	}
	actorRole, err := lockMembership(ctx, transaction, organizationID, actorID)
	if err != nil {
		return ProjectSDKConfig{}, err
	}
	if !canManageProjectSettings(actorRole) {
		return ProjectSDKConfig{}, ErrForbidden
	}
	if _, err := transaction.ExecContext(ctx, `UPDATE projects SET emergency_sample_rate=$1,emergency_expires_at=$2,
		sdk_config_version=sdk_config_version+1,sdk_config_effective_at=$3,updated_at=now() WHERE id=$4`,
		rate, expiresAt, now, projectID); err != nil {
		return ProjectSDKConfig{}, fmt.Errorf("update emergency SDK configuration: %w", err)
	}
	if err := insertAudit(ctx, transaction, organizationID, actorID, "project.sdk_config.emergency_updated", "project", projectID); err != nil {
		return ProjectSDKConfig{}, err
	}
	if err := transaction.Commit(); err != nil {
		return ProjectSDKConfig{}, err
	}
	return repository.Get(ctx, projectID, now)
}
