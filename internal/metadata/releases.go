package metadata

import (
	"context"
	"database/sql"
	"encoding/base64"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
)

var ErrInvalidReleaseCursor = errors.New("invalid release cursor")

const releaseSelect = `SELECT r.id, r.project_id, r.version, r.dist, r.commit_sha, r.deployed_at, r.created_at, r.updated_at,
	(SELECT count(*) FROM sourcemap_artifacts a WHERE a.release_id=r.id),
	(SELECT count(*) FROM sourcemap_artifacts a WHERE a.release_id=r.id AND a.status='ready')
	FROM releases r`

func scanRelease(row rowScanner) (Release, error) {
	var release Release
	err := row.Scan(&release.ID, &release.ProjectID, &release.Version, &release.Dist, &release.CommitSHA,
		&release.DeployedAt, &release.CreatedAt, &release.UpdatedAt, &release.ArtifactCount, &release.ReadyCount)
	if errors.Is(err, sql.ErrNoRows) {
		return Release{}, ErrNotFound
	}
	return release, err
}

type ReleaseListOptions struct {
	Limit  int
	Cursor string
	// Query is a case-insensitive substring of the version.
	Query string
}

type ReleasePage struct {
	Releases   []Release `json:"releases"`
	NextCursor *string   `json:"nextCursor"`
}

// ListReleases pages newest first by (created_at, id). The cursor is opaque to
// clients; it encodes the last row's sort key so pages stay stable while new
// releases are created.
func (repository *IssueRepository) ListReleases(ctx context.Context, projectID uuid.UUID, options ReleaseListOptions) (ReleasePage, error) {
	limit := options.Limit
	if limit < 1 || limit > 100 {
		limit = 20
	}
	var afterTime *time.Time
	var afterID *uuid.UUID
	if options.Cursor != "" {
		createdAt, id, err := decodeReleaseCursor(options.Cursor)
		if err != nil {
			return ReleasePage{}, err
		}
		afterTime, afterID = &createdAt, &id
	}
	rows, err := repository.database.QueryContext(ctx, releaseSelect+`
		WHERE r.project_id=$1
		  AND ($2='' OR r.version ILIKE '%' || $2 || '%' ESCAPE '\')
		  AND ($3::timestamptz IS NULL OR (r.created_at, r.id) < ($3::timestamptz, $4::uuid))
		ORDER BY r.created_at DESC, r.id DESC LIMIT $5`,
		projectID, escapeLike(options.Query), afterTime, afterID, limit+1)
	if err != nil {
		return ReleasePage{}, err
	}
	defer func() { _ = rows.Close() }()
	page := ReleasePage{Releases: make([]Release, 0, limit)}
	for rows.Next() {
		release, err := scanRelease(rows)
		if err != nil {
			return ReleasePage{}, err
		}
		page.Releases = append(page.Releases, release)
	}
	if err := rows.Err(); err != nil {
		return ReleasePage{}, err
	}
	if len(page.Releases) > limit {
		page.Releases = page.Releases[:limit]
		last := page.Releases[limit-1]
		cursor := encodeReleaseCursor(last.CreatedAt, last.ID)
		page.NextCursor = &cursor
	}
	return page, nil
}

func encodeReleaseCursor(createdAt time.Time, id uuid.UUID) string {
	return base64.RawURLEncoding.EncodeToString([]byte(createdAt.UTC().Format(time.RFC3339Nano) + "|" + id.String()))
}

func decodeReleaseCursor(value string) (time.Time, uuid.UUID, error) {
	decoded, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		return time.Time{}, uuid.Nil, ErrInvalidReleaseCursor
	}
	rawTime, rawID, found := strings.Cut(string(decoded), "|")
	createdAt, timeErr := time.Parse(time.RFC3339Nano, rawTime)
	id, idErr := uuid.Parse(rawID)
	if !found || timeErr != nil || idErr != nil {
		return time.Time{}, uuid.Nil, ErrInvalidReleaseCursor
	}
	return createdAt, id, nil
}

func escapeLike(value string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(value)
}

// DeleteRelease removes the release row; artifacts cascade and issue states
// that referenced it keep their status with the release cleared. Callers delete
// the artifact objects first so no stored object outlives its catalog row.
func (repository *IssueRepository) DeleteRelease(ctx context.Context, actorID, projectID, releaseID uuid.UUID) error {
	transaction, err := repository.database.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = transaction.Rollback() }()
	var organizationID uuid.UUID
	err = transaction.QueryRowContext(ctx,
		`DELETE FROM releases r USING projects p
		 WHERE r.id=$1 AND r.project_id=$2 AND p.id=r.project_id RETURNING p.organization_id`, releaseID, projectID).Scan(&organizationID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if err := insertAudit(ctx, transaction, organizationID, actorID, "release.deleted", "release", releaseID); err != nil {
		return err
	}
	return transaction.Commit()
}

func (repository *IssueRepository) GetArtifactByName(ctx context.Context, projectID, releaseID uuid.UUID, name string) (SourceMapArtifact, error) {
	var artifact SourceMapArtifact
	err := repository.database.QueryRowContext(ctx,
		`SELECT a.id, a.release_id, a.artifact_name, a.oss_key, a.sha256, a.size_bytes,
		        a.status, a.error_message, a.created_at, a.updated_at
		 FROM sourcemap_artifacts a JOIN releases r ON r.id=a.release_id
		 WHERE a.release_id=$1 AND r.project_id=$2 AND a.artifact_name=$3`, releaseID, projectID, name,
	).Scan(&artifact.ID, &artifact.ReleaseID, &artifact.ArtifactName, &artifact.OSSKey, &artifact.SHA256,
		&artifact.SizeBytes, &artifact.Status, &artifact.ErrorMessage, &artifact.CreatedAt, &artifact.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return SourceMapArtifact{}, ErrNotFound
	}
	return artifact, err
}

// RemoveArtifact drops an artifact row that an upload is replacing. It is not
// audited: replacement is part of an upload, not a user deletion.
func (repository *IssueRepository) RemoveArtifact(ctx context.Context, projectID, releaseID, artifactID uuid.UUID) error {
	result, err := repository.database.ExecContext(ctx,
		`DELETE FROM sourcemap_artifacts a USING releases r
		 WHERE a.id=$1 AND a.release_id=$2 AND a.release_id=r.id AND r.project_id=$3`, artifactID, releaseID, projectID)
	if err != nil {
		return err
	}
	if affected, err := result.RowsAffected(); err == nil && affected == 0 {
		return ErrNotFound
	}
	return nil
}
