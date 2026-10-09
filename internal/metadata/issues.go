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
	// IssueStatusRegressed is derived, never stored: a resolved Issue that failed again after
	// it was resolved. Only reads and filters use it; writes accept the three stored states.
	IssueStatusRegressed IssueStatus = "regressed"

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
	// ArtifactCount and ReadyCount let the Console show upload completeness
	// without listing every artifact of every release.
	ArtifactCount int `json:"artifactCount"`
	ReadyCount    int `json:"readyCount"`
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
	// ResolvedAt is when the Issue was last marked resolved; nil on a write that resolves
	// lets the database use now(), and it is nil for every other status.
	ResolvedAt *time.Time `json:"resolvedAt,omitempty"`
	CreatedAt  time.Time  `json:"createdAt"`
	UpdatedAt  time.Time  `json:"updatedAt"`
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

// CreateReleaseForActor creates the release or returns the existing one with
// the same version and dist, so repeated builds can rerun their upload step.
// created reports which happened; only a new release is audited.
func (repository *IssueRepository) CreateReleaseForActor(ctx context.Context, actorID uuid.UUID, release Release) (Release, bool, error) {
	transaction, err := repository.database.BeginTx(ctx, nil)
	if err != nil {
		return Release{}, false, err
	}
	defer func() { _ = transaction.Rollback() }()
	if release.ID == uuid.Nil {
		release.ID = uuid.New()
	}
	var organizationID uuid.UUID
	if err := transaction.QueryRowContext(ctx, "SELECT organization_id FROM projects WHERE id=$1", release.ProjectID).Scan(&organizationID); errors.Is(err, sql.ErrNoRows) {
		return Release{}, false, ErrNotFound
	} else if err != nil {
		return Release{}, false, err
	}
	var insertedID uuid.UUID
	err = transaction.QueryRowContext(ctx,
		`INSERT INTO releases (id, project_id, version, dist, commit_sha, deployed_at)
		 VALUES ($1,$2,$3,$4,$5,$6)
		 ON CONFLICT (project_id, version, dist) DO NOTHING
		 RETURNING id`,
		release.ID, release.ProjectID, release.Version, release.Dist, release.CommitSHA, release.DeployedAt,
	).Scan(&insertedID)
	created := err == nil
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return Release{}, false, translateConstraintError(err)
	}
	stored, err := scanRelease(transaction.QueryRowContext(ctx,
		releaseSelect+` WHERE r.project_id=$1 AND r.version=$2 AND r.dist=$3`, release.ProjectID, release.Version, release.Dist))
	if err != nil {
		return Release{}, false, err
	}
	if created {
		if err := insertAudit(ctx, transaction, organizationID, actorID, "release.created", "release", stored.ID); err != nil {
			return Release{}, false, err
		}
	}
	if err := transaction.Commit(); err != nil {
		return Release{}, false, err
	}
	return stored, created, nil
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
	return scanRelease(repository.database.QueryRowContext(ctx, releaseSelect+` WHERE r.id=$1 AND r.project_id=$2`, releaseID, projectID))
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
		 (project_id, fingerprint, fingerprint_version, status, assignee_user_id, resolved_in_release_id, resolved_at)
		 VALUES ($1,$2,$3,$4,$5,$6, CASE WHEN $8::boolean THEN COALESCE($7::timestamptz, now()) END)
		 ON CONFLICT (project_id, fingerprint) DO UPDATE SET
		   fingerprint_version=EXCLUDED.fingerprint_version, status=EXCLUDED.status,
		   assignee_user_id=EXCLUDED.assignee_user_id,
		   resolved_in_release_id=EXCLUDED.resolved_in_release_id,
		   resolved_at=EXCLUDED.resolved_at, updated_at=now()
		 RETURNING resolved_at, created_at, updated_at`,
		state.ProjectID, state.Fingerprint, state.FingerprintVersion, state.Status,
		state.AssigneeUserID, state.ResolvedInRelease, state.ResolvedAt, state.Status == IssueStatusResolved,
	).Scan(&state.ResolvedAt, &state.CreatedAt, &state.UpdatedAt)
	if err != nil {
		return IssueState{}, translateConstraintError(err)
	}
	return state, nil
}

func (repository *IssueRepository) GetIssueState(ctx context.Context, projectID uuid.UUID, fingerprint string) (IssueState, error) {
	var state IssueState
	err := repository.database.QueryRowContext(ctx,
		`SELECT project_id, fingerprint, fingerprint_version, status, assignee_user_id,
		        resolved_in_release_id, resolved_at, created_at, updated_at
		 FROM issue_states WHERE project_id=$1 AND fingerprint=$2`, projectID, fingerprint,
	).Scan(&state.ProjectID, &state.Fingerprint, &state.FingerprintVersion, &state.Status,
		&state.AssigneeUserID, &state.ResolvedInRelease, &state.ResolvedAt, &state.CreatedAt, &state.UpdatedAt)
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
		        resolved_in_release_id, resolved_at, created_at, updated_at
		 FROM issue_states WHERE project_id=$1 AND fingerprint=ANY($2)`, projectID, fingerprints)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var state IssueState
		if err := rows.Scan(&state.ProjectID, &state.Fingerprint, &state.FingerprintVersion, &state.Status,
			&state.AssigneeUserID, &state.ResolvedInRelease, &state.ResolvedAt, &state.CreatedAt, &state.UpdatedAt); err != nil {
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
		 (project_id, fingerprint, fingerprint_version, status, assignee_user_id, resolved_in_release_id, resolved_at)
		 VALUES ($1,$2,$3,$4,$5,$6, CASE WHEN $8::boolean THEN COALESCE($7::timestamptz, now()) END)
		 ON CONFLICT (project_id, fingerprint) DO UPDATE SET
		   fingerprint_version=EXCLUDED.fingerprint_version, status=EXCLUDED.status,
		   assignee_user_id=EXCLUDED.assignee_user_id,
		   resolved_in_release_id=EXCLUDED.resolved_in_release_id,
		   resolved_at=EXCLUDED.resolved_at, updated_at=now()
		 RETURNING resolved_at, created_at, updated_at`,
		state.ProjectID, state.Fingerprint, state.FingerprintVersion, state.Status,
		state.AssigneeUserID, state.ResolvedInRelease, state.ResolvedAt, state.Status == IssueStatusResolved,
	).Scan(&state.ResolvedAt, &state.CreatedAt, &state.UpdatedAt)
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

// IssueRef names one Issue of a project by fingerprint.
type IssueRef struct {
	Fingerprint        string
	FingerprintVersion int16
}

// IssueStatePatch is the part of an Issue's state a batch changes; fields left unset are kept.
type IssueStatePatch struct {
	Status *IssueStatus
	// SetAssignee distinguishes "clear the assignee" (true, nil) from "leave it" (false).
	SetAssignee    bool
	AssigneeUserID *uuid.UUID
}

// BatchMutateIssueStates applies one patch to several Issues in a single transaction and
// records one audit entry. Issues without a stored state get one.
func (repository *IssueRepository) BatchMutateIssueStates(ctx context.Context, actorID, projectID uuid.UUID, refs []IssueRef, patch IssueStatePatch) (int, error) {
	transaction, err := repository.database.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer func() { _ = transaction.Rollback() }()
	var organizationID uuid.UUID
	if err := transaction.QueryRowContext(ctx, "SELECT organization_id FROM projects WHERE id=$1 FOR UPDATE", projectID).Scan(&organizationID); errors.Is(err, sql.ErrNoRows) {
		return 0, ErrNotFound
	} else if err != nil {
		return 0, err
	}
	if patch.AssigneeUserID != nil {
		var member bool
		if err := transaction.QueryRowContext(ctx,
			"SELECT EXISTS(SELECT 1 FROM organization_members WHERE organization_id=$1 AND user_id=$2)",
			organizationID, *patch.AssigneeUserID).Scan(&member); err != nil {
			return 0, err
		}
		if !member {
			return 0, ErrNotFound
		}
	}
	status, setStatus := IssueStatusUnresolved, patch.Status != nil
	if setStatus {
		status = *patch.Status
	}
	statement, err := transaction.PrepareContext(ctx,
		`INSERT INTO issue_states
		 (project_id, fingerprint, fingerprint_version, status, assignee_user_id, resolved_at)
		 VALUES ($1,$2,$3,$4,$5, CASE WHEN $8::boolean THEN now() END)
		 ON CONFLICT (project_id, fingerprint) DO UPDATE SET
		   status = CASE WHEN $6::boolean THEN EXCLUDED.status ELSE issue_states.status END,
		   resolved_at = CASE WHEN $6::boolean THEN EXCLUDED.resolved_at ELSE issue_states.resolved_at END,
		   assignee_user_id = CASE WHEN $7::boolean THEN EXCLUDED.assignee_user_id ELSE issue_states.assignee_user_id END,
		   updated_at = now()`)
	if err != nil {
		return 0, err
	}
	defer func() { _ = statement.Close() }()
	for _, ref := range refs {
		if _, err := statement.ExecContext(ctx, projectID, ref.Fingerprint, ref.FingerprintVersion,
			status, patch.AssigneeUserID, setStatus, patch.SetAssignee, status == IssueStatusResolved); err != nil {
			return 0, translateConstraintError(err)
		}
	}
	if err := insertAudit(ctx, transaction, organizationID, actorID, "issue.states_updated", "project", projectID); err != nil {
		return 0, err
	}
	if err := transaction.Commit(); err != nil {
		return 0, err
	}
	return len(refs), nil
}

// ArtifactStorageUsage totals ready Source Map objects across the Instance.
type ArtifactStorageUsage struct {
	Count int64
	Bytes int64
}

func (repository *IssueRepository) ArtifactStorageUsage(ctx context.Context) (ArtifactStorageUsage, error) {
	var usage ArtifactStorageUsage
	err := repository.database.QueryRowContext(ctx,
		`SELECT count(*), COALESCE(sum(size_bytes), 0) FROM sourcemap_artifacts WHERE status='ready'`,
	).Scan(&usage.Count, &usage.Bytes)
	return usage, err
}
