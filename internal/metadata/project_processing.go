package metadata

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"

	"openrum/internal/processing"
)

// ProjectProcessingRepository reads and writes the rules the consumer applies
// to an event after normalization: how paths are collapsed for aggregation and
// what text is redacted before storage.
//
// Both documents are read in one statement because the consumer needs both for
// every message, and a second round trip per project would be paid on every
// cache miss for no gain.
type ProjectProcessingRepository struct{ database *sql.DB }

func NewProjectProcessingRepository(database *sql.DB) *ProjectProcessingRepository {
	return &ProjectProcessingRepository{database: database}
}

// Get returns both rule sets. A project that has never been configured returns
// empty rules, which rewrite nothing.
func (repository *ProjectProcessingRepository) Get(
	ctx context.Context,
	projectID uuid.UUID,
) (processing.Settings, error) {
	var urlDocument, scrubDocument []byte
	err := repository.database.QueryRowContext(ctx,
		"SELECT url_rules, scrub_rules FROM projects WHERE id=$1 AND status!='deleting'",
		projectID).Scan(&urlDocument, &scrubDocument)
	if errors.Is(err, sql.ErrNoRows) {
		return processing.Settings{}, ErrNotFound
	}
	if err != nil {
		return processing.Settings{}, err
	}
	settings := processing.Settings{}
	if err := decodeProcessingDocument(urlDocument, &settings.URL, "URL rules"); err != nil {
		return processing.Settings{}, err
	}
	if err := decodeProcessingDocument(scrubDocument, &settings.Scrub, "scrub rules"); err != nil {
		return processing.Settings{}, err
	}
	return settings, nil
}

// GetURLRules returns only the path templates, for the Console.
func (repository *ProjectProcessingRepository) GetURLRules(
	ctx context.Context,
	projectID uuid.UUID,
) (processing.URLRules, error) {
	document, err := readProjectDocument(ctx, repository.database, projectID, columnURLRules)
	if err != nil {
		return processing.URLRules{}, err
	}
	var rules processing.URLRules
	if err := decodeProcessingDocument(document, &rules, "URL rules"); err != nil {
		return processing.URLRules{}, err
	}
	return rules, nil
}

// UpdateURLRules replaces the path templates for a project.
//
// The SDK config version is deliberately not bumped. These rules are applied by
// the consumer alone, so no browser has anything to refetch, and making every
// session refetch on a change that cannot affect it would be a cost with no
// corresponding effect.
func (repository *ProjectProcessingRepository) UpdateURLRules(
	ctx context.Context,
	actorID, projectID uuid.UUID,
	rules processing.URLRules,
) (processing.URLRules, error) {
	if err := rules.Validate(); err != nil {
		return processing.URLRules{}, err
	}
	document, err := json.Marshal(rules)
	if err != nil {
		return processing.URLRules{}, err
	}
	stored, err := writeProjectDocument(ctx, repository.database, actorID, projectID,
		columnURLRules, document, "project.url_rules.updated", false)
	if err != nil {
		return processing.URLRules{}, err
	}
	var result processing.URLRules
	if err := decodeProcessingDocument(stored, &result, "URL rules"); err != nil {
		return processing.URLRules{}, err
	}
	return result, nil
}

// GetScrubRules returns only the redaction rules, for the Console.
func (repository *ProjectProcessingRepository) GetScrubRules(
	ctx context.Context,
	projectID uuid.UUID,
) (processing.ScrubRules, error) {
	document, err := readProjectDocument(ctx, repository.database, projectID, columnScrubRules)
	if err != nil {
		return processing.ScrubRules{}, err
	}
	var rules processing.ScrubRules
	if err := decodeProcessingDocument(document, &rules, "scrub rules"); err != nil {
		return processing.ScrubRules{}, err
	}
	return rules, nil
}

// UpdateScrubRules replaces the redaction rules for a project. As with the URL
// rules, only the consumer applies them, so no SDK configuration changes.
func (repository *ProjectProcessingRepository) UpdateScrubRules(
	ctx context.Context,
	actorID, projectID uuid.UUID,
	rules processing.ScrubRules,
) (processing.ScrubRules, error) {
	if err := rules.Validate(); err != nil {
		return processing.ScrubRules{}, err
	}
	document, err := json.Marshal(rules)
	if err != nil {
		return processing.ScrubRules{}, err
	}
	stored, err := writeProjectDocument(ctx, repository.database, actorID, projectID,
		columnScrubRules, document, "project.scrub_rules.updated", false)
	if err != nil {
		return processing.ScrubRules{}, err
	}
	var result processing.ScrubRules
	if err := decodeProcessingDocument(stored, &result, "scrub rules"); err != nil {
		return processing.ScrubRules{}, err
	}
	return result, nil
}

// decodeProcessingDocument tolerates a NULL or empty document so a project
// created before the columns existed reads as unconfigured rather than as an
// error.
func decodeProcessingDocument(document []byte, target any, subject string) error {
	if len(document) == 0 {
		return nil
	}
	if err := json.Unmarshal(document, target); err != nil {
		return fmt.Errorf("decode %s: %w", subject, err)
	}
	return nil
}
