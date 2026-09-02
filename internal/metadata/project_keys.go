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

const projectKeyPrefix = "orr_pk_"

var (
	ErrInvalidProjectKey = errors.New("invalid project key")
	ErrProjectKeyRevoked = errors.New("project key is revoked")
)

type ProjectKeyCredential struct {
	Key ProjectKey
	Raw string
}

type ProjectKeyAccess struct {
	Key     ProjectKey
	Project Project
}

type ProjectKeyRepository struct {
	database *sql.DB
}

func NewProjectKeyRepository(database *sql.DB) *ProjectKeyRepository {
	return &ProjectKeyRepository{database: database}
}

func (repository *ProjectKeyRepository) ListForUser(ctx context.Context, userID, projectID uuid.UUID) ([]ProjectKey, OrganizationRole, error) {
	rows, err := repository.database.QueryContext(ctx,
		`SELECT project_keys.id, project_keys.project_id, project_keys.key_prefix, project_keys.name,
		        project_keys.last_used_at, project_keys.revoked_at, project_keys.created_at, organization_members.role
		 FROM project_keys
		 JOIN projects ON projects.id=project_keys.project_id
		 JOIN organization_members ON organization_members.organization_id=projects.organization_id
		 WHERE project_keys.project_id=$1 AND organization_members.user_id=$2
		 ORDER BY project_keys.created_at DESC, project_keys.id`, projectID, userID)
	if err != nil {
		return nil, "", err
	}
	defer func() { _ = rows.Close() }()
	keys := make([]ProjectKey, 0)
	var role OrganizationRole
	for rows.Next() {
		var key ProjectKey
		var rowRole OrganizationRole
		if err := rows.Scan(&key.ID, &key.ProjectID, &key.KeyPrefix, &key.Name, &key.LastUsedAt,
			&key.RevokedAt, &key.CreatedAt, &rowRole); err != nil {
			return nil, "", err
		}
		role = rowRole
		keys = append(keys, key)
	}
	if err := rows.Err(); err != nil {
		return nil, "", err
	}
	if len(keys) == 0 {
		access, err := NewProjectRepository(repository.database).GetForUser(ctx, userID, projectID)
		if err != nil {
			return nil, "", err
		}
		role = access.Role
	}
	return keys, role, nil
}

func (repository *ProjectKeyRepository) Create(ctx context.Context, actorID, projectID uuid.UUID, name string) (ProjectKeyCredential, error) {
	transaction, err := repository.database.BeginTx(ctx, nil)
	if err != nil {
		return ProjectKeyCredential{}, err
	}
	defer func() { _ = transaction.Rollback() }()
	organizationID, err := lockProjectForKeyManagement(ctx, transaction, actorID, projectID)
	if err != nil {
		return ProjectKeyCredential{}, err
	}
	credential, err := createProjectKeyRecord(ctx, transaction, projectID, name)
	if err != nil {
		return ProjectKeyCredential{}, err
	}
	if err := insertAudit(ctx, transaction, organizationID, actorID, "project_key.created", "project_key", credential.Key.ID); err != nil {
		return ProjectKeyCredential{}, err
	}
	if err := transaction.Commit(); err != nil {
		return ProjectKeyCredential{}, err
	}
	return credential, nil
}

func (repository *ProjectKeyRepository) Rotate(ctx context.Context, actorID, projectID, keyID uuid.UUID, name string) (ProjectKeyCredential, error) {
	transaction, err := repository.database.BeginTx(ctx, nil)
	if err != nil {
		return ProjectKeyCredential{}, err
	}
	defer func() { _ = transaction.Rollback() }()
	organizationID, err := lockProjectForKeyManagement(ctx, transaction, actorID, projectID)
	if err != nil {
		return ProjectKeyCredential{}, err
	}
	var currentName string
	var revokedAt *time.Time
	err = transaction.QueryRowContext(ctx,
		"SELECT name, revoked_at FROM project_keys WHERE id=$1 AND project_id=$2 FOR UPDATE", keyID, projectID,
	).Scan(&currentName, &revokedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return ProjectKeyCredential{}, ErrNotFound
	}
	if err != nil {
		return ProjectKeyCredential{}, err
	}
	if revokedAt != nil {
		return ProjectKeyCredential{}, ErrProjectKeyRevoked
	}
	if name == "" {
		name = currentName
	}
	credential, err := createProjectKeyRecord(ctx, transaction, projectID, name)
	if err != nil {
		return ProjectKeyCredential{}, err
	}
	if _, err := transaction.ExecContext(ctx, "UPDATE project_keys SET revoked_at=now() WHERE id=$1", keyID); err != nil {
		return ProjectKeyCredential{}, err
	}
	if err := insertAudit(ctx, transaction, organizationID, actorID, "project_key.rotated", "project_key", credential.Key.ID); err != nil {
		return ProjectKeyCredential{}, err
	}
	if err := transaction.Commit(); err != nil {
		return ProjectKeyCredential{}, err
	}
	return credential, nil
}

func (repository *ProjectKeyRepository) Revoke(ctx context.Context, actorID, projectID, keyID uuid.UUID) error {
	transaction, err := repository.database.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = transaction.Rollback() }()
	organizationID, err := lockProjectForKeyManagement(ctx, transaction, actorID, projectID)
	if err != nil {
		return err
	}
	var revokedAt *time.Time
	err = transaction.QueryRowContext(ctx,
		"SELECT revoked_at FROM project_keys WHERE id=$1 AND project_id=$2 FOR UPDATE", keyID, projectID,
	).Scan(&revokedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if revokedAt != nil {
		return transaction.Commit()
	}
	if _, err := transaction.ExecContext(ctx,
		"UPDATE project_keys SET revoked_at=COALESCE(revoked_at, now()) WHERE id=$1", keyID); err != nil {
		return err
	}
	if err := insertAudit(ctx, transaction, organizationID, actorID, "project_key.revoked", "project_key", keyID); err != nil {
		return err
	}
	return transaction.Commit()
}

func (repository *ProjectKeyRepository) Validate(ctx context.Context, raw string) (ProjectKeyAccess, error) {
	if !strings.HasPrefix(raw, projectKeyPrefix) || len(raw) > 128 {
		return ProjectKeyAccess{}, ErrInvalidProjectKey
	}
	digest := sha256.Sum256([]byte(raw))
	var access ProjectKeyAccess
	var allowedOriginsJSON []byte
	err := repository.database.QueryRowContext(ctx,
		`SELECT project_keys.id, project_keys.project_id, project_keys.key_prefix, project_keys.name,
		        project_keys.last_used_at, project_keys.revoked_at, project_keys.created_at,
		        projects.id, projects.organization_id, projects.name, projects.slug, to_json(projects.allowed_origins),
		        projects.environment, projects.retention_days, projects.event_sample_rate, projects.api_sample_rate,
		        projects.status, projects.created_at, projects.updated_at
		 FROM project_keys JOIN projects ON projects.id=project_keys.project_id
		 WHERE project_keys.key_hash=$1 AND project_keys.revoked_at IS NULL AND projects.status='active'`, digest[:],
	).Scan(&access.Key.ID, &access.Key.ProjectID, &access.Key.KeyPrefix, &access.Key.Name, &access.Key.LastUsedAt,
		&access.Key.RevokedAt, &access.Key.CreatedAt, &access.Project.ID, &access.Project.OrganizationID,
		&access.Project.Name, &access.Project.Slug, &allowedOriginsJSON, &access.Project.Environment,
		&access.Project.RetentionDays, &access.Project.EventSampleRate, &access.Project.APISampleRate,
		&access.Project.Status, &access.Project.CreatedAt, &access.Project.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return ProjectKeyAccess{}, ErrInvalidProjectKey
	}
	if err != nil {
		return ProjectKeyAccess{}, err
	}
	if err := json.Unmarshal(allowedOriginsJSON, &access.Project.AllowedOrigins); err != nil {
		return ProjectKeyAccess{}, fmt.Errorf("decode allowed origins: %w", err)
	}
	if _, err := repository.database.ExecContext(ctx,
		"UPDATE project_keys SET last_used_at=now() WHERE id=$1 AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')",
		access.Key.ID); err != nil {
		return ProjectKeyAccess{}, err
	}
	return access, nil
}

func createProjectKeyRecord(ctx context.Context, transaction *sql.Tx, projectID uuid.UUID, name string) (ProjectKeyCredential, error) {
	randomBytes := make([]byte, 32)
	if _, err := rand.Read(randomBytes); err != nil {
		return ProjectKeyCredential{}, fmt.Errorf("generate project key: %w", err)
	}
	raw := projectKeyPrefix + base64.RawURLEncoding.EncodeToString(randomBytes)
	digest := sha256.Sum256([]byte(raw))
	credential := ProjectKeyCredential{
		Raw: raw,
		Key: ProjectKey{ID: uuid.New(), ProjectID: projectID, KeyPrefix: raw[:16], Name: name},
	}
	err := transaction.QueryRowContext(ctx,
		`INSERT INTO project_keys (id, project_id, key_prefix, key_hash, name) VALUES ($1,$2,$3,$4,$5)
		 RETURNING created_at`, credential.Key.ID, projectID, credential.Key.KeyPrefix, digest[:], name,
	).Scan(&credential.Key.CreatedAt)
	if err != nil {
		return ProjectKeyCredential{}, translateConstraintError(err)
	}
	return credential, nil
}

func lockProjectForKeyManagement(ctx context.Context, transaction *sql.Tx, actorID, projectID uuid.UUID) (uuid.UUID, error) {
	var organizationID uuid.UUID
	err := transaction.QueryRowContext(ctx, "SELECT organization_id FROM projects WHERE id=$1", projectID).Scan(&organizationID)
	if errors.Is(err, sql.ErrNoRows) {
		return uuid.Nil, ErrNotFound
	}
	if err != nil {
		return uuid.Nil, err
	}
	if err := lockOrganization(ctx, transaction, organizationID); err != nil {
		return uuid.Nil, err
	}
	role, err := lockMembership(ctx, transaction, organizationID, actorID)
	if err != nil {
		return uuid.Nil, err
	}
	if !canManageProjectSettings(role) {
		return uuid.Nil, ErrForbidden
	}
	return organizationID, nil
}
