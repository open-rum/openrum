package query

import (
	"context"
	"database/sql"
	"time"

	"github.com/google/uuid"
)

// ReportedEnvironment is an environment that has actually sent data for a project.
type ReportedEnvironment struct {
	Name       string    `json:"name"`
	LastSeenAt time.Time `json:"lastSeenAt"`
}

// EnvironmentRepository lists the environments a project has reported under, so the
// Console offers only environments that hold data. project_metrics_1m is sorted by
// project first, which keeps this a narrow read.
type EnvironmentRepository struct{ database *sql.DB }

func NewEnvironmentRepository(database *sql.DB) *EnvironmentRepository {
	return &EnvironmentRepository{database: database}
}

func (repository *EnvironmentRepository) Reported(ctx context.Context, projectID uuid.UUID) ([]ReportedEnvironment, error) {
	rows, err := repository.database.QueryContext(ctx, `SELECT environment, max(bucket) AS last_seen
		FROM project_metrics_1m WHERE project_id = ?
		GROUP BY environment ORDER BY last_seen DESC LIMIT 16`, projectID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	environments := make([]ReportedEnvironment, 0)
	for rows.Next() {
		var environment ReportedEnvironment
		if err := rows.Scan(&environment.Name, &environment.LastSeenAt); err != nil {
			return nil, err
		}
		environment.LastSeenAt = environment.LastSeenAt.UTC()
		environments = append(environments, environment)
	}
	return environments, rows.Err()
}
