package metadata

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
)

type ProjectAccess struct {
	Project Project
	Role    OrganizationRole
}

type CreateProjectInput struct {
	OrganizationID  uuid.UUID
	Name            string
	Slug            string
	AllowedOrigins  []string
	Environment     string
	Environments    []string
	RetentionDays   int16
	EventSampleRate float64
	APISampleRate   float64
	ErrorSampleRate float64
}

type UpdateProjectInput struct {
	Name            *string
	Slug            *string
	AllowedOrigins  *[]string
	Environment     *string
	Environments    *[]string
	RetentionDays   *int16
	EventSampleRate *float64
	APISampleRate   *float64
	ErrorSampleRate *float64
	// IngestRateLimit is a pointer to a pointer so that "not mentioned" and
	// "set back to the instance default" stay distinguishable: the outer
	// pointer says whether the field was present, the inner one carries null.
	IngestRateLimit   **int32
	OverLimitBehavior *OverLimitBehavior
	Status            *ProjectStatus
}

type ProjectRepository struct {
	database *sql.DB
}

func NewProjectRepository(database *sql.DB) *ProjectRepository {
	return &ProjectRepository{database: database}
}

func (repository *ProjectRepository) ListForOrganization(ctx context.Context, userID, organizationID uuid.UUID) ([]Project, error) {
	rows, err := repository.database.QueryContext(ctx,
		`SELECT projects.id, projects.organization_id, projects.name, projects.slug, to_json(projects.allowed_origins),
		        projects.environment, `+projectEnvironmentsSQL+`, projects.retention_days, projects.event_sample_rate, projects.api_sample_rate,
		        projects.error_sample_rate, projects.ingest_rate_limit, projects.over_limit_behavior,
		        projects.status, projects.created_at, projects.updated_at
		 FROM projects
		 JOIN organization_members ON organization_members.organization_id=projects.organization_id
		 WHERE projects.organization_id=$1 AND organization_members.user_id=$2 AND projects.status!='deleting'
		 ORDER BY projects.name, projects.id`, organizationID, userID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	projects := make([]Project, 0)
	for rows.Next() {
		project, err := scanProject(rows)
		if err != nil {
			return nil, err
		}
		projects = append(projects, project)
	}
	return projects, rows.Err()
}

func (repository *ProjectRepository) GetForUser(ctx context.Context, userID, projectID uuid.UUID) (ProjectAccess, error) {
	var access ProjectAccess
	var allowedOriginsJSON []byte
	var environmentsJSON []byte
	err := repository.database.QueryRowContext(ctx,
		`SELECT projects.id, projects.organization_id, projects.name, projects.slug, to_json(projects.allowed_origins),
		        projects.environment, `+projectEnvironmentsSQL+`, projects.retention_days, projects.event_sample_rate, projects.api_sample_rate,
		        projects.error_sample_rate, projects.ingest_rate_limit, projects.over_limit_behavior,
		        projects.status, projects.created_at, projects.updated_at, organization_members.role
		 FROM projects
		 JOIN organization_members ON organization_members.organization_id=projects.organization_id
		 WHERE projects.id=$1 AND organization_members.user_id=$2 AND projects.status!='deleting'`,
		projectID, userID,
	).Scan(&access.Project.ID, &access.Project.OrganizationID, &access.Project.Name, &access.Project.Slug,
		&allowedOriginsJSON, &access.Project.Environment, &environmentsJSON, &access.Project.RetentionDays,
		&access.Project.EventSampleRate, &access.Project.APISampleRate, &access.Project.ErrorSampleRate,
		&access.Project.IngestRateLimit, &access.Project.OverLimitBehavior, &access.Project.Status, &access.Project.CreatedAt, &access.Project.UpdatedAt, &access.Role)
	if errors.Is(err, sql.ErrNoRows) {
		return ProjectAccess{}, ErrNotFound
	}
	if err != nil {
		return ProjectAccess{}, err
	}
	if err := json.Unmarshal(allowedOriginsJSON, &access.Project.AllowedOrigins); err != nil {
		return ProjectAccess{}, fmt.Errorf("decode allowed origins: %w", err)
	}
	if err := json.Unmarshal(environmentsJSON, &access.Project.Environments); err != nil {
		return ProjectAccess{}, fmt.Errorf("decode project environments: %w", err)
	}
	return access, nil
}

// RequestDeletion immediately disables ingest and hides the project, then
// queues asynchronous ClickHouse and OSS cleanup with a 24-hour deadline.
func (repository *ProjectRepository) RequestDeletion(ctx context.Context, actorID, projectID uuid.UUID) error {
	transaction, err := repository.database.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = transaction.Rollback() }()
	var organizationID uuid.UUID
	err = transaction.QueryRowContext(ctx, "SELECT organization_id FROM projects WHERE id=$1 FOR UPDATE", projectID).Scan(&organizationID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	role, err := lockMembership(ctx, transaction, organizationID, actorID)
	if err != nil {
		return err
	}
	if role != RoleOwner {
		return ErrForbidden
	}
	if _, err := transaction.ExecContext(ctx, "UPDATE projects SET status='deleting',updated_at=now() WHERE id=$1", projectID); err != nil {
		return err
	}
	if _, err := transaction.ExecContext(ctx, "UPDATE project_keys SET revoked_at=COALESCE(revoked_at,now()) WHERE project_id=$1", projectID); err != nil {
		return err
	}
	if _, err := transaction.ExecContext(ctx, `INSERT INTO project_deletions (project_id,organization_id,requested_by)
		VALUES ($1,$2,$3) ON CONFLICT (project_id) DO NOTHING`, projectID, organizationID, actorID); err != nil {
		return err
	}
	if err := insertAudit(ctx, transaction, organizationID, actorID, "project.deletion_requested", "project", projectID); err != nil {
		return err
	}
	return transaction.Commit()
}

func (repository *ProjectRepository) Create(ctx context.Context, actorID uuid.UUID, input CreateProjectInput) (Project, error) {
	project, _, err := repository.create(ctx, actorID, input, "")
	return project, err
}

func (repository *ProjectRepository) CreateWithKey(ctx context.Context, actorID uuid.UUID, input CreateProjectInput, keyName string) (Project, ProjectKeyCredential, error) {
	if keyName == "" {
		return Project{}, ProjectKeyCredential{}, errors.New("project key name is required")
	}
	project, credential, err := repository.create(ctx, actorID, input, keyName)
	if err != nil {
		return Project{}, ProjectKeyCredential{}, err
	}
	return project, *credential, nil
}

func (repository *ProjectRepository) create(ctx context.Context, actorID uuid.UUID, input CreateProjectInput, keyName string) (Project, *ProjectKeyCredential, error) {
	transaction, err := repository.database.BeginTx(ctx, nil)
	if err != nil {
		return Project{}, nil, err
	}
	defer func() { _ = transaction.Rollback() }()
	if err := lockOrganization(ctx, transaction, input.OrganizationID); err != nil {
		return Project{}, nil, err
	}
	actorRole, err := lockMembership(ctx, transaction, input.OrganizationID, actorID)
	if err != nil {
		return Project{}, nil, err
	}
	if !canManageProjectSettings(actorRole) {
		return Project{}, nil, ErrForbidden
	}
	allowedOrigins := input.AllowedOrigins
	if allowedOrigins == nil {
		allowedOrigins = []string{}
	}
	project := Project{ID: uuid.New(), OrganizationID: input.OrganizationID}
	var allowedOriginsJSON []byte
	err = transaction.QueryRowContext(ctx,
		`INSERT INTO projects
		 (id, organization_id, name, slug, allowed_origins, environment, retention_days, event_sample_rate, api_sample_rate,
		  error_sample_rate)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		 RETURNING name, slug, to_json(allowed_origins), environment, retention_days, event_sample_rate, api_sample_rate,
		           error_sample_rate, ingest_rate_limit, over_limit_behavior, status, created_at, updated_at`,
		project.ID, input.OrganizationID, input.Name, input.Slug, allowedOrigins, input.Environment,
		input.RetentionDays, input.EventSampleRate, input.APISampleRate, input.ErrorSampleRate,
	).Scan(&project.Name, &project.Slug, &allowedOriginsJSON, &project.Environment, &project.RetentionDays,
		&project.EventSampleRate, &project.APISampleRate, &project.ErrorSampleRate,
		&project.IngestRateLimit, &project.OverLimitBehavior, &project.Status,
		&project.CreatedAt, &project.UpdatedAt)
	if err != nil {
		return Project{}, nil, translateConstraintError(err)
	}
	if err := json.Unmarshal(allowedOriginsJSON, &project.AllowedOrigins); err != nil {
		return Project{}, nil, fmt.Errorf("decode allowed origins: %w", err)
	}
	environments := make([]string, 0, len(input.Environments)+1)
	environments = append(environments, project.Environment)
	seenEnvironments := map[string]struct{}{project.Environment: {}}
	for _, environment := range input.Environments {
		if _, exists := seenEnvironments[environment]; exists {
			continue
		}
		seenEnvironments[environment] = struct{}{}
		environments = append(environments, environment)
	}
	for _, environment := range environments {
		if _, err := transaction.ExecContext(ctx,
			"INSERT INTO project_environments (project_id,name) VALUES ($1,$2)", project.ID, environment); err != nil {
			return Project{}, nil, translateConstraintError(err)
		}
	}
	project.Environments = environments
	if err := insertAudit(ctx, transaction, input.OrganizationID, actorID, "project.created", "project", project.ID); err != nil {
		return Project{}, nil, err
	}
	var credential *ProjectKeyCredential
	if keyName != "" {
		created, err := createProjectKeyRecord(ctx, transaction, project.ID, keyName, true)
		if err != nil {
			return Project{}, nil, err
		}
		credential = &created
		if err := insertAudit(ctx, transaction, input.OrganizationID, actorID, "project_key.created", "project_key", created.Key.ID); err != nil {
			return Project{}, nil, err
		}
	}
	if err := transaction.Commit(); err != nil {
		return Project{}, nil, err
	}
	return project, credential, nil
}

func (repository *ProjectRepository) Update(ctx context.Context, actorID, projectID uuid.UUID, input UpdateProjectInput) (Project, error) {
	transaction, err := repository.database.BeginTx(ctx, nil)
	if err != nil {
		return Project{}, err
	}
	defer func() { _ = transaction.Rollback() }()
	var organizationID uuid.UUID
	err = transaction.QueryRowContext(ctx, "SELECT organization_id FROM projects WHERE id=$1", projectID).Scan(&organizationID)
	if errors.Is(err, sql.ErrNoRows) {
		return Project{}, ErrNotFound
	}
	if err != nil {
		return Project{}, err
	}
	if err := lockOrganization(ctx, transaction, organizationID); err != nil {
		return Project{}, err
	}
	actorRole, err := lockMembership(ctx, transaction, organizationID, actorID)
	if err != nil {
		return Project{}, err
	}
	if !canManageProjectSettings(actorRole) {
		return Project{}, ErrForbidden
	}

	var allowedOrigins any
	if input.AllowedOrigins != nil {
		allowedOrigins = *input.AllowedOrigins
	}
	var status any
	if input.Status != nil {
		status = string(*input.Status)
	}
	var overLimitBehavior any
	if input.OverLimitBehavior != nil {
		overLimitBehavior = string(*input.OverLimitBehavior)
	}
	// COALESCE cannot express this one: clearing the override back to the
	// instance default means writing NULL, which is exactly the value COALESCE
	// reads as "leave it alone". The presence of the field is passed separately
	// so an explicit null is distinguishable from an absent field.
	var ingestRateLimit any
	if input.IngestRateLimit != nil {
		ingestRateLimit = *input.IngestRateLimit
	}
	// Every sample rate reaches the browser through /api/v1/sdk/config, so any change to
	// one of them has to bump the version SDKs poll against.
	samplingChanged := input.EventSampleRate != nil || input.APISampleRate != nil || input.ErrorSampleRate != nil
	row := transaction.QueryRowContext(ctx,
		`UPDATE projects SET
		   name=COALESCE($1, name), slug=COALESCE($2, slug), allowed_origins=COALESCE($3, allowed_origins),
		   environment=COALESCE($4, environment), retention_days=COALESCE($5, retention_days),
		   event_sample_rate=COALESCE($6, event_sample_rate), api_sample_rate=COALESCE($7, api_sample_rate),
		   error_sample_rate=COALESCE($8, error_sample_rate), status=COALESCE($9, status),
		   ingest_rate_limit=CASE WHEN $10 THEN $11::integer ELSE ingest_rate_limit END,
		   over_limit_behavior=COALESCE($12, over_limit_behavior),
		   sdk_config_version=CASE WHEN $13 THEN sdk_config_version+1 ELSE sdk_config_version END,
		   sdk_config_effective_at=CASE WHEN $13 THEN now() ELSE sdk_config_effective_at END,
		   updated_at=now()
		 WHERE id=$14
		 RETURNING id, organization_id, name, slug, to_json(allowed_origins), environment, json_build_array(environment), retention_days,
		           event_sample_rate, api_sample_rate, error_sample_rate, ingest_rate_limit, over_limit_behavior,
		           status, created_at, updated_at`,
		input.Name, input.Slug, allowedOrigins, input.Environment, input.RetentionDays, input.EventSampleRate,
		input.APISampleRate, input.ErrorSampleRate, status, input.IngestRateLimit != nil, ingestRateLimit,
		overLimitBehavior, samplingChanged, projectID)
	project, err := scanProject(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Project{}, ErrNotFound
	}
	if err != nil {
		return Project{}, translateConstraintError(err)
	}
	if input.Environments != nil {
		if _, err := transaction.ExecContext(ctx, "DELETE FROM project_environments WHERE project_id=$1", projectID); err != nil {
			return Project{}, err
		}
		for _, environment := range *input.Environments {
			if _, err := transaction.ExecContext(ctx,
				"INSERT INTO project_environments (project_id,name) VALUES ($1,$2)", projectID, environment); err != nil {
				return Project{}, translateConstraintError(err)
			}
		}
	}
	if input.Environments != nil || input.Environment != nil {
		if _, err := transaction.ExecContext(ctx,
			"INSERT INTO project_environments (project_id,name) VALUES ($1,$2) ON CONFLICT DO NOTHING", projectID, project.Environment); err != nil {
			return Project{}, translateConstraintError(err)
		}
	}
	project.Environments, err = listProjectEnvironments(ctx, transaction, projectID, project.Environment)
	if err != nil {
		return Project{}, err
	}
	if err := insertAudit(ctx, transaction, organizationID, actorID, "project.updated", "project", projectID); err != nil {
		return Project{}, err
	}
	if err := transaction.Commit(); err != nil {
		return Project{}, err
	}
	return project, nil
}

type rowScanner interface {
	Scan(...any) error
}

func scanProject(scanner rowScanner) (Project, error) {
	var project Project
	var allowedOriginsJSON []byte
	var environmentsJSON []byte
	err := scanner.Scan(&project.ID, &project.OrganizationID, &project.Name, &project.Slug, &allowedOriginsJSON,
		&project.Environment, &environmentsJSON, &project.RetentionDays, &project.EventSampleRate, &project.APISampleRate,
		&project.ErrorSampleRate, &project.IngestRateLimit, &project.OverLimitBehavior, &project.Status, &project.CreatedAt, &project.UpdatedAt)
	if err != nil {
		return Project{}, err
	}
	if err := json.Unmarshal(allowedOriginsJSON, &project.AllowedOrigins); err != nil {
		return Project{}, fmt.Errorf("decode allowed origins: %w", err)
	}
	if err := json.Unmarshal(environmentsJSON, &project.Environments); err != nil {
		return Project{}, fmt.Errorf("decode project environments: %w", err)
	}
	return project, nil
}

const projectEnvironmentsSQL = `COALESCE((
	SELECT json_agg(project_environments.name ORDER BY
		CASE WHEN project_environments.name=projects.environment THEN 0 ELSE 1 END,
		project_environments.name)
	FROM project_environments
	WHERE project_environments.project_id=projects.id
), json_build_array(projects.environment))`

func listProjectEnvironments(ctx context.Context, transaction *sql.Tx, projectID uuid.UUID, defaultEnvironment string) ([]string, error) {
	rows, err := transaction.QueryContext(ctx,
		`SELECT name FROM project_environments WHERE project_id=$1
		 ORDER BY CASE WHEN name=$2 THEN 0 ELSE 1 END, name`, projectID, defaultEnvironment)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	environments := make([]string, 0)
	for rows.Next() {
		var environment string
		if err := rows.Scan(&environment); err != nil {
			return nil, err
		}
		environments = append(environments, environment)
	}
	return environments, rows.Err()
}

func canManageProjectSettings(role OrganizationRole) bool {
	return role == RoleOwner || role == RoleAdmin
}

// canManageAlerts mirrors auth.ActionManageAlerts, which unlike key management
// also admits Members.
func canManageAlerts(role OrganizationRole) bool {
	return role == RoleOwner || role == RoleAdmin || role == RoleMember
}
