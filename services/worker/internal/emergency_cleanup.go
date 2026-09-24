package internal

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"openrum/internal/metadata"
)

type EmergencyCleanupStore interface {
	ClaimStep(context.Context) (metadata.EmergencyCleanupJobStep, bool, error)
	CompleteStep(context.Context, metadata.EmergencyCleanupJobStep) error
	RetryStep(context.Context, metadata.EmergencyCleanupJobStep, error) error
}

type EmergencyPartitionCleaner interface {
	Drop(context.Context, metadata.EmergencyCleanupJobStep) error
}

type EmergencyCleanupJob struct {
	store   EmergencyCleanupStore
	cleaner EmergencyPartitionCleaner
}

func NewEmergencyCleanupJob(store EmergencyCleanupStore, cleaner EmergencyPartitionCleaner) *EmergencyCleanupJob {
	return &EmergencyCleanupJob{store: store, cleaner: cleaner}
}

func (job *EmergencyCleanupJob) RunOne(ctx context.Context) (bool, error) {
	step, found, err := job.store.ClaimStep(ctx)
	if err != nil || !found {
		return false, err
	}
	if err := job.cleaner.Drop(ctx, step); err != nil {
		return true, errors.Join(err, job.store.RetryStep(ctx, step, err))
	}
	if err := job.store.CompleteStep(ctx, step); err != nil {
		return true, errors.Join(err, job.store.RetryStep(ctx, step, err))
	}
	return true, nil
}

type ClickHouseEmergencyPartitionCleaner struct{ database *sql.DB }

func NewClickHouseEmergencyPartitionCleaner(database *sql.DB) *ClickHouseEmergencyPartitionCleaner {
	return &ClickHouseEmergencyPartitionCleaner{database: database}
}

var emergencyPartitionTables = map[string]struct{}{
	"event_stack_mappings_local":   {},
	"behavior_metrics_1m_local":    {},
	"measurement_metrics_1m_local": {},
	"usage_metrics_1h_local":       {},
	"usage_records_local":          {},
	"api_metrics_1m_local":         {},
	"issue_metrics_5m_local":       {},
	"project_metrics_1m_local":     {},
	"rum_events_local":             {},
}

func (cleaner *ClickHouseEmergencyPartitionCleaner) Drop(
	ctx context.Context,
	step metadata.EmergencyCleanupJobStep,
) error {
	if _, supported := emergencyPartitionTables[step.Table]; !supported || !validEmergencyPartitionID(step.PartitionID) {
		return fmt.Errorf("unsupported emergency cleanup partition")
	}
	var parts uint64
	if err := cleaner.database.QueryRowContext(ctx, `SELECT count() FROM system.parts
		WHERE database=currentDatabase() AND table=? AND partition_id=? AND active`,
		step.Table, step.PartitionID).Scan(&parts); err != nil {
		return fmt.Errorf("check emergency cleanup partition: %w", err)
	}
	if parts == 0 {
		return nil
	}
	statement := fmt.Sprintf("ALTER TABLE %s ON CLUSTER openrum_cluster DROP PARTITION ID '%s'",
		step.Table, step.PartitionID)
	if _, err := cleaner.database.ExecContext(ctx, statement); err != nil {
		return fmt.Errorf("drop %s partition %s: %w", step.Table, step.PartitionID, err)
	}
	return nil
}

func validEmergencyPartitionID(value string) bool {
	if len(value) != 32 || strings.Trim(value, "0123456789abcdef") != "" {
		return false
	}
	return true
}
