package metadata

import (
	"context"
	"database/sql"
	"errors"

	"github.com/google/uuid"
)

// AvatarRepository keeps each person's profile picture reference.
type AvatarRepository struct{ database *sql.DB }

func NewAvatarRepository(database *sql.DB) *AvatarRepository {
	return &AvatarRepository{database: database}
}

// Set replaces the reference, or clears it when value is empty, and returns the one it
// replaced so the caller can remove an uploaded picture that is no longer used.
func (repository *AvatarRepository) Set(ctx context.Context, userID uuid.UUID, value string) (previous string, err error) {
	var stored any
	if value != "" {
		stored = value
	}
	err = repository.database.QueryRowContext(ctx,
		`WITH old AS (SELECT id, COALESCE(avatar, '') AS avatar FROM users WHERE id=$1 FOR UPDATE)
		 UPDATE users SET avatar=$2, updated_at=now() FROM old WHERE users.id=old.id
		 RETURNING old.avatar`, userID, stored).Scan(&previous)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	return previous, err
}

// Visible returns the reference of owner's picture if viewer may see it: their own, or
// that of someone who belongs to an organization they belong to. Anyone else, and an
// unknown user, is ErrNotFound, so the endpoint does not say who exists.
func (repository *AvatarRepository) Visible(ctx context.Context, viewerID, ownerID uuid.UUID) (string, error) {
	var value string
	err := repository.database.QueryRowContext(ctx,
		`SELECT COALESCE(u.avatar, '') FROM users u
		 WHERE u.id=$2 AND u.status='active'
		   AND ($1 = $2 OR EXISTS (
		     SELECT 1 FROM organization_members mine
		     JOIN organization_members theirs ON theirs.organization_id = mine.organization_id
		     WHERE mine.user_id=$1 AND theirs.user_id=$2))`, viewerID, ownerID).Scan(&value)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	return value, err
}
