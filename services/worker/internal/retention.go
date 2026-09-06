package internal

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"openrum/internal/metadata"
)

type RetentionJobStore interface {
	ClaimRetentionStep(context.Context) (metadata.MaintenanceStep, bool, error)
	CompleteRetentionStep(context.Context, metadata.MaintenanceStep) error
	RetryRetentionStep(context.Context, metadata.MaintenanceStep, error) error
}

type RetentionStepCleaner interface {
	Apply(context.Context, metadata.MaintenanceStep) error
}

type RetentionCleanupJob struct {
	store   RetentionJobStore
	cleaner RetentionStepCleaner
}

func NewRetentionCleanupJob(store RetentionJobStore, cleaner RetentionStepCleaner) *RetentionCleanupJob {
	return &RetentionCleanupJob{store: store, cleaner: cleaner}
}

func (job *RetentionCleanupJob) RunOne(ctx context.Context) (bool, error) {
	step, found, err := job.store.ClaimRetentionStep(ctx)
	if err != nil || !found {
		return false, err
	}
	if err := job.cleaner.Apply(ctx, step); err != nil {
		return true, errors.Join(err, job.store.RetryRetentionStep(ctx, step, err))
	}
	if err := job.store.CompleteRetentionStep(ctx, step); err != nil {
		return true, errors.Join(err, job.store.RetryRetentionStep(ctx, step, err))
	}
	return true, nil
}

type ClickHouseRetentionCleaner struct {
	database *sql.DB
	now      func() time.Time
}

func NewClickHouseRetentionCleaner(database *sql.DB) *ClickHouseRetentionCleaner {
	return &ClickHouseRetentionCleaner{database: database, now: time.Now}
}

type retentionMutationDefinition struct {
	timeColumn    string
	expiryColumn  string
	maximumDays   int
	bucketSeconds int
}

var retentionMutationTables = map[string]retentionMutationDefinition{
	"rum_events_local":          {timeColumn: "timestamp", expiryColumn: "raw_expires_at", maximumDays: 90},
	"project_metrics_1m_local":  {timeColumn: "bucket", expiryColumn: "aggregate_expires_at", maximumDays: 730, bucketSeconds: 60},
	"api_metrics_1m_local":      {timeColumn: "bucket", expiryColumn: "aggregate_expires_at", maximumDays: 730, bucketSeconds: 60},
	"issue_metrics_5m_local":    {timeColumn: "bucket", expiryColumn: "aggregate_expires_at", maximumDays: 730, bucketSeconds: 300},
	"behavior_metrics_1m_local": {timeColumn: "bucket", expiryColumn: "aggregate_expires_at", maximumDays: 730, bucketSeconds: 60},
}

func (cleaner *ClickHouseRetentionCleaner) Apply(ctx context.Context, step metadata.MaintenanceStep) error {
	definition, ok := retentionMutationTables[step.Table]
	if !ok || step.TimeColumn != definition.timeColumn || step.RetentionDays < 1 ||
		step.RetentionDays > definition.maximumDays {
		return fmt.Errorf("unsupported retention cleanup step")
	}
	year, month := step.Month/100, step.Month%100
	if year < 2000 || month < 1 || month > 12 {
		return fmt.Errorf("invalid retention cleanup month")
	}
	from := time.Date(year, time.Month(month), 1, 0, 0, 0, 0, time.UTC)
	to := from.AddDate(0, 1, 0)
	cutoff := cleaner.now().UTC()
	baseExpiry := fmt.Sprintf("toDateTime64(%s,3,'UTC') + toIntervalDay(?)", definition.timeColumn)
	targetExpiry := baseExpiry + fmt.Sprintf(" + toIntervalSecond(%d)", definition.bucketSeconds)
	deleteStatement := fmt.Sprintf(`ALTER TABLE %s ON CLUSTER openrum_cluster DELETE WHERE
		project_id=? AND %s>=? AND %s<? AND %s<=? SETTINGS mutations_sync=2`,
		step.Table, definition.timeColumn, definition.timeColumn, targetExpiry)
	if _, err := cleaner.database.ExecContext(ctx, deleteStatement, step.ProjectID, from, to, step.RetentionDays, cutoff); err != nil {
		return fmt.Errorf("delete expired rows from %s month %d: %w", step.Table, step.Month, err)
	}
	updateStatement := fmt.Sprintf(`ALTER TABLE %s ON CLUSTER openrum_cluster UPDATE %s=%s WHERE
		project_id=? AND %s>=? AND %s<? AND %s>? AND (%s<%s OR %s>%s) SETTINGS mutations_sync=2`,
		step.Table, definition.expiryColumn, targetExpiry, definition.timeColumn, definition.timeColumn,
		targetExpiry, definition.expiryColumn, baseExpiry, definition.expiryColumn, targetExpiry)
	if _, err := cleaner.database.ExecContext(ctx, updateStatement,
		step.RetentionDays, step.ProjectID, from, to, step.RetentionDays, cutoff,
		step.RetentionDays, step.RetentionDays); err != nil {
		return fmt.Errorf("update retained rows in %s month %d: %w", step.Table, step.Month, err)
	}
	return nil
}
