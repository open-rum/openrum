package auth

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
	"unicode/utf8"

	"github.com/google/uuid"
)

const (
	SessionCookieName  = "openrum_session"
	CSRFCookieName     = "openrum_csrf"
	SessionIdleTTL     = 30 * time.Minute
	SessionAbsoluteTTL = 12 * time.Hour
)

var ErrUnauthenticated = errors.New("session is not authenticated")

var ErrReauthenticationRequired = errors.New("recent reauthentication is required")

type SessionCredentials struct {
	Token     string
	CSRFToken string
	ExpiresAt time.Time
}

type Principal struct {
	SessionID    uuid.UUID
	UserID       uuid.UUID
	Email        string
	DisplayName  string
	InstanceRole string
}

type SessionManager struct {
	database *sql.DB
	now      func() time.Time
}

func NewSessionManager(database *sql.DB) *SessionManager {
	return &SessionManager{database: database, now: time.Now}
}

func (manager *SessionManager) Create(ctx context.Context, userID uuid.UUID, ipAddress, userAgent string) (SessionCredentials, error) {
	return manager.Rotate(ctx, userID, "", ipAddress, userAgent)
}

func (manager *SessionManager) Rotate(ctx context.Context, userID uuid.UUID, previousToken, ipAddress, userAgent string) (SessionCredentials, error) {
	now := manager.now()
	credentials, tokenHash, err := newSessionCredentials(now)
	if err != nil {
		return SessionCredentials{}, err
	}
	transaction, err := manager.database.BeginTx(ctx, nil)
	if err != nil {
		return SessionCredentials{}, err
	}
	defer func() { _ = transaction.Rollback() }()
	if previousToken != "" {
		previousHash := sha256.Sum256([]byte(previousToken))
		if _, err := transaction.ExecContext(ctx,
			"UPDATE sessions SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL",
			previousHash[:]); err != nil {
			return SessionCredentials{}, err
		}
	}
	ipHash := hashOptional(ipAddress)
	if _, err := transaction.ExecContext(ctx,
		`INSERT INTO sessions (id, user_id, token_hash, ip_hash, user_agent, expires_at, idle_expires_at, created_at, last_seen_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
		uuid.New(), userID, tokenHash[:], ipHash, truncateRunes(userAgent, 512), credentials.ExpiresAt,
		now.Add(SessionIdleTTL), now); err != nil {
		return SessionCredentials{}, fmt.Errorf("create session: %w", err)
	}
	if err := transaction.Commit(); err != nil {
		return SessionCredentials{}, err
	}
	return credentials, nil
}

func (manager *SessionManager) Authenticate(ctx context.Context, token string) (Principal, error) {
	if token == "" {
		return Principal{}, ErrUnauthenticated
	}
	tokenHash := sha256.Sum256([]byte(token))
	var principal Principal
	err := manager.database.QueryRowContext(ctx,
		`SELECT sessions.id, users.id, users.email, users.display_name, COALESCE(instance_members.role, '')
		 FROM sessions JOIN users ON users.id = sessions.user_id
		 LEFT JOIN instance_members ON instance_members.user_id = users.id
		 WHERE sessions.token_hash=$1 AND sessions.revoked_at IS NULL
		   AND sessions.expires_at > now() AND sessions.idle_expires_at > now()
		   AND users.status='active'`,
		tokenHash[:],
	).Scan(&principal.SessionID, &principal.UserID, &principal.Email, &principal.DisplayName, &principal.InstanceRole)
	if errors.Is(err, sql.ErrNoRows) {
		return Principal{}, ErrUnauthenticated
	}
	if err != nil {
		return Principal{}, err
	}
	if _, err := manager.database.ExecContext(ctx,
		`UPDATE sessions
		 SET last_seen_at=now(), idle_expires_at=LEAST(expires_at, now() + $2::interval)
		 WHERE id=$1 AND last_seen_at < now() - interval '1 minute'`,
		principal.SessionID, SessionIdleTTL.String()); err != nil {
		return Principal{}, err
	}
	return principal, nil
}

func (manager *SessionManager) Revoke(ctx context.Context, sessionID uuid.UUID) error {
	_, err := manager.database.ExecContext(ctx,
		"UPDATE sessions SET revoked_at=COALESCE(revoked_at, now()) WHERE id=$1", sessionID)
	return err
}

func (manager *SessionManager) Reauthenticate(ctx context.Context, userID uuid.UUID, currentPassword string) error {
	if err := ValidatePassword(currentPassword); err != nil {
		return ErrInvalidCredentials
	}
	var currentHash string
	if err := manager.database.QueryRowContext(ctx,
		"SELECT password_hash FROM users WHERE id=$1 AND auth_source='local' AND status='active'",
		userID).Scan(&currentHash); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrInvalidCredentials
		}
		return err
	}
	valid, err := VerifyPassword(currentPassword, currentHash)
	if err != nil {
		return err
	}
	if !valid {
		return ErrInvalidCredentials
	}
	return nil
}

func (manager *SessionManager) Elevate(ctx context.Context, principal Principal, currentPassword string) error {
	if err := manager.Reauthenticate(ctx, principal.UserID, currentPassword); err != nil {
		return err
	}
	result, err := manager.database.ExecContext(ctx,
		"UPDATE sessions SET elevated_at=$1 WHERE id=$2 AND user_id=$3 AND revoked_at IS NULL",
		manager.now().UTC(), principal.SessionID, principal.UserID)
	if err != nil {
		return err
	}
	if rows, rowsErr := result.RowsAffected(); rowsErr != nil || rows != 1 {
		return ErrUnauthenticated
	}
	return nil
}

func (manager *SessionManager) RequireRecentElevation(ctx context.Context, principal Principal, maximumAge time.Duration) error {
	if maximumAge <= 0 || maximumAge > 5*time.Minute {
		maximumAge = 5 * time.Minute
	}
	var elevatedAt sql.NullTime
	err := manager.database.QueryRowContext(ctx,
		"SELECT elevated_at FROM sessions WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL",
		principal.SessionID, principal.UserID).Scan(&elevatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrUnauthenticated
	}
	if err != nil {
		return err
	}
	if !elevatedAt.Valid || elevatedAt.Time.Before(manager.now().UTC().Add(-maximumAge)) {
		return ErrReauthenticationRequired
	}
	return nil
}

func (manager *SessionManager) ChangePassword(ctx context.Context, principal Principal, currentPassword, newPassword string) error {
	if err := ValidatePassword(newPassword); err != nil {
		return err
	}
	var currentHash string
	if err := manager.database.QueryRowContext(ctx,
		"SELECT password_hash FROM users WHERE id=$1 AND auth_source='local' AND status='active'",
		principal.UserID).Scan(&currentHash); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrInvalidCredentials
		}
		return err
	}
	valid, err := VerifyPassword(currentPassword, currentHash)
	if err != nil {
		return err
	}
	if !valid {
		return ErrInvalidCredentials
	}
	newHash, err := HashPassword(newPassword)
	if err != nil {
		return err
	}
	transaction, err := manager.database.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = transaction.Rollback() }()
	result, err := transaction.ExecContext(ctx,
		"UPDATE users SET password_hash=$1, updated_at=now() WHERE id=$2 AND password_hash=$3",
		newHash, principal.UserID, currentHash)
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows != 1 {
		return ErrInvalidCredentials
	}
	if _, err := transaction.ExecContext(ctx,
		"UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND id<>$2 AND revoked_at IS NULL",
		principal.UserID, principal.SessionID); err != nil {
		return err
	}
	return transaction.Commit()
}

func newSessionCredentials(now time.Time) (SessionCredentials, [32]byte, error) {
	selector, err := randomURLToken(8)
	if err != nil {
		return SessionCredentials{}, [32]byte{}, err
	}
	secret, err := randomURLToken(32)
	if err != nil {
		return SessionCredentials{}, [32]byte{}, err
	}
	csrfToken, err := randomURLToken(32)
	if err != nil {
		return SessionCredentials{}, [32]byte{}, err
	}
	credentials := SessionCredentials{
		Token:     "orrs_" + selector + "." + secret,
		CSRFToken: csrfToken,
		ExpiresAt: now.Add(SessionAbsoluteTTL),
	}
	return credentials, sha256.Sum256([]byte(credentials.Token)), nil
}

func randomURLToken(size int) (string, error) {
	buffer := make([]byte, size)
	if _, err := rand.Read(buffer); err != nil {
		return "", fmt.Errorf("generate secure token: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(buffer), nil
}

func hashOptional(value string) []byte {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	digest := sha256.Sum256([]byte(value))
	return digest[:]
}

func truncateRunes(value string, limit int) string {
	if utf8.RuneCountInString(value) <= limit {
		return value
	}
	runes := []rune(value)
	return string(runes[:limit])
}
