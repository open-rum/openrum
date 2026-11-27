package metadata

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
)

const (
	// PasswordResetTokenPrefix marks a reset secret so a pasted one is recognizable.
	PasswordResetTokenPrefix = "orpr_"
	// PasswordResetTTL is how long a mailed password reset link works.
	PasswordResetTTL = time.Hour
	// PasswordResetResendInterval prevents flooding a single inbox with repeated reset emails.
	PasswordResetResendInterval = time.Minute
)

var (
	// ErrPasswordResetInvalid reports a missing, used, replaced or expired reset token.
	ErrPasswordResetInvalid = errors.New("password reset link is invalid or expired")
	// ErrPasswordResetUserNotFound reports that no active account matched the email address.
	ErrPasswordResetUserNotFound = errors.New("active user account not found")
)

// PasswordResetOutcome tells the caller whether a reset email should be sent.
// Unknown addresses and throttled requests both report PasswordResetNoMail so responses stay identical.
type PasswordResetOutcome string

const (
	PasswordResetSend   PasswordResetOutcome = "send"
	PasswordResetNoMail PasswordResetOutcome = "no_mail"
)

// PasswordResetRepository manages one-time password reset tokens and emergency password resets.
type PasswordResetRepository struct {
	database *sql.DB
	now      func() time.Time
}

func NewPasswordResetRepository(database *sql.DB) *PasswordResetRepository {
	return &PasswordResetRepository{database: database, now: time.Now}
}

// NewPasswordResetToken creates a random reset token and its SHA-256 digest.
func NewPasswordResetToken() (token string, hash []byte, err error) {
	data := make([]byte, 32)
	if _, err := rand.Read(data); err != nil {
		return "", nil, err
	}
	token = PasswordResetTokenPrefix + base64.RawURLEncoding.EncodeToString(data)
	digest := sha256.Sum256([]byte(token))
	return token, digest[:], nil
}

func passwordResetHash(token string) ([]byte, bool) {
	token = strings.TrimSpace(token)
	if !strings.HasPrefix(token, PasswordResetTokenPrefix) || len(token) > 128 {
		return nil, false
	}
	digest := sha256.Sum256([]byte(token))
	return digest[:], true
}

// Request records a fresh password reset token for an active verified account unless one was
// issued within PasswordResetResendInterval. Unknown or unverified accounts return
// PasswordResetNoMail with no error so callers never leak account existence.
func (repository *PasswordResetRepository) Request(ctx context.Context, email string, tokenHash []byte) (PasswordResetOutcome, error) {
	normalized := strings.ToLower(strings.TrimSpace(email))
	if normalized == "" || len(tokenHash) != sha256.Size {
		return PasswordResetNoMail, nil
	}
	transaction, err := repository.database.BeginTx(ctx, nil)
	if err != nil {
		return PasswordResetNoMail, err
	}
	defer func() { _ = transaction.Rollback() }()

	var userID uuid.UUID
	err = transaction.QueryRowContext(ctx,
		`SELECT id FROM users
		 WHERE email=$1 AND status='active' AND access_status <> 'unverified'
		 FOR UPDATE`,
		normalized,
	).Scan(&userID)
	if errors.Is(err, sql.ErrNoRows) {
		return PasswordResetNoMail, nil
	}
	if err != nil {
		return PasswordResetNoMail, err
	}

	now := repository.now().UTC()
	expiresAt := now.Add(PasswordResetTTL)
	cutoff := now.Add(-PasswordResetResendInterval)
	result, err := transaction.ExecContext(ctx,
		`INSERT INTO password_resets (user_id, token_hash, expires_at, sent_at)
		 VALUES ($1, $2, $3, $4)
		 ON CONFLICT (user_id) DO UPDATE
		 SET token_hash = EXCLUDED.token_hash,
		     expires_at = EXCLUDED.expires_at,
		     sent_at = EXCLUDED.sent_at
		 WHERE password_resets.sent_at <= $5`,
		userID, tokenHash, expiresAt, now, cutoff,
	)
	if err != nil {
		return PasswordResetNoMail, err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return PasswordResetNoMail, err
	}
	if rows == 0 {
		return PasswordResetNoMail, nil
	}
	if err := transaction.Commit(); err != nil {
		return PasswordResetNoMail, err
	}
	return PasswordResetSend, nil
}

// Confirm consumes a live reset token, replaces the account password hash and revokes every
// existing session for that user.
func (repository *PasswordResetRepository) Confirm(ctx context.Context, token, newPasswordHash string) (uuid.UUID, error) {
	hash, ok := passwordResetHash(token)
	if !ok {
		return uuid.Nil, ErrPasswordResetInvalid
	}
	transaction, err := repository.database.BeginTx(ctx, nil)
	if err != nil {
		return uuid.Nil, err
	}
	defer func() { _ = transaction.Rollback() }()

	var userID uuid.UUID
	var expiresAt time.Time
	err = transaction.QueryRowContext(ctx,
		`SELECT pr.user_id, pr.expires_at
		 FROM password_resets pr
		 JOIN users u ON u.id = pr.user_id
		 WHERE pr.token_hash=$1 AND u.status='active' AND u.access_status <> 'unverified'
		 FOR UPDATE`,
		hash,
	).Scan(&userID, &expiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return uuid.Nil, ErrPasswordResetInvalid
	}
	if err != nil {
		return uuid.Nil, err
	}

	now := repository.now().UTC()
	if !expiresAt.After(now) {
		_, _ = transaction.ExecContext(ctx, "DELETE FROM password_resets WHERE user_id=$1", userID)
		_ = transaction.Commit()
		return uuid.Nil, ErrPasswordResetInvalid
	}

	if _, err := transaction.ExecContext(ctx,
		"UPDATE users SET password_hash=$1, updated_at=now() WHERE id=$2",
		newPasswordHash, userID); err != nil {
		return uuid.Nil, err
	}
	if _, err := transaction.ExecContext(ctx,
		"DELETE FROM password_resets WHERE user_id=$1", userID); err != nil {
		return uuid.Nil, err
	}
	if _, err := transaction.ExecContext(ctx,
		"UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL",
		userID); err != nil {
		return uuid.Nil, err
	}
	if err := transaction.Commit(); err != nil {
		return uuid.Nil, err
	}
	return userID, nil
}

// AdminResetPassword replaces an active account's password directly from an operator CLI,
// clears any pending reset tokens and revokes all active sessions.
func (repository *PasswordResetRepository) AdminResetPassword(ctx context.Context, email, newPasswordHash string) (uuid.UUID, error) {
	normalized := strings.ToLower(strings.TrimSpace(email))
	if normalized == "" {
		return uuid.Nil, ErrPasswordResetUserNotFound
	}
	transaction, err := repository.database.BeginTx(ctx, nil)
	if err != nil {
		return uuid.Nil, err
	}
	defer func() { _ = transaction.Rollback() }()

	var userID uuid.UUID
	err = transaction.QueryRowContext(ctx,
		`UPDATE users
		 SET password_hash=$1, updated_at=now()
		 WHERE email=$2 AND status='active'
		 RETURNING id`,
		newPasswordHash, normalized,
	).Scan(&userID)
	if errors.Is(err, sql.ErrNoRows) {
		return uuid.Nil, ErrPasswordResetUserNotFound
	}
	if err != nil {
		return uuid.Nil, err
	}
	if _, err := transaction.ExecContext(ctx,
		"DELETE FROM password_resets WHERE user_id=$1", userID); err != nil {
		return uuid.Nil, err
	}
	if _, err := transaction.ExecContext(ctx,
		"UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL",
		userID); err != nil {
		return uuid.Nil, err
	}
	if err := transaction.Commit(); err != nil {
		return uuid.Nil, err
	}
	return userID, nil
}

// InstanceAdminSummary describes an instance owner or admin for operator recovery output.
type InstanceAdminSummary struct {
	Email       string
	DisplayName string
	Role        string
	Status      string
}

// ListAdmins returns instance owners and admins ordered with owners first so an operator
// who forgot which address was initialized can identify the account before resetting it.
func (repository *PasswordResetRepository) ListAdmins(ctx context.Context) ([]InstanceAdminSummary, error) {
	rows, err := repository.database.QueryContext(ctx,
		`SELECT u.email, u.display_name, im.role, u.status
		 FROM instance_members im
		 JOIN users u ON u.id = im.user_id
		 ORDER BY (im.role = 'instance_owner') DESC, u.created_at ASC, u.id ASC`,
	)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var admins []InstanceAdminSummary
	for rows.Next() {
		var item InstanceAdminSummary
		if err := rows.Scan(&item.Email, &item.DisplayName, &item.Role, &item.Status); err != nil {
			return nil, err
		}
		admins = append(admins, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return admins, nil
}
