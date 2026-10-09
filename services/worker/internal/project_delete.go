package internal

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"openrum/internal/sourcemap"
)

var projectAnalyticsTables = []string{
	"event_stack_mappings_local",
	"behavior_metrics_1m_local",
	"usage_metrics_1h_local",
	"usage_records_local",
	"api_metrics_1m_local",
	"issue_metrics_5m_local",
	"project_metrics_1m_local",
	"rum_events_local",
}

type ProjectDeletion struct {
	ProjectID      uuid.UUID
	OrganizationID uuid.UUID
	RequestedBy    uuid.NullUUID
	Attempts       int
	DeadlineAt     time.Time
	OSSKeys        []string
}

type ProjectDeletionStore interface {
	Claim(context.Context) (ProjectDeletion, bool, error)
	ResetEmpty(context.Context, ProjectDeletion) error
	ConfirmEmpty(context.Context, ProjectDeletion) (bool, error)
	Retry(context.Context, ProjectDeletion, error) error
	Complete(context.Context, ProjectDeletion) error
}

type ProjectAnalyticsDeleter interface {
	DeleteProject(context.Context, uuid.UUID) error
	CountProject(context.Context, uuid.UUID) (uint64, error)
}

type ObjectDeleter interface {
	Delete(context.Context, string) error
}

type ProjectDeletionJob struct {
	store     ProjectDeletionStore
	analytics ProjectAnalyticsDeleter
	objects   ObjectDeleter
}

func NewProjectDeletionJob(store ProjectDeletionStore, analytics ProjectAnalyticsDeleter, objects ObjectDeleter) *ProjectDeletionJob {
	return &ProjectDeletionJob{store: store, analytics: analytics, objects: objects}
}

func (job *ProjectDeletionJob) RunOne(ctx context.Context) (bool, error) {
	deletion, found, err := job.store.Claim(ctx)
	if err != nil || !found {
		return false, err
	}
	before, err := job.analytics.CountProject(ctx, deletion.ProjectID)
	if err != nil {
		return true, errors.Join(err, job.store.Retry(ctx, deletion, err))
	}
	if before > 0 {
		if err := job.store.ResetEmpty(ctx, deletion); err != nil {
			return true, errors.Join(err, job.store.Retry(ctx, deletion, err))
		}
	}
	if err := job.analytics.DeleteProject(ctx, deletion.ProjectID); err != nil {
		return true, errors.Join(err, job.store.Retry(ctx, deletion, err))
	}
	confirmed, err := job.store.ConfirmEmpty(ctx, deletion)
	if err != nil {
		return true, errors.Join(err, job.store.Retry(ctx, deletion, err))
	}
	if !confirmed {
		return true, nil
	}
	remaining, err := job.analytics.CountProject(ctx, deletion.ProjectID)
	if err != nil || remaining != 0 {
		if err == nil {
			err = fmt.Errorf("analytics deletion left %d queryable rows", remaining)
		}
		return true, errors.Join(err, job.store.Retry(ctx, deletion, err))
	}
	if len(deletion.OSSKeys) > 0 && job.objects == nil {
		err := errors.New("object storage is disabled while project artifacts still exist")
		return true, errors.Join(err, job.store.Retry(ctx, deletion, err))
	}
	for _, key := range deletion.OSSKeys {
		err := job.objects.Delete(ctx, key)
		// A credential without delete permission (403) can never succeed on retry;
		// finishing the job and leaving the object in the bucket beats failing the
		// whole deletion at its deadline. The Console warns that objects remain.
		if err != nil && !sourcemap.IsForbidden(err) && !sourcemap.IsObjectNotFound(err) {
			return true, errors.Join(err, job.store.Retry(ctx, deletion, err))
		}
	}
	if err := job.store.Complete(ctx, deletion); err != nil {
		return true, errors.Join(err, job.store.Retry(ctx, deletion, err))
	}
	return true, nil
}

type PostgresProjectDeletionStore struct {
	database          *sql.DB
	confirmationDelay time.Duration
}

func NewPostgresProjectDeletionStore(database *sql.DB) *PostgresProjectDeletionStore {
	return &PostgresProjectDeletionStore{database: database, confirmationDelay: time.Minute}
}

func (store *PostgresProjectDeletionStore) Claim(ctx context.Context) (ProjectDeletion, bool, error) {
	transaction, err := store.database.BeginTx(ctx, nil)
	if err != nil {
		return ProjectDeletion{}, false, err
	}
	defer func() { _ = transaction.Rollback() }()
	if _, err := transaction.ExecContext(ctx, `UPDATE project_deletions SET status='failed',last_error='deletion deadline exceeded',updated_at=now()
		WHERE status IN ('queued','retry','running','verifying') AND deadline_at<=now()`); err != nil {
		return ProjectDeletion{}, false, err
	}
	var deletion ProjectDeletion
	err = transaction.QueryRowContext(ctx, `WITH candidate AS (
		SELECT project_id FROM project_deletions
		WHERE ((status IN ('queued','retry','verifying') AND next_attempt_at<=now())
		   OR (status='running' AND updated_at<now()-interval '15 minutes'))
		  AND deadline_at>now()
		ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
	)
	UPDATE project_deletions d SET status='running',attempts=d.attempts+1,updated_at=now()
	FROM candidate WHERE d.project_id=candidate.project_id
	RETURNING d.project_id,d.organization_id,d.requested_by,d.attempts,d.deadline_at`).Scan(
		&deletion.ProjectID, &deletion.OrganizationID, &deletion.RequestedBy, &deletion.Attempts, &deletion.DeadlineAt)
	if errors.Is(err, sql.ErrNoRows) {
		return ProjectDeletion{}, false, nil
	}
	if err != nil {
		return ProjectDeletion{}, false, err
	}
	rows, err := transaction.QueryContext(ctx, `SELECT a.oss_key FROM sourcemap_artifacts a
		JOIN releases r ON r.id=a.release_id WHERE r.project_id=$1 ORDER BY a.oss_key`, deletion.ProjectID)
	if err != nil {
		return ProjectDeletion{}, false, err
	}
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			_ = rows.Close()
			return ProjectDeletion{}, false, err
		}
		deletion.OSSKeys = append(deletion.OSSKeys, key)
	}
	if err := rows.Close(); err != nil {
		return ProjectDeletion{}, false, err
	}
	if err := transaction.Commit(); err != nil {
		return ProjectDeletion{}, false, err
	}
	return deletion, true, nil
}

func (store *PostgresProjectDeletionStore) ResetEmpty(ctx context.Context, deletion ProjectDeletion) error {
	_, err := store.database.ExecContext(ctx, "UPDATE project_deletions SET empty_since=NULL,updated_at=now() WHERE project_id=$1", deletion.ProjectID)
	return err
}

func (store *PostgresProjectDeletionStore) ConfirmEmpty(ctx context.Context, deletion ProjectDeletion) (bool, error) {
	delay := store.confirmationDelay
	if delay <= 0 {
		delay = time.Minute
	}
	var confirmed bool
	err := store.database.QueryRowContext(ctx, `UPDATE project_deletions SET
		empty_since=COALESCE(empty_since,now()),
		status=CASE WHEN empty_since IS NOT NULL AND empty_since<=now()-($2::double precision*interval '1 second') THEN 'running' ELSE 'verifying' END,
		next_attempt_at=now()+($2::double precision*interval '1 second'),updated_at=now()
		WHERE project_id=$1 AND status='running'
		RETURNING status='running'`, deletion.ProjectID, delay.Seconds()).Scan(&confirmed)
	return confirmed, err
}

func (store *PostgresProjectDeletionStore) Retry(ctx context.Context, deletion ProjectDeletion, cause error) error {
	message := strings.TrimSpace(cause.Error())
	if len(message) > 512 {
		message = message[:512]
	}
	_, err := store.database.ExecContext(ctx, `UPDATE project_deletions SET
		status=CASE WHEN deadline_at<=now() THEN 'failed' ELSE 'retry' END,
		next_attempt_at=now()+(LEAST(300,power(2,LEAST(attempts,8)))::text||' seconds')::interval,
		last_error=$2,empty_since=NULL,updated_at=now() WHERE project_id=$1 AND status IN ('running','verifying')`, deletion.ProjectID, message)
	return err
}

func (store *PostgresProjectDeletionStore) Complete(ctx context.Context, deletion ProjectDeletion) error {
	transaction, err := store.database.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = transaction.Rollback() }()
	for _, statement := range []string{
		"DELETE FROM alert_rules WHERE project_id=$1",
		"DELETE FROM issue_states WHERE project_id=$1",
		"DELETE FROM releases WHERE project_id=$1",
		"DELETE FROM project_keys WHERE project_id=$1",
	} {
		if _, err := transaction.ExecContext(ctx, statement, deletion.ProjectID); err != nil {
			return err
		}
	}
	if _, err := transaction.ExecContext(ctx, `UPDATE project_deletions SET status='completed',last_error='',completed_at=now(),updated_at=now()
		WHERE project_id=$1 AND status='running'`, deletion.ProjectID); err != nil {
		return err
	}
	if _, err := transaction.ExecContext(ctx, `INSERT INTO audit_logs
		(organization_id,actor_user_id,action,resource_type,resource_id,metadata)
		VALUES ($1,$2,'project.deletion_completed','project',$3,jsonb_build_object('attempts',$4::integer))`,
		deletion.OrganizationID, deletion.RequestedBy, deletion.ProjectID, deletion.Attempts); err != nil {
		return err
	}
	return transaction.Commit()
}

type ClickHouseProjectDeleter struct{ database *sql.DB }

func NewClickHouseProjectDeleter(database *sql.DB) *ClickHouseProjectDeleter {
	return &ClickHouseProjectDeleter{database: database}
}

func (deleter *ClickHouseProjectDeleter) DeleteProject(ctx context.Context, projectID uuid.UUID) error {
	for _, table := range projectAnalyticsTables {
		statement := "ALTER TABLE " + table + " ON CLUSTER openrum_cluster DELETE WHERE project_id=? SETTINGS mutations_sync=2"
		if _, err := deleter.database.ExecContext(ctx, statement, projectID); err != nil {
			return fmt.Errorf("delete project from %s: %w", table, err)
		}
	}
	return nil
}

func (deleter *ClickHouseProjectDeleter) CountProject(ctx context.Context, projectID uuid.UUID) (uint64, error) {
	var total uint64
	for _, table := range projectAnalyticsTables {
		var count uint64
		if err := deleter.database.QueryRowContext(ctx, "SELECT count() FROM "+table+" WHERE project_id=?", projectID).Scan(&count); err != nil {
			return 0, fmt.Errorf("count project rows in %s: %w", table, err)
		}
		total += count
	}
	return total, nil
}
