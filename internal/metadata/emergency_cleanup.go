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

const emergencyCleanupPreviewTTL = 10 * time.Minute
const emergencyCleanupClaimLock int64 = 764680621016

var (
	ErrInvalidEmergencyCleanupPlan = errors.New("invalid emergency cleanup plan")
	ErrInvalidEmergencyPreview     = errors.New("invalid or expired emergency cleanup preview")
	ErrEmergencyCleanupRunning     = errors.New("an emergency cleanup job is already running")
)

var emergencyCleanupTables = map[string]struct{}{
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

type EmergencyCleanupStep struct {
	ProjectID      uuid.UUID `json:"projectId"`
	ProjectName    string    `json:"projectName"`
	Table          string    `json:"table"`
	Month          int       `json:"month"`
	PartitionID    string    `json:"partitionId"`
	AffectedRows   uint64    `json:"affectedRows"`
	EstimatedBytes uint64    `json:"estimatedBytes"`
	OldestAt       time.Time `json:"oldestAt"`
	NewestAt       time.Time `json:"newestAt"`
}

type EmergencyCleanupPlan struct {
	UsedBytes             uint64
	CapacityBytes         uint64
	EstimatedReleaseBytes uint64
	ProjectedUsedBytes    uint64
	TargetUsedPercent     int
	ProtectedAfter        time.Time
	CanReachTarget        bool
	Steps                 []EmergencyCleanupStep
}

type EmergencyCleanupPreview struct {
	Token     string
	ExpiresAt time.Time
	Plan      EmergencyCleanupPlan
}

type EmergencyCleanupJob struct {
	ID                    uuid.UUID
	Status                string
	RequestedBy           *uuid.UUID
	UsedBytesBefore       uint64
	CapacityBytes         uint64
	EstimatedReleaseBytes uint64
	TargetUsedPercent     int
	ProtectedAfter        time.Time
	CanReachTarget        bool
	TotalSteps            int
	CompletedSteps        int
	Attempts              int
	LastError             string
	CreatedAt             time.Time
	UpdatedAt             time.Time
	StartedAt             *time.Time
	CompletedAt           *time.Time
}

type EmergencyCleanupJobStep struct {
	ID             int64
	JobID          uuid.UUID
	ProjectID      uuid.UUID
	ProjectName    string
	Table          string
	Month          int
	PartitionID    string
	AffectedRows   uint64
	EstimatedBytes uint64
	Attempts       int
	DeadlineAt     time.Time
}

type EmergencyCleanupRepository struct {
	database *sql.DB
	now      func() time.Time
}

func NewEmergencyCleanupRepository(database *sql.DB) *EmergencyCleanupRepository {
	return &EmergencyCleanupRepository{database: database, now: time.Now}
}

func (repository *EmergencyCleanupRepository) CreatePreview(
	ctx context.Context,
	actorID uuid.UUID,
	plan EmergencyCleanupPlan,
) (EmergencyCleanupPreview, error) {
	if err := validateEmergencyCleanupPlan(plan); err != nil {
		return EmergencyCleanupPreview{}, err
	}
	buffer := make([]byte, 32)
	if _, err := rand.Read(buffer); err != nil {
		return EmergencyCleanupPreview{}, fmt.Errorf("generate emergency cleanup preview token: %w", err)
	}
	token := "orec_" + base64.RawURLEncoding.EncodeToString(buffer)
	digest := sha256.Sum256([]byte(token))
	expiresAt := repository.now().UTC().Add(emergencyCleanupPreviewTTL)
	encodedPlan, err := json.Marshal(plan.Steps)
	if err != nil {
		return EmergencyCleanupPreview{}, err
	}
	_, err = repository.database.ExecContext(ctx, `INSERT INTO emergency_cleanup_previews
		(token_hash,requested_by,used_bytes,capacity_bytes,estimated_release_bytes,projected_used_bytes,
		target_used_percent,protected_after,can_reach_target,plan_json,expires_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, digest[:], actorID, plan.UsedBytes,
		plan.CapacityBytes, plan.EstimatedReleaseBytes, plan.ProjectedUsedBytes, plan.TargetUsedPercent,
		plan.ProtectedAfter, plan.CanReachTarget, encodedPlan, expiresAt)
	if err != nil {
		return EmergencyCleanupPreview{}, err
	}
	return EmergencyCleanupPreview{Token: token, ExpiresAt: expiresAt, Plan: plan}, nil
}

func (repository *EmergencyCleanupRepository) CreateJob(
	ctx context.Context,
	actorID uuid.UUID,
	token string,
) (EmergencyCleanupJob, error) {
	if !strings.HasPrefix(token, "orec_") || len(token) != 48 {
		return EmergencyCleanupJob{}, ErrInvalidEmergencyPreview
	}
	digest := sha256.Sum256([]byte(token))
	transaction, err := repository.database.BeginTx(ctx, nil)
	if err != nil {
		return EmergencyCleanupJob{}, err
	}
	defer func() { _ = transaction.Rollback() }()
	if _, err := transaction.ExecContext(ctx, "SELECT pg_advisory_xact_lock($1)", emergencyCleanupClaimLock); err != nil {
		return EmergencyCleanupJob{}, err
	}
	var active bool
	if err := transaction.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM emergency_cleanup_jobs
		WHERE status IN ('queued','running','retry'))`).Scan(&active); err != nil {
		return EmergencyCleanupJob{}, err
	}
	if active {
		return EmergencyCleanupJob{}, ErrEmergencyCleanupRunning
	}
	var plan EmergencyCleanupPlan
	var encodedPlan []byte
	err = transaction.QueryRowContext(ctx, `SELECT used_bytes,capacity_bytes,estimated_release_bytes,
		projected_used_bytes,target_used_percent,protected_after,can_reach_target,plan_json
		FROM emergency_cleanup_previews
		WHERE token_hash=$1 AND requested_by=$2 AND consumed_at IS NULL AND expires_at>now()
		FOR UPDATE`, digest[:], actorID).Scan(&plan.UsedBytes, &plan.CapacityBytes,
		&plan.EstimatedReleaseBytes, &plan.ProjectedUsedBytes, &plan.TargetUsedPercent,
		&plan.ProtectedAfter, &plan.CanReachTarget, &encodedPlan)
	if errors.Is(err, sql.ErrNoRows) {
		return EmergencyCleanupJob{}, ErrInvalidEmergencyPreview
	}
	if err != nil {
		return EmergencyCleanupJob{}, err
	}
	if err := json.Unmarshal(encodedPlan, &plan.Steps); err != nil || validateEmergencyCleanupPlan(plan) != nil {
		return EmergencyCleanupJob{}, ErrInvalidEmergencyCleanupPlan
	}
	job := EmergencyCleanupJob{
		ID: uuid.New(), Status: "queued", RequestedBy: &actorID, UsedBytesBefore: plan.UsedBytes,
		CapacityBytes: plan.CapacityBytes, EstimatedReleaseBytes: plan.EstimatedReleaseBytes,
		TargetUsedPercent: plan.TargetUsedPercent, ProtectedAfter: plan.ProtectedAfter,
		CanReachTarget: plan.CanReachTarget, TotalSteps: len(plan.Steps),
	}
	if _, err := transaction.ExecContext(ctx, `INSERT INTO emergency_cleanup_jobs
		(id,status,requested_by,used_bytes_before,capacity_bytes,estimated_release_bytes,
		target_used_percent,protected_after,can_reach_target,total_steps)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, job.ID, job.Status, actorID,
		job.UsedBytesBefore, job.CapacityBytes, job.EstimatedReleaseBytes, job.TargetUsedPercent,
		job.ProtectedAfter, job.CanReachTarget, job.TotalSteps); err != nil {
		return EmergencyCleanupJob{}, err
	}
	for _, step := range plan.Steps {
		if _, err := transaction.ExecContext(ctx, `INSERT INTO emergency_cleanup_job_steps
			(job_id,project_id,project_name,table_name,month_key,partition_id,affected_rows,estimated_bytes)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, job.ID, step.ProjectID, step.ProjectName,
			step.Table, step.Month, step.PartitionID, step.AffectedRows, step.EstimatedBytes); err != nil {
			return EmergencyCleanupJob{}, err
		}
	}
	if _, err := transaction.ExecContext(ctx, `INSERT INTO audit_logs
		(organization_id,actor_user_id,action,resource_type,resource_id,metadata)
		SELECT DISTINCT projects.organization_id,$1::uuid,'instance.emergency_cleanup_requested','maintenance_job',$2::uuid,
			jsonb_build_object('projectId',projects.id::text,'estimatedReleaseBytes',$3::bigint,
			'targetUsedPercent',$4::integer)
		FROM emergency_cleanup_job_steps steps JOIN projects ON projects.id=steps.project_id
		WHERE steps.job_id=$2::uuid`, actorID, job.ID, job.EstimatedReleaseBytes, job.TargetUsedPercent); err != nil {
		return EmergencyCleanupJob{}, fmt.Errorf("audit emergency cleanup request: %w", err)
	}
	result, err := transaction.ExecContext(ctx, `UPDATE emergency_cleanup_previews SET consumed_at=now()
		WHERE token_hash=$1 AND consumed_at IS NULL`, digest[:])
	if err != nil {
		return EmergencyCleanupJob{}, err
	}
	if rows, rowsErr := result.RowsAffected(); rowsErr != nil || rows != 1 {
		return EmergencyCleanupJob{}, ErrInvalidEmergencyPreview
	}
	if err := transaction.Commit(); err != nil {
		return EmergencyCleanupJob{}, err
	}
	job.CreatedAt = repository.now().UTC()
	job.UpdatedAt = job.CreatedAt
	return job, nil
}

func (repository *EmergencyCleanupRepository) Latest(ctx context.Context) (EmergencyCleanupJob, bool, error) {
	row := repository.database.QueryRowContext(ctx, `SELECT id,status,requested_by,used_bytes_before,
		capacity_bytes,estimated_release_bytes,target_used_percent,protected_after,can_reach_target,
		total_steps,completed_steps,attempts,last_error,created_at,updated_at,started_at,completed_at
		FROM emergency_cleanup_jobs ORDER BY created_at DESC LIMIT 1`)
	job, err := scanEmergencyCleanupJob(row)
	if errors.Is(err, sql.ErrNoRows) {
		return EmergencyCleanupJob{}, false, nil
	}
	return job, err == nil, err
}

func (repository *EmergencyCleanupRepository) ClaimStep(ctx context.Context) (EmergencyCleanupJobStep, bool, error) {
	transaction, err := repository.database.BeginTx(ctx, nil)
	if err != nil {
		return EmergencyCleanupJobStep{}, false, err
	}
	defer func() { _ = transaction.Rollback() }()
	if _, err := transaction.ExecContext(ctx, "SELECT pg_advisory_xact_lock($1)", emergencyCleanupClaimLock); err != nil {
		return EmergencyCleanupJobStep{}, false, err
	}
	if _, err := transaction.ExecContext(ctx, `UPDATE emergency_cleanup_jobs SET status='failed',
		last_error='emergency cleanup deadline exceeded',updated_at=now()
		WHERE status IN ('queued','running','retry') AND deadline_at<=now()`); err != nil {
		return EmergencyCleanupJobStep{}, false, err
	}
	var step EmergencyCleanupJobStep
	err = transaction.QueryRowContext(ctx, `WITH candidate AS (
		SELECT steps.id FROM emergency_cleanup_job_steps steps
		JOIN emergency_cleanup_jobs jobs ON jobs.id=steps.job_id
		WHERE jobs.status IN ('queued','running','retry') AND jobs.next_attempt_at<=now()
		  AND jobs.deadline_at>now()
		  AND ((steps.status IN ('queued','retry') AND steps.next_attempt_at<=now())
		    OR (steps.status='running' AND steps.updated_at<now()-interval '10 minutes'))
		ORDER BY steps.month_key,steps.project_id,steps.id
		FOR UPDATE OF steps SKIP LOCKED LIMIT 1
	)
	UPDATE emergency_cleanup_job_steps steps SET status='running',attempts=steps.attempts+1,
		started_at=COALESCE(steps.started_at,now()),updated_at=now()
	FROM candidate,emergency_cleanup_jobs jobs
	WHERE steps.id=candidate.id AND jobs.id=steps.job_id
	RETURNING steps.id,steps.job_id,steps.project_id,steps.project_name,steps.table_name,
		steps.month_key,steps.partition_id,steps.affected_rows,steps.estimated_bytes,
		steps.attempts,jobs.deadline_at`).Scan(&step.ID, &step.JobID, &step.ProjectID,
		&step.ProjectName, &step.Table, &step.Month, &step.PartitionID, &step.AffectedRows,
		&step.EstimatedBytes, &step.Attempts, &step.DeadlineAt)
	if errors.Is(err, sql.ErrNoRows) {
		return EmergencyCleanupJobStep{}, false, nil
	}
	if err != nil {
		return EmergencyCleanupJobStep{}, false, err
	}
	if _, err := transaction.ExecContext(ctx, `UPDATE emergency_cleanup_jobs SET status='running',
		attempts=attempts+1,started_at=COALESCE(started_at,now()),updated_at=now() WHERE id=$1`,
		step.JobID); err != nil {
		return EmergencyCleanupJobStep{}, false, err
	}
	if err := transaction.Commit(); err != nil {
		return EmergencyCleanupJobStep{}, false, err
	}
	return step, true, nil
}

func (repository *EmergencyCleanupRepository) CompleteStep(ctx context.Context, step EmergencyCleanupJobStep) error {
	transaction, err := repository.database.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = transaction.Rollback() }()
	result, err := transaction.ExecContext(ctx, `UPDATE emergency_cleanup_job_steps SET status='completed',
		last_error='',completed_at=now(),updated_at=now() WHERE id=$1 AND job_id=$2 AND status='running'`,
		step.ID, step.JobID)
	if err != nil {
		return err
	}
	if rows, rowsErr := result.RowsAffected(); rowsErr != nil || rows != 1 {
		return fmt.Errorf("emergency cleanup step is no longer running")
	}
	var status string
	var requestedBy uuid.NullUUID
	if err := transaction.QueryRowContext(ctx, `UPDATE emergency_cleanup_jobs jobs SET
		completed_steps=(SELECT count(*) FROM emergency_cleanup_job_steps WHERE job_id=jobs.id AND status='completed'),
		status=CASE WHEN NOT EXISTS (SELECT 1 FROM emergency_cleanup_job_steps WHERE job_id=jobs.id AND status<>'completed') THEN 'completed' ELSE 'queued' END,
		completed_at=CASE WHEN NOT EXISTS (SELECT 1 FROM emergency_cleanup_job_steps WHERE job_id=jobs.id AND status<>'completed') THEN now() ELSE NULL END,
		next_attempt_at=now(),last_error='',updated_at=now() WHERE jobs.id=$1
		RETURNING status,requested_by`, step.JobID).Scan(&status, &requestedBy); err != nil {
		return err
	}
	if status == "completed" {
		if _, err := transaction.ExecContext(ctx, `INSERT INTO audit_logs
			(organization_id,actor_user_id,action,resource_type,resource_id,metadata)
			SELECT DISTINCT projects.organization_id,$1::uuid,'instance.emergency_cleanup_completed','maintenance_job',$2::uuid,
				jsonb_build_object('projectId',projects.id::text)
			FROM emergency_cleanup_job_steps steps JOIN projects ON projects.id=steps.project_id
			WHERE steps.job_id=$2::uuid`, requestedBy, step.JobID); err != nil {
			return fmt.Errorf("audit emergency cleanup completion: %w", err)
		}
	}
	return transaction.Commit()
}

func (repository *EmergencyCleanupRepository) RetryStep(ctx context.Context, step EmergencyCleanupJobStep, cause error) error {
	message := strings.TrimSpace(cause.Error())
	if len(message) > 512 {
		message = message[:512]
	}
	transaction, err := repository.database.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = transaction.Rollback() }()
	terminal := step.Attempts >= 5 || !repository.now().UTC().Before(step.DeadlineAt)
	status := "retry"
	if terminal {
		status = "failed"
	}
	if _, err := transaction.ExecContext(ctx, `UPDATE emergency_cleanup_job_steps SET status=$1,
		last_error=$2,next_attempt_at=now()+(LEAST(60,power(2,LEAST(attempts,6)))::text||' seconds')::interval,
		updated_at=now() WHERE id=$3 AND job_id=$4 AND status='running'`, status, message, step.ID,
		step.JobID); err != nil {
		return err
	}
	if _, err := transaction.ExecContext(ctx, `UPDATE emergency_cleanup_jobs SET status=$1,last_error=$2,
		next_attempt_at=now()+(LEAST(60,power(2,LEAST(attempts,6)))::text||' seconds')::interval,
		updated_at=now() WHERE id=$3`, status, message, step.JobID); err != nil {
		return err
	}
	return transaction.Commit()
}

func scanEmergencyCleanupJob(scanner maintenanceJobScanner) (EmergencyCleanupJob, error) {
	var job EmergencyCleanupJob
	var requestedBy uuid.NullUUID
	var startedAt, completedAt sql.NullTime
	err := scanner.Scan(&job.ID, &job.Status, &requestedBy, &job.UsedBytesBefore,
		&job.CapacityBytes, &job.EstimatedReleaseBytes, &job.TargetUsedPercent,
		&job.ProtectedAfter, &job.CanReachTarget, &job.TotalSteps, &job.CompletedSteps,
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
	job.CreatedAt = job.CreatedAt.UTC()
	job.UpdatedAt = job.UpdatedAt.UTC()
	job.ProtectedAfter = job.ProtectedAfter.UTC()
	return job, err
}

func validateEmergencyCleanupPlan(plan EmergencyCleanupPlan) error {
	if plan.CapacityBytes == 0 || plan.UsedBytes > plan.CapacityBytes || plan.TargetUsedPercent != 85 ||
		plan.ProtectedAfter.IsZero() || len(plan.Steps) == 0 || plan.EstimatedReleaseBytes == 0 ||
		plan.ProjectedUsedBytes > plan.UsedBytes {
		return ErrInvalidEmergencyCleanupPlan
	}
	seen := make(map[string]struct{}, len(plan.Steps))
	var estimated uint64
	for _, step := range plan.Steps {
		_, supported := emergencyCleanupTables[step.Table]
		monthEnd, validMonth := emergencyCleanupMonthEnd(step.Month)
		key := step.Table + ":" + step.PartitionID
		if !supported || step.ProjectID == uuid.Nil || strings.TrimSpace(step.ProjectName) == "" ||
			!validMonth || monthEnd.After(plan.ProtectedAfter) || len(step.PartitionID) != 32 ||
			step.EstimatedBytes == 0 || step.OldestAt.IsZero() || step.NewestAt.IsZero() ||
			step.NewestAt.After(plan.ProtectedAfter) {
			return ErrInvalidEmergencyCleanupPlan
		}
		for _, character := range step.PartitionID {
			if (character < '0' || character > '9') && (character < 'a' || character > 'f') {
				return ErrInvalidEmergencyCleanupPlan
			}
		}
		if _, exists := seen[key]; exists {
			return ErrInvalidEmergencyCleanupPlan
		}
		seen[key] = struct{}{}
		estimated += step.EstimatedBytes
	}
	if estimated != plan.EstimatedReleaseBytes || plan.ProjectedUsedBytes != plan.UsedBytes-min(plan.UsedBytes, estimated) {
		return ErrInvalidEmergencyCleanupPlan
	}
	targetBytes := uint64(float64(plan.CapacityBytes) * float64(plan.TargetUsedPercent) / 100)
	if plan.CanReachTarget != (plan.ProjectedUsedBytes <= targetBytes) {
		return ErrInvalidEmergencyCleanupPlan
	}
	return nil
}

func emergencyCleanupMonthEnd(monthKey int) (time.Time, bool) {
	year, month := monthKey/100, time.Month(monthKey%100)
	if year < 2000 || month < time.January || month > time.December {
		return time.Time{}, false
	}
	return time.Date(year, month, 1, 0, 0, 0, 0, time.UTC).AddDate(0, 1, 0), true
}
