package metadata

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"

	"openrum/internal/capture"
)

// ProjectCaptureRepository reads and writes the rules that opt an API in to
// header capture.
//
// Like the inbound filters these are kept off the Project struct: only the
// consumer and the SDK config endpoint read them, and the ingest hot path that
// loads the project row should not decode a document it never uses.
type ProjectCaptureRepository struct{ database *sql.DB }

func NewProjectCaptureRepository(database *sql.DB) *ProjectCaptureRepository {
	return &ProjectCaptureRepository{database: database}
}

// Get returns the stored rules. A project that never opted in returns empty
// settings, which capture nothing.
func (repository *ProjectCaptureRepository) Get(ctx context.Context, projectID uuid.UUID) (capture.Settings, error) {
	document, err := readProjectDocument(ctx, repository.database, projectID, columnAPICapture)
	if err != nil {
		return capture.Settings{}, err
	}
	return decodeCaptureSettings(document)
}

// Update replaces the rules for a project.
//
// The SDK config version is bumped because browsers act on these rules: without
// it a browser would keep reading headers for an endpoint the project had just
// switched off until its cached configuration expired.
func (repository *ProjectCaptureRepository) Update(
	ctx context.Context,
	actorID, projectID uuid.UUID,
	settings capture.Settings,
) (capture.Settings, error) {
	settings = settings.Normalize()
	if err := settings.Validate(); err != nil {
		return capture.Settings{}, err
	}
	document, err := json.Marshal(settings)
	if err != nil {
		return capture.Settings{}, err
	}
	stored, err := writeProjectDocument(ctx, repository.database, actorID, projectID,
		columnAPICapture, document, "project.api_capture_rules.updated", true)
	if err != nil {
		return capture.Settings{}, err
	}
	return decodeCaptureSettings(stored)
}

// decodeCaptureSettings tolerates a NULL or empty document so a project created
// before the column existed reads as unconfigured rather than as an error.
func decodeCaptureSettings(document []byte) (capture.Settings, error) {
	if len(document) == 0 {
		return capture.Settings{}, nil
	}
	var settings capture.Settings
	if err := json.Unmarshal(document, &settings); err != nil {
		return capture.Settings{}, fmt.Errorf("decode API capture rules: %w", err)
	}
	return settings, nil
}
