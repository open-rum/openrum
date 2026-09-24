package metadata

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
)

var (
	ErrProjectMustBeDisabled        = errors.New("project must be disabled before purging data")
	ErrProjectDataPurgeInProgress   = errors.New("project data purge is already in progress")
	ErrInvalidDataPurgeConfirmation = errors.New("project data purge confirmation does not match")
)

type ProjectDataPurge struct {
	ProjectID   uuid.UUID
	Status      string
	Attempts    int
	LastError   string
	DeadlineAt  time.Time
	CreatedAt   time.Time
	UpdatedAt   time.Time
	CompletedAt *time.Time
}

func (repository *ProjectRepository) RequestDataPurge(
	ctx context.Context,
	actorID, projectID uuid.UUID,
	confirmation string,
) (ProjectDataPurge, error) {
	transaction, err := repository.database.BeginTx(ctx, nil)
	if err != nil {
		return ProjectDataPurge{}, err
	}
	defer func() { _ = transaction.Rollback() }()

	var organizationID uuid.UUID
	var name string
	var status ProjectStatus
	err = transaction.QueryRowContext(ctx,
		"SELECT organization_id,name,status FROM projects WHERE id=$1 FOR UPDATE", projectID,
	).Scan(&organizationID, &name, &status)
	if errors.Is(err, sql.ErrNoRows) {
		return ProjectDataPurge{}, ErrNotFound
	}
	if err != nil {
		return ProjectDataPurge{}, err
	}
	role, err := lockMembership(ctx, transaction, organizationID, actorID)
	if err != nil {
		return ProjectDataPurge{}, err
	}
	if role != RoleOwner {
		return ProjectDataPurge{}, ErrForbidden
	}
	if status != ProjectStatusDisabled {
		return ProjectDataPurge{}, ErrProjectMustBeDisabled
	}
	if strings.TrimSpace(confirmation) != name {
		return ProjectDataPurge{}, ErrInvalidDataPurgeConfirmation
	}

	var purge ProjectDataPurge
	var completedAt sql.NullTime
	err = transaction.QueryRowContext(ctx, `INSERT INTO project_data_purges
		(project_id,organization_id,requested_by)
		VALUES ($1,$2,$3)
		ON CONFLICT (project_id) DO UPDATE SET
			organization_id=EXCLUDED.organization_id,
			requested_by=EXCLUDED.requested_by,
			status='queued',attempts=0,next_attempt_at=now(),deadline_at=now()+interval '24 hours',
			last_error='',empty_since=NULL,created_at=now(),updated_at=now(),completed_at=NULL
		WHERE project_data_purges.status IN ('completed','failed')
		RETURNING project_id,status,attempts,last_error,deadline_at,created_at,updated_at,completed_at`,
		projectID, organizationID, actorID,
	).Scan(&purge.ProjectID, &purge.Status, &purge.Attempts, &purge.LastError, &purge.DeadlineAt,
		&purge.CreatedAt, &purge.UpdatedAt, &completedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return ProjectDataPurge{}, ErrProjectDataPurgeInProgress
	}
	if err != nil {
		return ProjectDataPurge{}, err
	}
	if completedAt.Valid {
		value := completedAt.Time.UTC()
		purge.CompletedAt = &value
	}
	if err := insertAudit(ctx, transaction, organizationID, actorID, "project.data_purge_requested", "project", projectID); err != nil {
		return ProjectDataPurge{}, err
	}
	if err := transaction.Commit(); err != nil {
		return ProjectDataPurge{}, err
	}
	return normalizeProjectDataPurge(purge), nil
}

func (repository *ProjectRepository) GetDataPurge(
	ctx context.Context,
	actorID, projectID uuid.UUID,
) (ProjectDataPurge, error) {
	if _, err := repository.GetForUser(ctx, actorID, projectID); err != nil {
		return ProjectDataPurge{}, err
	}
	var purge ProjectDataPurge
	var completedAt sql.NullTime
	err := repository.database.QueryRowContext(ctx, `SELECT project_id,status,attempts,last_error,
		deadline_at,created_at,updated_at,completed_at FROM project_data_purges WHERE project_id=$1`, projectID,
	).Scan(&purge.ProjectID, &purge.Status, &purge.Attempts, &purge.LastError, &purge.DeadlineAt,
		&purge.CreatedAt, &purge.UpdatedAt, &completedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return ProjectDataPurge{ProjectID: projectID, Status: "idle"}, nil
	}
	if err != nil {
		return ProjectDataPurge{}, err
	}
	if completedAt.Valid {
		value := completedAt.Time.UTC()
		purge.CompletedAt = &value
	}
	return normalizeProjectDataPurge(purge), nil
}

func normalizeProjectDataPurge(purge ProjectDataPurge) ProjectDataPurge {
	purge.DeadlineAt = purge.DeadlineAt.UTC()
	purge.CreatedAt = purge.CreatedAt.UTC()
	purge.UpdatedAt = purge.UpdatedAt.UTC()
	return purge
}
