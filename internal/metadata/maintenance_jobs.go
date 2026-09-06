package metadata

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

const retentionPreviewTTL = 10 * time.Minute
const retentionClaimLock int64 = 764680621015

var (
	ErrInvalidRetentionPlan = errors.New("invalid retention plan")
	ErrInvalidPreviewToken  = errors.New("invalid or expired retention preview token")
	ErrNoRetentionChanges   = errors.New("retention plan has no historical changes")
)

type RetentionPlanStep struct {
	Table         string `json:"table"`
	TimeColumn    string `json:"timeColumn"`
	Month         int    `json:"month"`
	RetentionDays int    `json:"retentionDays"`
	AffectedRows  uint64 `json:"affectedRows"`
	DeleteRows    uint64 `json:"deleteRows"`
}

type RetentionPlan struct {
	ProjectID     uuid.UUID           `json:"projectId"`
	RawDays       int                 `json:"rawDays"`
	AggregateDays int                 `json:"aggregateDays"`
	AffectedRows  uint64              `json:"affectedRows"`
	DeleteRows    uint64              `json:"deleteRows"`
	Steps         []RetentionPlanStep `json:"steps"`
}

type RetentionPreview struct {
	Token     string
	ExpiresAt time.Time
	Plan      RetentionPlan
}

type MaintenanceJob struct {
	ID             uuid.UUID
	Type           string
	Status         string
	ProjectID      uuid.UUID
	RequestedBy    *uuid.UUID
	RawDays        int
	AggregateDays  int
	AffectedRows   uint64
	DeleteRows     uint64
	TotalSteps     int
	CompletedSteps int
	Attempts       int
	LastError      string
	CreatedAt      time.Time
	UpdatedAt      time.Time
	StartedAt      *time.Time
	CompletedAt    *time.Time
}

type MaintenanceStep struct {
	ID            int64
	JobID         uuid.UUID
	ProjectID     uuid.UUID
	Table         string
	TimeColumn    string
	Month         int
	RetentionDays int
	Attempts      int
	DeadlineAt    time.Time
}

type MaintenanceJobRepository struct {
	database *sql.DB
	now      func() time.Time
}

func NewMaintenanceJobRepository(database *sql.DB) *MaintenanceJobRepository {
	return &MaintenanceJobRepository{database: database, now: time.Now}
}

func (repository *MaintenanceJobRepository) CreateRetentionPreview(
	ctx context.Context,
	actorID uuid.UUID,
	plan RetentionPlan,
) (RetentionPreview, error) {
	if err := validateRetentionPlan(plan); err != nil {
		return RetentionPreview{}, err
	}
	if len(plan.Steps) == 0 {
		return RetentionPreview{}, ErrNoRetentionChanges
	}
	buffer := make([]byte, 32)
	if _, err := rand.Read(buffer); err != nil {
		return RetentionPreview{}, fmt.Errorf("generate retention preview token: %w", err)
	}
	token := "orrp_" + base64.RawURLEncoding.EncodeToString(buffer)
	digest := sha256.Sum256([]byte(token))
	expiresAt := repository.now().UTC().Add(retentionPreviewTTL)
	encodedPlan, err := json.Marshal(plan.Steps)
	if err != nil {
		return RetentionPreview{}, err
	}
	_, err = repository.database.ExecContext(ctx, `INSERT INTO retention_change_previews
		(token_hash,requested_by,project_id,raw_days,aggregate_days,affected_rows,delete_rows,plan_json,expires_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, digest[:], actorID, plan.ProjectID, plan.RawDays,
		plan.AggregateDays, plan.AffectedRows, plan.DeleteRows, encodedPlan, expiresAt)
	if err != nil {
		return RetentionPreview{}, err
	}
	return RetentionPreview{Token: token, ExpiresAt: expiresAt, Plan: plan}, nil
}

func (repository *MaintenanceJobRepository) CreateRetentionJob(
	ctx context.Context,
	actorID uuid.UUID,
	token string,
) (MaintenanceJob, error) {
	if !strings.HasPrefix(token, "orrp_") || len(token) != 48 {
		return MaintenanceJob{}, ErrInvalidPreviewToken
	}
	digest := sha256.Sum256([]byte(token))
	transaction, err := repository.database.BeginTx(ctx, nil)
	if err != nil {
		return MaintenanceJob{}, err
	}
	defer func() { _ = transaction.Rollback() }()
	var plan RetentionPlan
	var encodedPlan []byte
	err = transaction.QueryRowContext(ctx, `SELECT project_id,raw_days,aggregate_days,affected_rows,delete_rows,plan_json
		FROM retention_change_previews
		WHERE token_hash=$1 AND requested_by=$2 AND consumed_at IS NULL AND expires_at>now()
		FOR UPDATE`, digest[:], actorID).Scan(&plan.ProjectID, &plan.RawDays, &plan.AggregateDays,
		&plan.AffectedRows, &plan.DeleteRows, &encodedPlan)
	if errors.Is(err, sql.ErrNoRows) {
		return MaintenanceJob{}, ErrInvalidPreviewToken
	}
	if err != nil {
		return MaintenanceJob{}, err
	}
	if err := json.Unmarshal(encodedPlan, &plan.Steps); err != nil || validateRetentionPlan(plan) != nil || len(plan.Steps) == 0 {
		return MaintenanceJob{}, ErrInvalidRetentionPlan
	}
	job := MaintenanceJob{
		ID: uuid.New(), Type: "retention_cleanup", Status: "queued", ProjectID: plan.ProjectID,
		RequestedBy: &actorID, RawDays: plan.RawDays, AggregateDays: plan.AggregateDays,
		AffectedRows: plan.AffectedRows, DeleteRows: plan.DeleteRows, TotalSteps: len(plan.Steps),
	}
	if _, err := transaction.ExecContext(ctx, `INSERT INTO maintenance_jobs
		(id,job_type,status,project_id,requested_by,raw_days,aggregate_days,affected_rows,delete_rows,total_steps)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, job.ID, job.Type, job.Status, job.ProjectID,
		actorID, job.RawDays, job.AggregateDays, job.AffectedRows, job.DeleteRows, job.TotalSteps); err != nil {
		return MaintenanceJob{}, err
	}
	for _, step := range plan.Steps {
		if _, err := transaction.ExecContext(ctx, `INSERT INTO maintenance_job_steps
			(job_id,table_name,time_column,month_key,retention_days,affected_rows,delete_rows)
			VALUES ($1,$2,$3,$4,$5,$6,$7)`, job.ID, step.Table, step.TimeColumn, step.Month,
			step.RetentionDays, step.AffectedRows, step.DeleteRows); err != nil {
			return MaintenanceJob{}, err
		}
	}
	if _, err := transaction.ExecContext(ctx, `INSERT INTO audit_logs
		(organization_id,actor_user_id,action,resource_type,resource_id,metadata)
		SELECT organization_id,$1,'instance.retention_cleanup_requested','maintenance_job',$2,
			jsonb_build_object('projectId',projects.id::text,'rawDays',$4::integer,'aggregateDays',$5::integer,
			'affectedRows',$6::bigint,'deleteRows',$7::bigint)
		FROM projects WHERE id=$3`, actorID, job.ID, job.ProjectID, job.RawDays, job.AggregateDays,
		job.AffectedRows, job.DeleteRows); err != nil {
		return MaintenanceJob{}, err
	}
	if result, err := transaction.ExecContext(ctx,
		"UPDATE retention_change_previews SET consumed_at=now() WHERE token_hash=$1 AND consumed_at IS NULL", digest[:],
	); err != nil {
		return MaintenanceJob{}, err
	} else if rows, rowsErr := result.RowsAffected(); rowsErr != nil || rows != 1 {
		return MaintenanceJob{}, ErrInvalidPreviewToken
	}
	if err := transaction.Commit(); err != nil {
		return MaintenanceJob{}, err
	}
	job.CreatedAt = repository.now().UTC()
	job.UpdatedAt = job.CreatedAt
	return job, nil
}

func (repository *MaintenanceJobRepository) List(ctx context.Context, limit int) ([]MaintenanceJob, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	rows, err := repository.database.QueryContext(ctx, `SELECT id,job_type,status,project_id,requested_by,
		raw_days,aggregate_days,affected_rows,delete_rows,total_steps,completed_steps,attempts,last_error,
		created_at,updated_at,started_at,completed_at FROM maintenance_jobs ORDER BY created_at DESC LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	jobs := make([]MaintenanceJob, 0)
	for rows.Next() {
		job, err := scanMaintenanceJob(rows)
		if err != nil {
			return nil, err
		}
		jobs = append(jobs, job)
	}
	return jobs, rows.Err()
}

func (repository *MaintenanceJobRepository) ClaimRetentionStep(ctx context.Context) (MaintenanceStep, bool, error) {
	transaction, err := repository.database.BeginTx(ctx, nil)
	if err != nil {
		return MaintenanceStep{}, false, err
	}
	defer func() { _ = transaction.Rollback() }()
	if _, err := transaction.ExecContext(ctx, "SELECT pg_advisory_xact_lock($1)", retentionClaimLock); err != nil {
		return MaintenanceStep{}, false, err
	}
	if _, err := transaction.ExecContext(ctx, `UPDATE maintenance_jobs SET status='failed',
		last_error='retention cleanup deadline exceeded',updated_at=now()
		WHERE job_type='retention_cleanup' AND status IN ('queued','running','retry') AND deadline_at<=now()`); err != nil {
		return MaintenanceStep{}, false, err
	}
	var step MaintenanceStep
	err = transaction.QueryRowContext(ctx, `WITH candidate AS (
		SELECT s.id FROM maintenance_job_steps s JOIN maintenance_jobs j ON j.id=s.job_id
		WHERE j.job_type='retention_cleanup' AND j.status IN ('queued','running','retry')
		  AND j.next_attempt_at<=now() AND j.deadline_at>now()
		  AND NOT EXISTS (SELECT 1 FROM maintenance_job_steps active
		    WHERE active.status='running' AND active.updated_at>=now()-interval '15 minutes')
		  AND NOT EXISTS (SELECT 1 FROM maintenance_job_steps recent
		    WHERE recent.status IN ('completed','retry','failed') AND recent.updated_at>now()-interval '5 seconds')
		  AND ((s.status IN ('queued','retry') AND s.next_attempt_at<=now())
		    OR (s.status='running' AND s.updated_at<now()-interval '15 minutes'))
		ORDER BY j.created_at,s.id FOR UPDATE OF s SKIP LOCKED LIMIT 1
	)
	UPDATE maintenance_job_steps s SET status='running',attempts=s.attempts+1,
		started_at=COALESCE(s.started_at,now()),updated_at=now()
	FROM candidate,maintenance_jobs j
	WHERE s.id=candidate.id AND j.id=s.job_id
	RETURNING s.id,s.job_id,j.project_id,s.table_name,s.time_column,s.month_key,
		s.retention_days,s.attempts,j.deadline_at`).Scan(&step.ID, &step.JobID, &step.ProjectID, &step.Table,
		&step.TimeColumn, &step.Month, &step.RetentionDays, &step.Attempts, &step.DeadlineAt)
	if errors.Is(err, sql.ErrNoRows) {
		return MaintenanceStep{}, false, nil
	}
	if err != nil {
		return MaintenanceStep{}, false, err
	}
	if _, err := transaction.ExecContext(ctx, `UPDATE maintenance_jobs SET status='running',attempts=attempts+1,
		started_at=COALESCE(started_at,now()),updated_at=now() WHERE id=$1`, step.JobID); err != nil {
		return MaintenanceStep{}, false, err
	}
	if err := transaction.Commit(); err != nil {
		return MaintenanceStep{}, false, err
	}
	return step, true, nil
}

func (repository *MaintenanceJobRepository) CompleteRetentionStep(ctx context.Context, step MaintenanceStep) error {
	transaction, err := repository.database.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = transaction.Rollback() }()
	result, err := transaction.ExecContext(ctx, `UPDATE maintenance_job_steps SET status='completed',last_error='',
		completed_at=now(),updated_at=now() WHERE id=$1 AND job_id=$2 AND status='running'`, step.ID, step.JobID)
	if err != nil {
		return err
	}
	if rows, err := result.RowsAffected(); err != nil || rows != 1 {
		return fmt.Errorf("retention step is no longer running")
	}
	var status string
	var projectID uuid.UUID
	var requestedBy uuid.NullUUID
	if err := transaction.QueryRowContext(ctx, `UPDATE maintenance_jobs j SET
		completed_steps=(SELECT count(*) FROM maintenance_job_steps WHERE job_id=j.id AND status='completed'),
		status=CASE WHEN NOT EXISTS (SELECT 1 FROM maintenance_job_steps WHERE job_id=j.id AND status<>'completed') THEN 'completed' ELSE 'queued' END,
		completed_at=CASE WHEN NOT EXISTS (SELECT 1 FROM maintenance_job_steps WHERE job_id=j.id AND status<>'completed') THEN now() ELSE NULL END,
		next_attempt_at=now()+interval '5 seconds',last_error='',updated_at=now() WHERE j.id=$1
		RETURNING status,project_id,requested_by`, step.JobID).Scan(&status, &projectID, &requestedBy); err != nil {
		return err
	}
	if status == "completed" {
		if _, err := transaction.ExecContext(ctx, `INSERT INTO audit_logs
			(organization_id,actor_user_id,action,resource_type,resource_id,metadata)
			SELECT organization_id,$1,'instance.retention_cleanup_completed','maintenance_job',$2,
				jsonb_build_object('projectId',projects.id::text)
			FROM projects WHERE id=$3`, requestedBy, step.JobID, projectID); err != nil {
			return err
		}
	}
	return transaction.Commit()
}

func (repository *MaintenanceJobRepository) RetryRetentionStep(ctx context.Context, step MaintenanceStep, cause error) error {
	message := strings.TrimSpace(cause.Error())
	if len(message) > 512 {
		message = message[:512]
	}
	transaction, err := repository.database.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = transaction.Rollback() }()
	terminal := step.Attempts >= 8 || !repository.now().UTC().Before(step.DeadlineAt)
	status := "retry"
	if terminal {
		status = "failed"
	}
	if _, err := transaction.ExecContext(ctx, `UPDATE maintenance_job_steps SET status=$1,last_error=$2,
		next_attempt_at=now()+(LEAST(300,power(2,LEAST(attempts,8)))::text||' seconds')::interval,updated_at=now()
		WHERE id=$3 AND job_id=$4 AND status='running'`, status, message, step.ID, step.JobID); err != nil {
		return err
	}
	if _, err := transaction.ExecContext(ctx, `UPDATE maintenance_jobs SET status=$1,last_error=$2,
		next_attempt_at=now()+(LEAST(300,power(2,LEAST(attempts,8)))::text||' seconds')::interval,updated_at=now()
		WHERE id=$3`, status, message, step.JobID); err != nil {
		return err
	}
	return transaction.Commit()
}

type maintenanceJobScanner interface{ Scan(...any) error }

func scanMaintenanceJob(scanner maintenanceJobScanner) (MaintenanceJob, error) {
	var job MaintenanceJob
	var requestedBy uuid.NullUUID
	var startedAt, completedAt sql.NullTime
	err := scanner.Scan(&job.ID, &job.Type, &job.Status, &job.ProjectID, &requestedBy, &job.RawDays,
		&job.AggregateDays, &job.AffectedRows, &job.DeleteRows, &job.TotalSteps, &job.CompletedSteps,
		&job.Attempts, &job.LastError, &job.CreatedAt, &job.UpdatedAt, &startedAt, &completedAt)
	if requestedBy.Valid {
		job.RequestedBy = &requestedBy.UUID
	}
	if startedAt.Valid {
		value := startedAt.Time.UTC()
		job.StartedAt = &value
	}
	if completedAt.Valid {
		value := completedAt.Time.UTC()
		job.CompletedAt = &value
	}
	job.CreatedAt, job.UpdatedAt = job.CreatedAt.UTC(), job.UpdatedAt.UTC()
	return job, err
}

func validateRetentionPlan(plan RetentionPlan) error {
	if plan.ProjectID == uuid.Nil || plan.RawDays < 1 || plan.RawDays > 90 ||
		plan.AggregateDays < 1 || plan.AggregateDays > 730 {
		return ErrInvalidRetentionPlan
	}
	var affected, deleted uint64
	seen := make(map[string]struct{}, len(plan.Steps))
	for _, step := range plan.Steps {
		key := fmt.Sprintf("%s:%d", step.Table, step.Month)
		if step.Table == "" || step.TimeColumn == "" || step.Month < 200001 || step.Month > 999912 ||
			step.RetentionDays < 1 || step.RetentionDays > 730 || step.AffectedRows == 0 ||
			step.DeleteRows > step.AffectedRows {
			return ErrInvalidRetentionPlan
		}
		if _, exists := seen[key]; exists {
			return ErrInvalidRetentionPlan
		}
		seen[key] = struct{}{}
		affected += step.AffectedRows
		deleted += step.DeleteRows
	}
	if affected != plan.AffectedRows || deleted != plan.DeleteRows {
		return ErrInvalidRetentionPlan
	}
	return nil
}
