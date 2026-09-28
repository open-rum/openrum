package metadata

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
)

// MaxDashboards is the per-user, per-Project limit. The schema enforces it too, through
// the position range.
const MaxDashboards = 20

// DefaultDashboardName names the personal dashboard the deprecated single-dashboard
// endpoint creates, and existing layouts moved to user_dashboards. The built-in default
// dashboard itself is defined by the Console and never stored.
const DefaultDashboardName = "我的仪表盘"

var (
	ErrDashboardLimitReached = errors.New("dashboard limit reached")
	ErrDashboardNameTaken    = errors.New("dashboard name already used")
	ErrDashboardOrderStale   = errors.New("dashboard order is stale")
	ErrInvalidDashboardName  = errors.New("invalid dashboard name")
)

// Dashboard is the legacy single-dashboard shape served by /overview/config. It is a
// personal preference, not a Project setting: readers (viewers included) may edit their
// own without changing anyone else's view.
type Dashboard struct {
	Config    json.RawMessage `json:"config"`
	Revision  int64           `json:"revision"`
	UpdatedAt *time.Time      `json:"updatedAt"`
}

// NamedDashboard is one of a user's dashboards for a Project.
type NamedDashboard struct {
	ID        uuid.UUID       `json:"id"`
	Name      string          `json:"name"`
	Position  int             `json:"position"`
	Config    json.RawMessage `json:"config"`
	Revision  int64           `json:"revision"`
	CreatedAt time.Time       `json:"createdAt"`
	UpdatedAt time.Time       `json:"updatedAt"`
}

// DashboardSummary lists a dashboard without its configuration.
type DashboardSummary struct {
	ID          uuid.UUID `json:"id"`
	Name        string    `json:"name"`
	Position    int       `json:"position"`
	Revision    int64     `json:"revision"`
	WidgetCount int       `json:"widgetCount"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type DashboardRepository struct{ database *sql.DB }

func NewDashboardRepository(database *sql.DB) *DashboardRepository {
	return &DashboardRepository{database: database}
}

// NormalizeDashboardName trims a name and rejects empty, oversized or control-character
// names before they reach the database constraint.
func NormalizeDashboardName(name string) (string, error) {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" || utf8.RuneCountInString(trimmed) > 80 || strings.ContainsFunc(trimmed, isControl) {
		return "", ErrInvalidDashboardName
	}
	return trimmed, nil
}

func isControl(r rune) bool { return r < 0x20 || r == 0x7f }

const dashboardColumns = "id, name, position, config, revision, created_at, updated_at"

func scanNamedDashboard(scanner interface{ Scan(...any) error }) (NamedDashboard, error) {
	var result NamedDashboard
	var position int16
	err := scanner.Scan(&result.ID, &result.Name, &position, &result.Config, &result.Revision, &result.CreatedAt, &result.UpdatedAt)
	result.Position = int(position)
	return result, err
}

func (repository *DashboardRepository) List(ctx context.Context, userID, projectID uuid.UUID) ([]DashboardSummary, error) {
	rows, err := repository.database.QueryContext(ctx, `
		SELECT id, name, position, revision, coalesce(jsonb_array_length(config->'widgets'), 0), updated_at
		FROM user_dashboards WHERE user_id=$1 AND project_id=$2 ORDER BY position`, userID, projectID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	result := make([]DashboardSummary, 0)
	for rows.Next() {
		var summary DashboardSummary
		var position int16
		if err := rows.Scan(&summary.ID, &summary.Name, &position, &summary.Revision, &summary.WidgetCount, &summary.UpdatedAt); err != nil {
			return nil, err
		}
		summary.Position = int(position)
		result = append(result, summary)
	}
	return result, rows.Err()
}

// GetByID returns one dashboard. Every lookup is scoped by user and Project as well as
// id, so another user's dashboard id reads as not found rather than leaking.
func (repository *DashboardRepository) GetByID(ctx context.Context, userID, projectID, id uuid.UUID) (NamedDashboard, error) {
	result, err := scanNamedDashboard(repository.database.QueryRowContext(ctx,
		"SELECT "+dashboardColumns+" FROM user_dashboards WHERE user_id=$1 AND project_id=$2 AND id=$3",
		userID, projectID, id))
	if errors.Is(err, sql.ErrNoRows) {
		return NamedDashboard{}, ErrNotFound
	}
	return result, err
}

// GetDefault returns the first dashboard by position, if the user has any.
func (repository *DashboardRepository) GetDefault(ctx context.Context, userID, projectID uuid.UUID) (NamedDashboard, bool, error) {
	result, err := scanNamedDashboard(repository.database.QueryRowContext(ctx,
		"SELECT "+dashboardColumns+" FROM user_dashboards WHERE user_id=$1 AND project_id=$2 ORDER BY position LIMIT 1",
		userID, projectID))
	if errors.Is(err, sql.ErrNoRows) {
		return NamedDashboard{}, false, nil
	}
	if err != nil {
		return NamedDashboard{}, false, err
	}
	return result, true, nil
}

// mutate runs a write under the membership lock and a per-user, per-Project advisory lock.
// The membership lock keeps a revoked member or a Project being deleted from writing;
// the advisory lock serializes one user's creates and reorders so positions never race.
func (repository *DashboardRepository) mutate(ctx context.Context, userID, projectID uuid.UUID, write func(*sql.Tx) error) error {
	tx, err := repository.database.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	var member uuid.UUID
	err = tx.QueryRowContext(ctx, `SELECT m.user_id FROM organization_members m
		JOIN projects p ON p.organization_id=m.organization_id
		WHERE m.user_id=$1 AND p.id=$2 AND p.status!='deleting'
		FOR SHARE OF m,p`, userID, projectID).Scan(&member)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1::text || ':' || $2::text, 0))", userID, projectID); err != nil {
		return err
	}
	if err := write(tx); err != nil {
		return err
	}
	return tx.Commit()
}

func dashboardConstraintError(err error) error {
	var postgresError *pgconn.PgError
	if errors.As(err, &postgresError) {
		switch {
		case postgresError.Code == "23505" && postgresError.ConstraintName == "user_dashboards_name_key":
			return ErrDashboardNameTaken
		case postgresError.Code == "23514" && strings.Contains(postgresError.ConstraintName, "position"):
			return ErrDashboardLimitReached
		}
	}
	return translateConstraintError(err)
}

func (repository *DashboardRepository) Create(ctx context.Context, userID, projectID uuid.UUID, name string, config json.RawMessage) (NamedDashboard, error) {
	name, err := NormalizeDashboardName(name)
	if err != nil {
		return NamedDashboard{}, err
	}
	var result NamedDashboard
	err = repository.mutate(ctx, userID, projectID, func(tx *sql.Tx) error {
		var count int
		if err := tx.QueryRowContext(ctx, "SELECT count(*) FROM user_dashboards WHERE user_id=$1 AND project_id=$2", userID, projectID).Scan(&count); err != nil {
			return err
		}
		if count >= MaxDashboards {
			return ErrDashboardLimitReached
		}
		created, err := scanNamedDashboard(tx.QueryRowContext(ctx, `
			INSERT INTO user_dashboards (user_id, project_id, name, position, config)
			VALUES ($1, $2, $3, $4, $5) RETURNING `+dashboardColumns, userID, projectID, name, count, string(config)))
		if err != nil {
			return dashboardConstraintError(err)
		}
		result = created
		return nil
	})
	return result, err
}

// Duplicate copies a dashboard on the server, byte for byte, so modules this deployment
// cannot read are preserved rather than dropped by a client round trip.
func (repository *DashboardRepository) Duplicate(ctx context.Context, userID, projectID, sourceID uuid.UUID, name string) (NamedDashboard, error) {
	name, err := NormalizeDashboardName(name)
	if err != nil {
		return NamedDashboard{}, err
	}
	var result NamedDashboard
	err = repository.mutate(ctx, userID, projectID, func(tx *sql.Tx) error {
		var count int
		if err := tx.QueryRowContext(ctx, "SELECT count(*) FROM user_dashboards WHERE user_id=$1 AND project_id=$2", userID, projectID).Scan(&count); err != nil {
			return err
		}
		if count >= MaxDashboards {
			return ErrDashboardLimitReached
		}
		created, err := scanNamedDashboard(tx.QueryRowContext(ctx, `
			INSERT INTO user_dashboards (user_id, project_id, name, position, config)
			SELECT user_id, project_id, $4, $5, config FROM user_dashboards
			WHERE user_id=$1 AND project_id=$2 AND id=$3
			RETURNING `+dashboardColumns, userID, projectID, sourceID, name, count))
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return dashboardConstraintError(err)
		}
		result = created
		return nil
	})
	return result, err
}

// SaveConfig replaces a dashboard's configuration if it is still at the revision the
// client last read.
func (repository *DashboardRepository) SaveConfig(ctx context.Context, userID, projectID, id uuid.UUID, config json.RawMessage, revision int64) (NamedDashboard, error) {
	var result NamedDashboard
	err := repository.mutate(ctx, userID, projectID, func(tx *sql.Tx) error {
		saved, err := scanNamedDashboard(tx.QueryRowContext(ctx, `
			UPDATE user_dashboards SET config=$4, revision=revision+1, updated_at=now()
			WHERE user_id=$1 AND project_id=$2 AND id=$3 AND revision=$5
			RETURNING `+dashboardColumns, userID, projectID, id, string(config), revision))
		if errors.Is(err, sql.ErrNoRows) {
			var exists bool
			if err := tx.QueryRowContext(ctx, "SELECT EXISTS (SELECT 1 FROM user_dashboards WHERE user_id=$1 AND project_id=$2 AND id=$3)", userID, projectID, id).Scan(&exists); err != nil {
				return err
			}
			if !exists {
				return ErrNotFound
			}
			return ErrConfigVersionConflict
		}
		if err != nil {
			return err
		}
		result = saved
		return nil
	})
	return result, err
}

// Rename does not advance the revision: a rename in one tab must not turn a layout being
// edited in another into a conflict.
func (repository *DashboardRepository) Rename(ctx context.Context, userID, projectID, id uuid.UUID, name string) (NamedDashboard, error) {
	name, err := NormalizeDashboardName(name)
	if err != nil {
		return NamedDashboard{}, err
	}
	var result NamedDashboard
	err = repository.mutate(ctx, userID, projectID, func(tx *sql.Tx) error {
		renamed, err := scanNamedDashboard(tx.QueryRowContext(ctx, `
			UPDATE user_dashboards SET name=$4, updated_at=now()
			WHERE user_id=$1 AND project_id=$2 AND id=$3
			RETURNING `+dashboardColumns, userID, projectID, id, name))
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return dashboardConstraintError(err)
		}
		result = renamed
		return nil
	})
	return result, err
}

// Reorder takes the complete new order. Anything but an exact permutation of the current
// dashboards means the client's list is stale.
func (repository *DashboardRepository) Reorder(ctx context.Context, userID, projectID uuid.UUID, ids []uuid.UUID) ([]DashboardSummary, error) {
	err := repository.mutate(ctx, userID, projectID, func(tx *sql.Tx) error {
		rows, err := tx.QueryContext(ctx, "SELECT id FROM user_dashboards WHERE user_id=$1 AND project_id=$2", userID, projectID)
		if err != nil {
			return err
		}
		current := map[uuid.UUID]bool{}
		for rows.Next() {
			var id uuid.UUID
			if err := rows.Scan(&id); err != nil {
				_ = rows.Close()
				return err
			}
			current[id] = true
		}
		_ = rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		if len(ids) != len(current) {
			return ErrDashboardOrderStale
		}
		seen := map[uuid.UUID]bool{}
		for _, id := range ids {
			if !current[id] || seen[id] {
				return ErrDashboardOrderStale
			}
			seen[id] = true
		}
		if _, err := tx.ExecContext(ctx, "SET CONSTRAINTS user_dashboards_position_key DEFERRED"); err != nil {
			return err
		}
		for position, id := range ids {
			if _, err := tx.ExecContext(ctx, "UPDATE user_dashboards SET position=$4 WHERE user_id=$1 AND project_id=$2 AND id=$3",
				userID, projectID, id, position); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return repository.List(ctx, userID, projectID)
}

// Delete removes a dashboard and closes the gap it leaves. Deleting the last one is
// allowed: the user is back to the built-in layout, exactly as before they saved one.
func (repository *DashboardRepository) Delete(ctx context.Context, userID, projectID, id uuid.UUID) error {
	return repository.mutate(ctx, userID, projectID, func(tx *sql.Tx) error {
		var position int16
		err := tx.QueryRowContext(ctx, "DELETE FROM user_dashboards WHERE user_id=$1 AND project_id=$2 AND id=$3 RETURNING position",
			userID, projectID, id).Scan(&position)
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, "SET CONSTRAINTS user_dashboards_position_key DEFERRED"); err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, "UPDATE user_dashboards SET position=position-1 WHERE user_id=$1 AND project_id=$2 AND position > $3",
			userID, projectID, position)
		return err
	})
}

// Get serves the deprecated single-dashboard endpoint from the user's first dashboard.
func (repository *DashboardRepository) Get(ctx context.Context, userID, projectID uuid.UUID) (Dashboard, error) {
	current, found, err := repository.GetDefault(ctx, userID, projectID)
	if err != nil || !found {
		return Dashboard{}, err
	}
	updated := current.UpdatedAt
	return Dashboard{Config: current.Config, Revision: current.Revision, UpdatedAt: &updated}, nil
}

// Save serves the deprecated single-dashboard endpoint. Revision zero creates the first
// dashboard only when the user has none; anything else saves the first dashboard.
func (repository *DashboardRepository) Save(ctx context.Context, userID, projectID uuid.UUID, config json.RawMessage, revision int64) (Dashboard, error) {
	if revision == 0 {
		var created NamedDashboard
		err := repository.mutate(ctx, userID, projectID, func(tx *sql.Tx) error {
			var count int
			if err := tx.QueryRowContext(ctx, "SELECT count(*) FROM user_dashboards WHERE user_id=$1 AND project_id=$2", userID, projectID).Scan(&count); err != nil {
				return err
			}
			if count > 0 {
				return ErrConfigVersionConflict
			}
			inserted, err := scanNamedDashboard(tx.QueryRowContext(ctx, `
				INSERT INTO user_dashboards (user_id, project_id, name, position, config)
				VALUES ($1, $2, $3, 0, $4) RETURNING `+dashboardColumns, userID, projectID, DefaultDashboardName, string(config)))
			if err != nil {
				return dashboardConstraintError(err)
			}
			created = inserted
			return nil
		})
		if err != nil {
			return Dashboard{}, err
		}
		return Dashboard{Config: created.Config, Revision: created.Revision, UpdatedAt: &created.UpdatedAt}, nil
	}
	current, found, err := repository.GetDefault(ctx, userID, projectID)
	if err != nil {
		return Dashboard{}, err
	}
	if !found {
		return Dashboard{}, ErrConfigVersionConflict
	}
	saved, err := repository.SaveConfig(ctx, userID, projectID, current.ID, config, revision)
	if err != nil {
		return Dashboard{}, err
	}
	return Dashboard{Config: saved.Config, Revision: saved.Revision, UpdatedAt: &saved.UpdatedAt}, nil
}
