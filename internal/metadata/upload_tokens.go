package metadata

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

const (
	UploadTokenPrefix       = "orut_"
	uploadTokenPrefixLength = 12
)

var ErrInvalidUploadToken = errors.New("invalid upload token")

// UploadToken is a project-scoped credential that lets build pipelines create
// releases and upload Source Map Artifacts without a Console session.
type UploadToken struct {
	ID            uuid.UUID  `json:"id"`
	ProjectID     uuid.UUID  `json:"-"`
	Name          string     `json:"name"`
	TokenPrefix   string     `json:"tokenPrefix"`
	CreatedByName *string    `json:"createdByName"`
	CreatedAt     time.Time  `json:"createdAt"`
	LastUsedAt    *time.Time `json:"lastUsedAt"`
	RevokedAt     *time.Time `json:"revokedAt"`
}

type UploadTokenCredential struct {
	Token  UploadToken
	Secret string
}

// UploadTokenAccess is the identity of an authenticated upload token request.
type UploadTokenAccess struct {
	TokenID   uuid.UUID
	ProjectID uuid.UUID
	// CreatedBy attributes audited actions; nil once the creator is deleted.
	CreatedBy *uuid.UUID
}

type UploadTokenRepository struct{ database *sql.DB }

func NewUploadTokenRepository(database *sql.DB) *UploadTokenRepository {
	return &UploadTokenRepository{database: database}
}

func (repository *UploadTokenRepository) List(ctx context.Context, projectID uuid.UUID) ([]UploadToken, error) {
	rows, err := repository.database.QueryContext(ctx,
		`SELECT t.id, t.project_id, t.name, t.token_prefix, u.display_name, t.created_at, t.last_used_at, t.revoked_at
		 FROM project_upload_tokens t LEFT JOIN users u ON u.id=t.created_by
		 WHERE t.project_id=$1
		 ORDER BY t.revoked_at NULLS FIRST, t.created_at DESC, t.id`, projectID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	tokens := make([]UploadToken, 0)
	for rows.Next() {
		var token UploadToken
		if err := rows.Scan(&token.ID, &token.ProjectID, &token.Name, &token.TokenPrefix, &token.CreatedByName,
			&token.CreatedAt, &token.LastUsedAt, &token.RevokedAt); err != nil {
			return nil, err
		}
		tokens = append(tokens, token)
	}
	return tokens, rows.Err()
}

// Create stores only the SHA-256 of a fresh secret; the plaintext is returned
// once and cannot be recovered later.
func (repository *UploadTokenRepository) Create(ctx context.Context, actorID, projectID uuid.UUID, name string) (UploadTokenCredential, error) {
	randomBytes := make([]byte, 32)
	if _, err := rand.Read(randomBytes); err != nil {
		return UploadTokenCredential{}, fmt.Errorf("generate upload token: %w", err)
	}
	secret := UploadTokenPrefix + base64.RawURLEncoding.EncodeToString(randomBytes)
	digest := sha256.Sum256([]byte(secret))
	transaction, err := repository.database.BeginTx(ctx, nil)
	if err != nil {
		return UploadTokenCredential{}, err
	}
	defer func() { _ = transaction.Rollback() }()
	organizationID, err := lockProject(ctx, transaction, actorID, projectID, canManageProjectSettings)
	if err != nil {
		return UploadTokenCredential{}, err
	}
	token := UploadToken{ID: uuid.New(), ProjectID: projectID, Name: name, TokenPrefix: secret[:uploadTokenPrefixLength]}
	err = transaction.QueryRowContext(ctx,
		`INSERT INTO project_upload_tokens (id, project_id, name, token_prefix, token_hash, created_by)
		 VALUES ($1,$2,$3,$4,$5,$6)
		 RETURNING created_at, (SELECT display_name FROM users WHERE id=$6)`,
		token.ID, projectID, name, token.TokenPrefix, digest[:], actorID,
	).Scan(&token.CreatedAt, &token.CreatedByName)
	if err != nil {
		return UploadTokenCredential{}, translateConstraintError(err)
	}
	if err := insertAudit(ctx, transaction, organizationID, actorID, "upload_token.created", "upload_token", token.ID); err != nil {
		return UploadTokenCredential{}, err
	}
	if err := transaction.Commit(); err != nil {
		return UploadTokenCredential{}, err
	}
	return UploadTokenCredential{Token: token, Secret: secret}, nil
}

// Revoke is idempotent: revoking an already revoked token succeeds without a
// second audit entry.
func (repository *UploadTokenRepository) Revoke(ctx context.Context, actorID, projectID, tokenID uuid.UUID) error {
	transaction, err := repository.database.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = transaction.Rollback() }()
	organizationID, err := lockProject(ctx, transaction, actorID, projectID, canManageProjectSettings)
	if err != nil {
		return err
	}
	var revokedAt *time.Time
	err = transaction.QueryRowContext(ctx,
		"SELECT revoked_at FROM project_upload_tokens WHERE id=$1 AND project_id=$2 FOR UPDATE", tokenID, projectID,
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
	if _, err := transaction.ExecContext(ctx, "UPDATE project_upload_tokens SET revoked_at=now() WHERE id=$1", tokenID); err != nil {
		return err
	}
	if err := insertAudit(ctx, transaction, organizationID, actorID, "upload_token.revoked", "upload_token", tokenID); err != nil {
		return err
	}
	return transaction.Commit()
}

// Authenticate resolves an active token of a project that is not being
// deleted. last_used_at is written at most once a minute so a large upload
// batch does not turn every request into a row update.
func (repository *UploadTokenRepository) Authenticate(ctx context.Context, secret string) (UploadTokenAccess, error) {
	if !strings.HasPrefix(secret, UploadTokenPrefix) || len(secret) > 128 {
		return UploadTokenAccess{}, ErrInvalidUploadToken
	}
	digest := sha256.Sum256([]byte(secret))
	var access UploadTokenAccess
	err := repository.database.QueryRowContext(ctx,
		`SELECT t.id, t.project_id, t.created_by
		 FROM project_upload_tokens t JOIN projects p ON p.id=t.project_id
		 WHERE t.token_hash=$1 AND t.revoked_at IS NULL AND p.status<>'deleting'`, digest[:],
	).Scan(&access.TokenID, &access.ProjectID, &access.CreatedBy)
	if errors.Is(err, sql.ErrNoRows) {
		return UploadTokenAccess{}, ErrInvalidUploadToken
	}
	if err != nil {
		return UploadTokenAccess{}, err
	}
	if _, err := repository.database.ExecContext(ctx,
		"UPDATE project_upload_tokens SET last_used_at=now() WHERE id=$1 AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')",
		access.TokenID); err != nil {
		return UploadTokenAccess{}, err
	}
	return access, nil
}
