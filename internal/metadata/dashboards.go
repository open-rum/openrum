package metadata

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
)

// Dashboard is a personal preference, not a project setting. Readers (including
// viewers) may edit their own document without changing other members' views.
type Dashboard struct {
	Config    json.RawMessage `json:"config"`
	Revision  int64           `json:"revision"`
	UpdatedAt *time.Time      `json:"updatedAt"`
}

type DashboardRepository struct{ database *sql.DB }

func NewDashboardRepository(database *sql.DB) *DashboardRepository {
	return &DashboardRepository{database: database}
}

func (repository *DashboardRepository) Get(ctx context.Context, userID, projectID uuid.UUID) (Dashboard, error) {
	var result Dashboard
	err := repository.database.QueryRowContext(ctx, `
		SELECT config, revision, updated_at FROM user_project_dashboards
		WHERE user_id=$1 AND project_id=$2`, userID, projectID).
		Scan(&result.Config, &result.Revision, &result.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Dashboard{}, nil
	}
	return result, err
}

func (repository *DashboardRepository) Save(ctx context.Context, userID, projectID uuid.UUID, config json.RawMessage, revision int64) (Dashboard, error) {
	tx, err := repository.database.BeginTx(ctx, nil)
	if err != nil {
		return Dashboard{}, err
	}
	defer func() { _ = tx.Rollback() }()
	// Hold membership and project locks through the write so revocation/deletion
	// cannot race a previously authorized request. No elevated role is needed.
	var member uuid.UUID
	err = tx.QueryRowContext(ctx, `SELECT m.user_id FROM organization_members m
		JOIN projects p ON p.organization_id=m.organization_id
		WHERE m.user_id=$1 AND p.id=$2 AND p.status!='deleting'
		FOR SHARE OF m,p`, userID, projectID).Scan(&member)
	if errors.Is(err, sql.ErrNoRows) {
		return Dashboard{}, ErrNotFound
	}
	if err != nil {
		return Dashboard{}, err
	}
	var result Dashboard
	if revision == 0 {
		err = tx.QueryRowContext(ctx, `INSERT INTO user_project_dashboards (user_id,project_id,config)
			VALUES ($1,$2,$3) ON CONFLICT (user_id,project_id) DO NOTHING
			RETURNING config,revision,updated_at`, userID, projectID, string(config)).
			Scan(&result.Config, &result.Revision, &result.UpdatedAt)
	} else {
		err = tx.QueryRowContext(ctx, `UPDATE user_project_dashboards
			SET config=$3,revision=revision+1,updated_at=now()
			WHERE user_id=$1 AND project_id=$2 AND revision=$4
			RETURNING config,revision,updated_at`, userID, projectID, string(config), revision).
			Scan(&result.Config, &result.Revision, &result.UpdatedAt)
	}
	if errors.Is(err, sql.ErrNoRows) {
		return Dashboard{}, ErrConfigVersionConflict
	}
	if err != nil {
		return Dashboard{}, err
	}
	if err := tx.Commit(); err != nil {
		return Dashboard{}, err
	}
	return result, nil
}
