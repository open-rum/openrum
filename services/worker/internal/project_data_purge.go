package internal

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

type ProjectDataPurge struct {
	ProjectID      uuid.UUID
	OrganizationID uuid.UUID
	RequestedBy    uuid.NullUUID
	Attempts       int
	DeadlineAt     time.Time
	OSSKeys        []string
}

type ProjectDataPurgeStore interface {
	Claim(context.Context) (ProjectDataPurge, bool, error)
	ResetEmpty(context.Context, ProjectDataPurge) error
	ConfirmEmpty(context.Context, ProjectDataPurge) (bool, error)
	Retry(context.Context, ProjectDataPurge, error) error
	Complete(context.Context, ProjectDataPurge) error
}

type ProjectDataPurgeJob struct {
	store     ProjectDataPurgeStore
	analytics ProjectAnalyticsDeleter
	objects   ObjectDeleter
}

func NewProjectDataPurgeJob(
	store ProjectDataPurgeStore,
	analytics ProjectAnalyticsDeleter,
	objects ObjectDeleter,
) *ProjectDataPurgeJob {
	return &ProjectDataPurgeJob{store: store, analytics: analytics, objects: objects}
}

func (job *ProjectDataPurgeJob) RunOne(ctx context.Context) (bool, error) {
	purge, found, err := job.store.Claim(ctx)
	if err != nil || !found {
		return false, err
	}
	before, err := job.analytics.CountProject(ctx, purge.ProjectID)
	if err != nil {
		return true, errors.Join(err, job.store.Retry(ctx, purge, err))
	}
	if before > 0 {
		if err := job.store.ResetEmpty(ctx, purge); err != nil {
			return true, errors.Join(err, job.store.Retry(ctx, purge, err))
		}
	}
	if err := job.analytics.DeleteProject(ctx, purge.ProjectID); err != nil {
		return true, errors.Join(err, job.store.Retry(ctx, purge, err))
	}
	confirmed, err := job.store.ConfirmEmpty(ctx, purge)
	if err != nil {
		return true, errors.Join(err, job.store.Retry(ctx, purge, err))
	}
	if !confirmed {
		return true, nil
	}
	remaining, err := job.analytics.CountProject(ctx, purge.ProjectID)
	if err != nil || remaining != 0 {
		if err == nil {
			err = fmt.Errorf("analytics purge left %d queryable rows", remaining)
		}
		return true, errors.Join(err, job.store.Retry(ctx, purge, err))
	}
	if len(purge.OSSKeys) > 0 && job.objects == nil {
		err := errors.New("object storage is disabled while project artifacts still exist")
		return true, errors.Join(err, job.store.Retry(ctx, purge, err))
	}
	for _, key := range purge.OSSKeys {
		if err := job.objects.Delete(ctx, key); err != nil {
			return true, errors.Join(err, job.store.Retry(ctx, purge, err))
		}
	}
	if err := job.store.Complete(ctx, purge); err != nil {
		return true, errors.Join(err, job.store.Retry(ctx, purge, err))
	}
	return true, nil
}

type PostgresProjectDataPurgeStore struct {
	database          *sql.DB
	confirmationDelay time.Duration
}

func NewPostgresProjectDataPurgeStore(database *sql.DB) *PostgresProjectDataPurgeStore {
	return &PostgresProjectDataPurgeStore{database: database, confirmationDelay: time.Minute}
}

func (store *PostgresProjectDataPurgeStore) Claim(ctx context.Context) (ProjectDataPurge, bool, error) {
	transaction, err := store.database.BeginTx(ctx, nil)
	if err != nil {
		return ProjectDataPurge{}, false, err
	}
	defer func() { _ = transaction.Rollback() }()
	if _, err := transaction.ExecContext(ctx, `UPDATE project_data_purges SET status='failed',
		last_error='data deletion deadline exceeded',updated_at=now()
		WHERE status IN ('queued','retry','running','verifying') AND deadline_at<=now()`); err != nil {
		return ProjectDataPurge{}, false, err
	}
	var purge ProjectDataPurge
	err = transaction.QueryRowContext(ctx, `WITH candidate AS (
		SELECT project_id FROM project_data_purges
		WHERE ((status IN ('queued','retry','verifying') AND next_attempt_at<=now())
		   OR (status='running' AND updated_at<now()-interval '15 minutes'))
		  AND deadline_at>now()
		ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
	)
	UPDATE project_data_purges p SET status='running',attempts=p.attempts+1,updated_at=now()
	FROM candidate WHERE p.project_id=candidate.project_id
	RETURNING p.project_id,p.organization_id,p.requested_by,p.attempts,p.deadline_at`).Scan(
		&purge.ProjectID, &purge.OrganizationID, &purge.RequestedBy, &purge.Attempts, &purge.DeadlineAt)
	if errors.Is(err, sql.ErrNoRows) {
		return ProjectDataPurge{}, false, nil
	}
	if err != nil {
		return ProjectDataPurge{}, false, err
	}
	rows, err := transaction.QueryContext(ctx, `SELECT a.oss_key FROM sourcemap_artifacts a
		JOIN releases r ON r.id=a.release_id WHERE r.project_id=$1 ORDER BY a.oss_key`, purge.ProjectID)
	if err != nil {
		return ProjectDataPurge{}, false, err
	}
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			_ = rows.Close()
			return ProjectDataPurge{}, false, err
		}
		purge.OSSKeys = append(purge.OSSKeys, key)
	}
	if err := rows.Close(); err != nil {
		return ProjectDataPurge{}, false, err
	}
	if err := transaction.Commit(); err != nil {
		return ProjectDataPurge{}, false, err
	}
	return purge, true, nil
}

func (store *PostgresProjectDataPurgeStore) ResetEmpty(ctx context.Context, purge ProjectDataPurge) error {
	_, err := store.database.ExecContext(ctx,
		"UPDATE project_data_purges SET empty_since=NULL,updated_at=now() WHERE project_id=$1", purge.ProjectID)
	return err
}

func (store *PostgresProjectDataPurgeStore) ConfirmEmpty(ctx context.Context, purge ProjectDataPurge) (bool, error) {
	delay := store.confirmationDelay
	if delay <= 0 {
		delay = time.Minute
	}
	var confirmed bool
	err := store.database.QueryRowContext(ctx, `UPDATE project_data_purges SET
		empty_since=COALESCE(empty_since,now()),
		status=CASE WHEN empty_since IS NOT NULL AND empty_since<=now()-($2::double precision*interval '1 second') THEN 'running' ELSE 'verifying' END,
		next_attempt_at=now()+($2::double precision*interval '1 second'),updated_at=now()
		WHERE project_id=$1 AND status='running'
		RETURNING status='running'`, purge.ProjectID, delay.Seconds()).Scan(&confirmed)
	return confirmed, err
}

func (store *PostgresProjectDataPurgeStore) Retry(ctx context.Context, purge ProjectDataPurge, cause error) error {
	message := strings.TrimSpace(cause.Error())
	if len(message) > 512 {
		message = message[:512]
	}
	_, err := store.database.ExecContext(ctx, `UPDATE project_data_purges SET
		status=CASE WHEN deadline_at<=now() THEN 'failed' ELSE 'retry' END,
		next_attempt_at=now()+(LEAST(300,power(2,LEAST(attempts,8)))::text||' seconds')::interval,
		last_error=$2,empty_since=NULL,updated_at=now()
		WHERE project_id=$1 AND status IN ('running','verifying')`, purge.ProjectID, message)
	return err
}

func (store *PostgresProjectDataPurgeStore) Complete(ctx context.Context, purge ProjectDataPurge) error {
	transaction, err := store.database.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = transaction.Rollback() }()
	for _, statement := range []string{
		"DELETE FROM alert_evaluations WHERE rule_id IN (SELECT id FROM alert_rules WHERE project_id=$1)",
		"DELETE FROM issue_states WHERE project_id=$1",
		"DELETE FROM releases WHERE project_id=$1",
	} {
		if _, err := transaction.ExecContext(ctx, statement, purge.ProjectID); err != nil {
			return err
		}
	}
	result, err := transaction.ExecContext(ctx, `UPDATE project_data_purges SET
		status='completed',last_error='',completed_at=now(),updated_at=now()
		WHERE project_id=$1 AND status='running'`, purge.ProjectID)
	if err != nil {
		return err
	}
	if rows, err := result.RowsAffected(); err != nil || rows != 1 {
		return errors.New("project data purge is no longer running")
	}
	if _, err := transaction.ExecContext(ctx, `INSERT INTO audit_logs
		(organization_id,actor_user_id,action,resource_type,resource_id,metadata)
		VALUES ($1,$2,'project.data_purge_completed','project',$3,
			jsonb_build_object('attempts',$4::integer))`,
		purge.OrganizationID, purge.RequestedBy, purge.ProjectID, purge.Attempts); err != nil {
		return err
	}
	return transaction.Commit()
}
