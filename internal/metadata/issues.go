package metadata

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/google/uuid"
)

type IssueStatus string
type SourceMapArtifactStatus string

const (
	IssueStatusUnresolved IssueStatus = "unresolved"
	IssueStatusResolved   IssueStatus = "resolved"
	IssueStatusIgnored    IssueStatus = "ignored"

	ArtifactStatusPending SourceMapArtifactStatus = "pending"
	ArtifactStatusReady   SourceMapArtifactStatus = "ready"
	ArtifactStatusFailed  SourceMapArtifactStatus = "failed"
)

type Release struct {
	ID         uuid.UUID  `json:"id"`
	ProjectID  uuid.UUID  `json:"projectId"`
	Version    string     `json:"version"`
	Dist       string     `json:"dist"`
	CommitSHA  string     `json:"commitSha"`
	DeployedAt *time.Time `json:"deployedAt,omitempty"`
	CreatedAt  time.Time  `json:"createdAt"`
	UpdatedAt  time.Time  `json:"updatedAt"`
}

type SourceMapArtifact struct {
	ID           uuid.UUID               `json:"id"`
	ReleaseID    uuid.UUID               `json:"releaseId"`
	ArtifactName string                  `json:"artifactName"`
	OSSKey       string                  `json:"-"`
	SHA256       []byte                  `json:"-"`
	SizeBytes    int64                   `json:"sizeBytes"`
	Status       SourceMapArtifactStatus `json:"status"`
	ErrorMessage *string                 `json:"errorMessage,omitempty"`
	CreatedAt    time.Time               `json:"createdAt"`
	UpdatedAt    time.Time               `json:"updatedAt"`
}

type IssueState struct {
	ProjectID          uuid.UUID   `json:"projectId"`
	Fingerprint        string      `json:"fingerprint"`
	FingerprintVersion int16       `json:"fingerprintVersion"`
	Status             IssueStatus `json:"status"`
	AssigneeUserID     *uuid.UUID  `json:"assigneeUserId,omitempty"`
	ResolvedInRelease  *uuid.UUID  `json:"resolvedInReleaseId,omitempty"`
	CreatedAt          time.Time   `json:"createdAt"`
	UpdatedAt          time.Time   `json:"updatedAt"`
}

type IssueRepository struct{ database *sql.DB }

func NewIssueRepository(database *sql.DB) *IssueRepository {
	return &IssueRepository{database: database}
}

func (repository *IssueRepository) CreateRelease(ctx context.Context, release Release) (Release, error) {
	if release.ID == uuid.Nil {
		release.ID = uuid.New()
	}
	err := repository.database.QueryRowContext(ctx,
		`INSERT INTO releases (id, project_id, version, dist, commit_sha, deployed_at)
		 VALUES ($1,$2,$3,$4,$5,$6)
		 RETURNING created_at, updated_at`,
		release.ID, release.ProjectID, release.Version, release.Dist, release.CommitSHA, release.DeployedAt,
	).Scan(&release.CreatedAt, &release.UpdatedAt)
	if err != nil {
		return Release{}, translateConstraintError(err)
	}
	return release, nil
}

func (repository *IssueRepository) CreateReleaseForActor(ctx context.Context, actorID uuid.UUID, release Release) (Release, error) {
	transaction, err := repository.database.BeginTx(ctx, nil)
	if err != nil {
		return Release{}, err
	}
	defer func() { _ = transaction.Rollback() }()
	if release.ID == uuid.Nil {
		release.ID = uuid.New()
	}
	var organizationID uuid.UUID
	err = transaction.QueryRowContext(ctx,
		`INSERT INTO releases (id, project_id, version, dist, commit_sha, deployed_at)
		 VALUES ($1,$2,$3,$4,$5,$6)
		 RETURNING (SELECT organization_id FROM projects WHERE id=$2), created_at, updated_at`,
		release.ID, release.ProjectID, release.Version, release.Dist, release.CommitSHA, release.DeployedAt,
	).Scan(&organizationID, &release.CreatedAt, &release.UpdatedAt)
	if err != nil {
		return Release{}, translateConstraintError(err)
	}
	if err := insertAudit(ctx, transaction, organizationID, actorID, "release.created", "release", release.ID); err != nil {
		return Release{}, err
	}
	if err := transaction.Commit(); err != nil {
		return Release{}, err
	}
	return release, nil
}

func (repository *IssueRepository) CreateArtifact(ctx context.Context, artifact SourceMapArtifact) (SourceMapArtifact, error) {
	if artifact.ID == uuid.Nil {
		artifact.ID = uuid.New()
	}
	if artifact.Status == "" {
		artifact.Status = ArtifactStatusPending
	}
	err := repository.database.QueryRowContext(ctx,
		`INSERT INTO sourcemap_artifacts
		 (id, release_id, artifact_name, oss_key, sha256, size_bytes, status, error_message)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		 RETURNING created_at, updated_at`,
		artifact.ID, artifact.ReleaseID, artifact.ArtifactName, artifact.OSSKey, artifact.SHA256,
		artifact.SizeBytes, artifact.Status, artifact.ErrorMessage,
	).Scan(&artifact.CreatedAt, &artifact.UpdatedAt)
	if err != nil {
		return SourceMapArtifact{}, translateConstraintError(err)
	}
	return artifact, nil
}

func (repository *IssueRepository) GetRelease(ctx context.Context, projectID, releaseID uuid.UUID) (Release, error) {
	var release Release
	err := repository.database.QueryRowContext(ctx,
		`SELECT id, project_id, version, dist, commit_sha, deployed_at, created_at, updated_at
		 FROM releases WHERE id=$1 AND project_id=$2`, releaseID, projectID,
	).Scan(&release.ID, &release.ProjectID, &release.Version, &release.Dist, &release.CommitSHA,
		&release.DeployedAt, &release.CreatedAt, &release.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Release{}, ErrNotFound
	}
	return release, err
}

func (repository *IssueRepository) ListReleases(ctx context.Context, projectID uuid.UUID, limit int) ([]Release, error) {
	if limit < 1 || limit > 100 {
		limit = 50
	}
	rows, err := repository.database.QueryContext(ctx,
		`SELECT id, project_id, version, dist, commit_sha, deployed_at, created_at, updated_at
		 FROM releases WHERE project_id=$1 ORDER BY created_at DESC, id DESC LIMIT $2`, projectID, limit)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	releases := make([]Release, 0)
	for rows.Next() {
		var release Release
		if err := rows.Scan(&release.ID, &release.ProjectID, &release.Version, &release.Dist, &release.CommitSHA,
			&release.DeployedAt, &release.CreatedAt, &release.UpdatedAt); err != nil {
			return nil, err
		}
		releases = append(releases, release)
	}
	return releases, rows.Err()
}

func (repository *IssueRepository) GetArtifact(ctx context.Context, projectID, releaseID, artifactID uuid.UUID) (SourceMapArtifact, error) {
	var artifact SourceMapArtifact
	err := repository.database.QueryRowContext(ctx,
		`SELECT a.id, a.release_id, a.artifact_name, a.oss_key, a.sha256, a.size_bytes,
		        a.status, a.error_message, a.created_at, a.updated_at
		 FROM sourcemap_artifacts a JOIN releases r ON r.id=a.release_id
		 WHERE a.id=$1 AND a.release_id=$2 AND r.project_id=$3`, artifactID, releaseID, projectID,
	).Scan(&artifact.ID, &artifact.ReleaseID, &artifact.ArtifactName, &artifact.OSSKey, &artifact.SHA256,
		&artifact.SizeBytes, &artifact.Status, &artifact.ErrorMessage, &artifact.CreatedAt, &artifact.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return SourceMapArtifact{}, ErrNotFound
	}
	return artifact, err
}

func (repository *IssueRepository) ListArtifacts(ctx context.Context, projectID, releaseID uuid.UUID) ([]SourceMapArtifact, error) {
	rows, err := repository.database.QueryContext(ctx,
		`SELECT a.id, a.release_id, a.artifact_name, a.oss_key, a.sha256, a.size_bytes,
		        a.status, a.error_message, a.created_at, a.updated_at
		 FROM sourcemap_artifacts a JOIN releases r ON r.id=a.release_id
		 WHERE a.release_id=$1 AND r.project_id=$2 ORDER BY a.created_at DESC`, releaseID, projectID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	artifacts := make([]SourceMapArtifact, 0)
	for rows.Next() {
		var artifact SourceMapArtifact
		if err := rows.Scan(&artifact.ID, &artifact.ReleaseID, &artifact.ArtifactName, &artifact.OSSKey, &artifact.SHA256,
			&artifact.SizeBytes, &artifact.Status, &artifact.ErrorMessage, &artifact.CreatedAt, &artifact.UpdatedAt); err != nil {
			return nil, err
		}
		artifacts = append(artifacts, artifact)
	}
	return artifacts, rows.Err()
}

func (repository *IssueRepository) SetArtifactStatus(ctx context.Context, projectID, releaseID, artifactID uuid.UUID, status SourceMapArtifactStatus, message *string) (SourceMapArtifact, error) {
	var artifact SourceMapArtifact
	err := repository.database.QueryRowContext(ctx,
		`UPDATE sourcemap_artifacts a SET status=$1, error_message=$2, updated_at=now()
		 FROM releases r WHERE a.release_id=r.id AND a.id=$3 AND a.release_id=$4 AND r.project_id=$5
		 RETURNING a.id, a.release_id, a.artifact_name, a.oss_key, a.sha256, a.size_bytes,
		           a.status, a.error_message, a.created_at, a.updated_at`,
		status, message, artifactID, releaseID, projectID,
	).Scan(&artifact.ID, &artifact.ReleaseID, &artifact.ArtifactName, &artifact.OSSKey, &artifact.SHA256,
		&artifact.SizeBytes, &artifact.Status, &artifact.ErrorMessage, &artifact.CreatedAt, &artifact.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return SourceMapArtifact{}, ErrNotFound
	}
	return artifact, err
}

func (repository *IssueRepository) DeleteArtifact(ctx context.Context, actorID, projectID, releaseID, artifactID uuid.UUID) error {
	transaction, err := repository.database.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = transaction.Rollback() }()
	var organizationID uuid.UUID
	err = transaction.QueryRowContext(ctx,
		`DELETE FROM sourcemap_artifacts a USING releases r, projects p
		 WHERE a.id=$1 AND a.release_id=$2 AND a.release_id=r.id AND r.project_id=$3
		   AND p.id=r.project_id RETURNING p.organization_id`, artifactID, releaseID, projectID).Scan(&organizationID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if err := insertAudit(ctx, transaction, organizationID, actorID, "sourcemap.deleted", "sourcemap_artifact", artifactID); err != nil {
		return err
	}
	return transaction.Commit()
}

func (repository *IssueRepository) PutIssueState(ctx context.Context, state IssueState) (IssueState, error) {
	if state.Status == "" {
		state.Status = IssueStatusUnresolved
	}
	err := repository.database.QueryRowContext(ctx,
		`INSERT INTO issue_states
		 (project_id, fingerprint, fingerprint_version, status, assignee_user_id, resolved_in_release_id)
		 VALUES ($1,$2,$3,$4,$5,$6)
		 ON CONFLICT (project_id, fingerprint) DO UPDATE SET
		   fingerprint_version=EXCLUDED.fingerprint_version, status=EXCLUDED.status,
		   assignee_user_id=EXCLUDED.assignee_user_id,
		   resolved_in_release_id=EXCLUDED.resolved_in_release_id, updated_at=now()
		 RETURNING created_at, updated_at`,
		state.ProjectID, state.Fingerprint, state.FingerprintVersion, state.Status,
		state.AssigneeUserID, state.ResolvedInRelease,
	).Scan(&state.CreatedAt, &state.UpdatedAt)
	if err != nil {
		return IssueState{}, translateConstraintError(err)
	}
	return state, nil
}

func (repository *IssueRepository) GetIssueState(ctx context.Context, projectID uuid.UUID, fingerprint string) (IssueState, error) {
	var state IssueState
	err := repository.database.QueryRowContext(ctx,
		`SELECT project_id, fingerprint, fingerprint_version, status, assignee_user_id,
		        resolved_in_release_id, created_at, updated_at
		 FROM issue_states WHERE project_id=$1 AND fingerprint=$2`, projectID, fingerprint,
	).Scan(&state.ProjectID, &state.Fingerprint, &state.FingerprintVersion, &state.Status,
		&state.AssigneeUserID, &state.ResolvedInRelease, &state.CreatedAt, &state.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return IssueState{}, ErrNotFound
	}
	return state, err
}

func (repository *IssueRepository) ListIssueStates(ctx context.Context, projectID uuid.UUID, fingerprints []string) (map[string]IssueState, error) {
	states := make(map[string]IssueState, len(fingerprints))
	if len(fingerprints) == 0 {
		return states, nil
	}
	rows, err := repository.database.QueryContext(ctx,
		`SELECT project_id, fingerprint, fingerprint_version, status, assignee_user_id,
		        resolved_in_release_id, created_at, updated_at
		 FROM issue_states WHERE project_id=$1 AND fingerprint=ANY($2)`, projectID, fingerprints)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var state IssueState
		if err := rows.Scan(&state.ProjectID, &state.Fingerprint, &state.FingerprintVersion, &state.Status,
			&state.AssigneeUserID, &state.ResolvedInRelease, &state.CreatedAt, &state.UpdatedAt); err != nil {
			return nil, err
		}
		states[state.Fingerprint] = state
	}
	return states, rows.Err()
}

func (repository *IssueRepository) MutateIssueState(ctx context.Context, actorID uuid.UUID, state IssueState) (IssueState, error) {
	transaction, err := repository.database.BeginTx(ctx, nil)
	if err != nil {
		return IssueState{}, err
	}
	defer func() { _ = transaction.Rollback() }()
	var organizationID uuid.UUID
	if err := transaction.QueryRowContext(ctx, "SELECT organization_id FROM projects WHERE id=$1 FOR UPDATE", state.ProjectID).Scan(&organizationID); errors.Is(err, sql.ErrNoRows) {
		return IssueState{}, ErrNotFound
	} else if err != nil {
		return IssueState{}, err
	}
	if state.AssigneeUserID != nil {
		var member bool
		if err := transaction.QueryRowContext(ctx,
			"SELECT EXISTS(SELECT 1 FROM organization_members WHERE organization_id=$1 AND user_id=$2)",
			organizationID, *state.AssigneeUserID).Scan(&member); err != nil {
			return IssueState{}, err
		}
		if !member {
			return IssueState{}, ErrNotFound
		}
	}
	if state.ResolvedInRelease != nil {
		var matches bool
		if err := transaction.QueryRowContext(ctx,
			"SELECT EXISTS(SELECT 1 FROM releases WHERE id=$1 AND project_id=$2)",
			*state.ResolvedInRelease, state.ProjectID).Scan(&matches); err != nil {
			return IssueState{}, err
		}
		if !matches {
			return IssueState{}, ErrNotFound
		}
	}
	err = transaction.QueryRowContext(ctx,
		`INSERT INTO issue_states
		 (project_id, fingerprint, fingerprint_version, status, assignee_user_id, resolved_in_release_id)
		 VALUES ($1,$2,$3,$4,$5,$6)
		 ON CONFLICT (project_id, fingerprint) DO UPDATE SET
		   fingerprint_version=EXCLUDED.fingerprint_version, status=EXCLUDED.status,
		   assignee_user_id=EXCLUDED.assignee_user_id,
		   resolved_in_release_id=EXCLUDED.resolved_in_release_id, updated_at=now()
		 RETURNING created_at, updated_at`,
		state.ProjectID, state.Fingerprint, state.FingerprintVersion, state.Status,
		state.AssigneeUserID, state.ResolvedInRelease,
	).Scan(&state.CreatedAt, &state.UpdatedAt)
	if err != nil {
		return IssueState{}, translateConstraintError(err)
	}
	if err := insertAudit(ctx, transaction, organizationID, actorID, "issue.state_updated", "issue", state.ProjectID); err != nil {
		return IssueState{}, err
	}
	if err := transaction.Commit(); err != nil {
		return IssueState{}, err
	}
	return state, nil
}
