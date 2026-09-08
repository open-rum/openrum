package metadata

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/google/uuid"
)

// projectDocumentColumn names a JSON settings column on the projects table.
//
// The type is a closed set of constants declared in this package so the name
// can be interpolated into a statement. No request value ever reaches it, which
// is what makes the interpolation safe; a string parameter here would put that
// guarantee in every caller instead of in one place.
type projectDocumentColumn string

const (
	columnInboundFilters projectDocumentColumn = "inbound_filters"
	columnURLRules       projectDocumentColumn = "url_rules"
	columnScrubRules     projectDocumentColumn = "scrub_rules"
)

// readProjectDocument returns one settings document. A project that has never
// been configured returns an empty document, which every caller decodes as
// unconfigured.
func readProjectDocument(
	ctx context.Context,
	database *sql.DB,
	projectID uuid.UUID,
	column projectDocumentColumn,
) ([]byte, error) {
	var document []byte
	query := fmt.Sprintf("SELECT %s FROM projects WHERE id=$1 AND status!='deleting'", column)
	err := database.QueryRowContext(ctx, query, projectID).Scan(&document)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return document, nil
}

// writeProjectDocument replaces one settings document under the organization
// lock, after checking that the actor may manage project settings, and records
// an audit entry. It returns the stored document so the caller answers with
// what the database now holds rather than with what it sent.
//
// bumpSDKConfig is set only by settings a browser acts on. Bumping the version
// makes every SDK refetch, so doing it for settings the SDK never sees would
// cost a round trip from every session for a change none of them can use.
func writeProjectDocument(
	ctx context.Context,
	database *sql.DB,
	actorID, projectID uuid.UUID,
	column projectDocumentColumn,
	document []byte,
	auditAction string,
	bumpSDKConfig bool,
) ([]byte, error) {
	transaction, err := database.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = transaction.Rollback() }()

	var organizationID uuid.UUID
	err = transaction.QueryRowContext(ctx,
		"SELECT organization_id FROM projects WHERE id=$1 AND status!='deleting'", projectID).Scan(&organizationID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if err := lockOrganization(ctx, transaction, organizationID); err != nil {
		return nil, err
	}
	actorRole, err := lockMembership(ctx, transaction, organizationID, actorID)
	if err != nil {
		return nil, err
	}
	if !canManageProjectSettings(actorRole) {
		return nil, ErrForbidden
	}

	sdkConfig := ""
	if bumpSDKConfig {
		sdkConfig = "sdk_config_version=sdk_config_version+1, sdk_config_effective_at=now(),"
	}
	var stored []byte
	query := fmt.Sprintf(`UPDATE projects SET %s=$1, %s updated_at=now()
		 WHERE id=$2 RETURNING %s`, column, sdkConfig, column)
	err = transaction.QueryRowContext(ctx, query, document, projectID).Scan(&stored)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if err := insertAudit(ctx, transaction, organizationID, actorID, auditAction, "project", projectID); err != nil {
		return nil, err
	}
	if err := transaction.Commit(); err != nil {
		return nil, err
	}
	return stored, nil
}
