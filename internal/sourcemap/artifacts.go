package sourcemap

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"

	"github.com/google/uuid"
)

type Artifact struct {
	ID           uuid.UUID
	ProjectID    uuid.UUID
	Release      string
	Dist         string
	ArtifactName string
	OSSKey       string
	SHA256       []byte
	SizeBytes    int64
}

type ArtifactFinder interface {
	Find(context.Context, uuid.UUID, string, string, string) (Artifact, error)
}

type ArtifactCatalog struct{ database *sql.DB }

func NewArtifactCatalog(database *sql.DB) *ArtifactCatalog {
	return &ArtifactCatalog{database: database}
}

func (catalog *ArtifactCatalog) Find(ctx context.Context, projectID uuid.UUID, release, dist, generatedURL string) (Artifact, error) {
	rows, err := catalog.database.QueryContext(ctx,
		`SELECT a.id, r.project_id, r.version, r.dist, a.artifact_name, a.oss_key, a.sha256, a.size_bytes
		 FROM sourcemap_artifacts a JOIN releases r ON r.id=a.release_id
		 WHERE r.project_id=$1 AND r.version=$2 AND r.dist=$3 AND a.status='ready'`, projectID, release, dist)
	if err != nil {
		return Artifact{}, err
	}
	defer func() { _ = rows.Close() }()
	artifacts := make(map[string]Artifact)
	candidates := make([]ArtifactCandidate, 0)
	for rows.Next() {
		var artifact Artifact
		if err := rows.Scan(&artifact.ID, &artifact.ProjectID, &artifact.Release, &artifact.Dist, &artifact.ArtifactName,
			&artifact.OSSKey, &artifact.SHA256, &artifact.SizeBytes); err != nil {
			return Artifact{}, err
		}
		key := artifact.ID.String()
		artifacts[key] = artifact
		candidates = append(candidates, ArtifactCandidate{ID: key, Release: artifact.Release, Dist: artifact.Dist, ArtifactName: artifact.ArtifactName})
	}
	if err := rows.Err(); err != nil {
		return Artifact{}, err
	}
	matched, err := MatchArtifact(candidates, release, dist, generatedURL)
	if err != nil {
		return Artifact{}, err
	}
	return artifacts[matched.ID], nil
}

func ArtifactCacheKey(artifact Artifact) string {
	if len(artifact.SHA256) == 0 {
		return artifact.ID.String()
	}
	return hex.EncodeToString(artifact.SHA256)
}

func ValidateArtifactBytes(artifact Artifact, contents []byte) error {
	digest := sha256.Sum256(contents)
	if artifact.SizeBytes != int64(len(contents)) || !bytes.Equal(artifact.SHA256, digest[:]) {
		return &ResolveError{Code: FailureInvalidMap, Err: errors.New("artifact size changed")}
	}
	return nil
}
