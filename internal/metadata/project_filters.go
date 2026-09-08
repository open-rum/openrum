package metadata

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"

	"openrum/internal/filter"
)

// ProjectFilterRepository reads and writes a project's inbound filter
// settings.
//
// The settings are kept out of the shared Project struct on purpose. Every
// ingest request authenticates a write key, and that lookup already selects the
// project row; adding a JSON document to it would make the hot path decode
// rules that only the consumer ever evaluates.
type ProjectFilterRepository struct{ database *sql.DB }

func NewProjectFilterRepository(database *sql.DB) *ProjectFilterRepository {
	return &ProjectFilterRepository{database: database}
}

// Get returns the stored settings for a project. A project that has never been
// configured returns empty settings, which filter nothing.
func (repository *ProjectFilterRepository) Get(ctx context.Context, projectID uuid.UUID) (filter.Settings, error) {
	document, err := readProjectDocument(ctx, repository.database, projectID, columnInboundFilters)
	if err != nil {
		return filter.Settings{}, err
	}
	return decodeFilterSettings(document)
}

// Update replaces the settings for a project.
//
// The SDK config version is bumped on every write because the settings are
// served to browsers through /api/v1/sdk/config. Without the bump a client
// would keep enforcing the previous rules until its cache expired, and an
// operator undoing a mistake would have no way to tell whether it had taken
// effect.
func (repository *ProjectFilterRepository) Update(
	ctx context.Context,
	actorID, projectID uuid.UUID,
	settings filter.Settings,
) (filter.Settings, error) {
	if err := settings.Validate(); err != nil {
		return filter.Settings{}, err
	}
	document, err := json.Marshal(settings)
	if err != nil {
		return filter.Settings{}, err
	}
	stored, err := writeProjectDocument(ctx, repository.database, actorID, projectID,
		columnInboundFilters, document, "project.inbound_filters.updated", true)
	if err != nil {
		return filter.Settings{}, err
	}
	return decodeFilterSettings(stored)
}

// decodeFilterSettings tolerates a NULL or empty document so a project created
// before the column existed reads as unconfigured rather than as an error.
func decodeFilterSettings(document []byte) (filter.Settings, error) {
	if len(document) == 0 {
		return filter.Settings{}, nil
	}
	var settings filter.Settings
	if err := json.Unmarshal(document, &settings); err != nil {
		return filter.Settings{}, fmt.Errorf("decode inbound filters: %w", err)
	}
	return settings, nil
}
