package metadata

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
)

const (
	// EmailVerificationPrefix marks a verification secret so a pasted one is recognizable.
	EmailVerificationPrefix = "orev_"
	// EmailVerificationTTL is how long a mailed link works.
	EmailVerificationTTL = 24 * time.Hour
	// UnverifiedAccountTTL is how long an account nobody verified is kept before it is removed.
	UnverifiedAccountTTL = 7 * 24 * time.Hour
	// EmailVerificationResendInterval keeps registration and resend from being used to flood
	// one inbox: a second message to the same account waits this long.
	EmailVerificationResendInterval = time.Minute

	registrationNamespace = "auth"
	registrationKey       = "registration"
)

var ErrVerificationInvalid = errors.New("email verification link is invalid or expired")

// RegistrationOutcome says what a registration or resend did, so the caller knows whether a
// message must go out. Every other outcome sends nothing and looks the same to the visitor.
type RegistrationOutcome string

const (
	// RegistrationSend: a link was made and must be mailed to the address.
	RegistrationSend RegistrationOutcome = "send"
	// RegistrationNoMail: the address is registered already, or a message went out a moment ago.
	RegistrationNoMail RegistrationOutcome = "no_mail"
)

// EmailRegistration is a sign-up by email. TokenHash is the SHA-256 of the secret that the
// caller mails; only the hash is stored.
type EmailRegistration struct {
	Email        string
	DisplayName  string
	PasswordHash string
	TokenHash    []byte
}

// RegistrationRepository holds the instance's registration policy and the email
// verification of accounts that sign up themselves.
type RegistrationRepository struct {
	database *sql.DB
	now      func() time.Time
}

func NewRegistrationRepository(database *sql.DB) *RegistrationRepository {
	return &RegistrationRepository{database: database, now: time.Now}
}

type registrationPolicyValue struct {
	Open bool `json:"open"`
}

// RegistrationPolicy is whether anyone may create an account without an invitation.
type RegistrationPolicy struct {
	Open      bool
	Version   int64
	UpdatedAt *time.Time
}

// Policy reads the policy. Registration is closed until an administrator opens it.
func (repository *RegistrationRepository) Policy(ctx context.Context) (RegistrationPolicy, error) {
	var raw []byte
	var policy RegistrationPolicy
	var updatedAt time.Time
	err := repository.database.QueryRowContext(ctx,
		`SELECT value_json, version, updated_at FROM instance_settings WHERE namespace=$1 AND key=$2`,
		registrationNamespace, registrationKey).Scan(&raw, &policy.Version, &updatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return RegistrationPolicy{}, nil
	}
	if err != nil {
		return RegistrationPolicy{}, err
	}
	var value registrationPolicyValue
	if err := json.Unmarshal(raw, &value); err != nil {
		return RegistrationPolicy{}, err
	}
	policy.Open, policy.UpdatedAt = value.Open, &updatedAt
	return policy, nil
}

// Open reports whether registration is open.
func (repository *RegistrationRepository) Open(ctx context.Context) (bool, error) {
	policy, err := repository.Policy(ctx)
	return policy.Open, err
}

// SetOpen opens or closes registration. Accounts that exist keep working either way.
func (repository *RegistrationRepository) SetOpen(ctx context.Context, actorID uuid.UUID, open bool) error {
	value, err := json.Marshal(registrationPolicyValue{Open: open})
	if err != nil {
		return err
	}
	_, err = repository.database.ExecContext(ctx,
		`INSERT INTO instance_settings (namespace, key, value_json, updated_by) VALUES ($1,$2,$3,$4)
		 ON CONFLICT (namespace, key) DO UPDATE
		 SET value_json=EXCLUDED.value_json, version=instance_settings.version+1,
		     updated_by=EXCLUDED.updated_by, updated_at=now()`,
		registrationNamespace, registrationKey, string(value), actorID)
	return err
}

// NewEmailVerificationToken makes a secret and the hash that is stored for it.
func NewEmailVerificationToken() (token string, hash []byte, err error) {
	data := make([]byte, 32)
	if _, err := rand.Read(data); err != nil {
		return "", nil, err
	}
	token = EmailVerificationPrefix + base64.RawURLEncoding.EncodeToString(data)
	digest := sha256.Sum256([]byte(token))
	return token, digest[:], nil
}

func emailVerificationHash(token string) ([]byte, bool) {
	token = strings.TrimSpace(token)
	if !strings.HasPrefix(token, EmailVerificationPrefix) || len(token) > 128 {
		return nil, false
	}
	digest := sha256.Sum256([]byte(token))
	return digest[:], true
}

// Register creates an unverified account, or refreshes the link of one that is still
// unverified. It never changes the name or password of an account that already exists, and an
// address that belongs to a confirmed account is reported exactly like a new one, so the
// answer does not reveal who is registered. The sweep of week-old unverified accounts runs
// here, so no background job is needed.
func (repository *RegistrationRepository) Register(ctx context.Context, input EmailRegistration) (RegistrationOutcome, error) {
	transaction, err := repository.database.BeginTx(ctx, nil)
	if err != nil {
		return RegistrationNoMail, err
	}
	defer func() { _ = transaction.Rollback() }()
	now := repository.now()
	if _, err := transaction.ExecContext(ctx,
		"DELETE FROM users WHERE access_status='unverified' AND created_at < $1", now.Add(-UnverifiedAccountTTL)); err != nil {
		return RegistrationNoMail, err
	}
	var existingID uuid.UUID
	var status string
	err = transaction.QueryRowContext(ctx,
		"SELECT id, access_status FROM users WHERE email=$1 FOR UPDATE", input.Email).Scan(&existingID, &status)
	switch {
	case err == nil:
		if status != "unverified" {
			return RegistrationNoMail, nil
		}
		outcome, err := replaceVerification(ctx, transaction, existingID, input.TokenHash, now)
		if err != nil {
			return RegistrationNoMail, err
		}
		return outcome, transaction.Commit()
	case !errors.Is(err, sql.ErrNoRows):
		return RegistrationNoMail, err
	}
	userID := uuid.New()
	if _, err := transaction.ExecContext(ctx,
		`INSERT INTO users (id, email, display_name, password_hash, access_status)
		 VALUES ($1,$2,$3,$4,'unverified')`, userID, input.Email, input.DisplayName, input.PasswordHash); err != nil {
		if errors.Is(translateConstraintError(err), ErrConflict) {
			// Someone registered the same address a moment ago; treat it as already there.
			return RegistrationNoMail, nil
		}
		return RegistrationNoMail, err
	}
	if _, err := transaction.ExecContext(ctx,
		`INSERT INTO email_verifications (user_id, token_hash, expires_at, sent_at) VALUES ($1,$2,$3,$4)`,
		userID, input.TokenHash, now.Add(EmailVerificationTTL), now); err != nil {
		return RegistrationNoMail, err
	}
	return RegistrationSend, transaction.Commit()
}

// Resend replaces the link of an account that is still unverified. For any other address, or
// when a message went out a moment ago, it does nothing and says so.
func (repository *RegistrationRepository) Resend(ctx context.Context, email string, tokenHash []byte) (RegistrationOutcome, error) {
	transaction, err := repository.database.BeginTx(ctx, nil)
	if err != nil {
		return RegistrationNoMail, err
	}
	defer func() { _ = transaction.Rollback() }()
	var userID uuid.UUID
	err = transaction.QueryRowContext(ctx,
		"SELECT id FROM users WHERE email=$1 AND access_status='unverified' FOR UPDATE", email).Scan(&userID)
	if errors.Is(err, sql.ErrNoRows) {
		return RegistrationNoMail, nil
	}
	if err != nil {
		return RegistrationNoMail, err
	}
	outcome, err := replaceVerification(ctx, transaction, userID, tokenHash, repository.now())
	if err != nil {
		return RegistrationNoMail, err
	}
	return outcome, transaction.Commit()
}

func replaceVerification(ctx context.Context, transaction *sql.Tx, userID uuid.UUID, tokenHash []byte, now time.Time) (RegistrationOutcome, error) {
	result, err := transaction.ExecContext(ctx,
		`INSERT INTO email_verifications (user_id, token_hash, expires_at, sent_at) VALUES ($1,$2,$3,$4)
		 ON CONFLICT (user_id) DO UPDATE
		 SET token_hash=EXCLUDED.token_hash, expires_at=EXCLUDED.expires_at, sent_at=EXCLUDED.sent_at
		 WHERE email_verifications.sent_at <= $5`,
		userID, tokenHash, now.Add(EmailVerificationTTL), now, now.Add(-EmailVerificationResendInterval))
	if err != nil {
		return RegistrationNoMail, err
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return RegistrationNoMail, err
	}
	if changed == 0 {
		return RegistrationNoMail, nil
	}
	return RegistrationSend, nil
}

// Verify confirms the address behind a link and approves the account. A link works once.
func (repository *RegistrationRepository) Verify(ctx context.Context, token string) (uuid.UUID, error) {
	hash, ok := emailVerificationHash(token)
	if !ok {
		return uuid.Nil, ErrVerificationInvalid
	}
	transaction, err := repository.database.BeginTx(ctx, nil)
	if err != nil {
		return uuid.Nil, err
	}
	defer func() { _ = transaction.Rollback() }()
	var userID uuid.UUID
	var expiresAt time.Time
	err = transaction.QueryRowContext(ctx,
		"SELECT user_id, expires_at FROM email_verifications WHERE token_hash=$1 FOR UPDATE", hash).Scan(&userID, &expiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return uuid.Nil, ErrVerificationInvalid
	}
	if err != nil {
		return uuid.Nil, err
	}
	if !expiresAt.After(repository.now()) {
		return uuid.Nil, ErrVerificationInvalid
	}
	result, err := transaction.ExecContext(ctx,
		"UPDATE users SET access_status='approved', updated_at=now() WHERE id=$1 AND access_status='unverified' AND status='active'", userID)
	if err != nil {
		return uuid.Nil, err
	}
	if changed, err := result.RowsAffected(); err != nil || changed != 1 {
		return uuid.Nil, ErrVerificationInvalid
	}
	if _, err := transaction.ExecContext(ctx, "DELETE FROM email_verifications WHERE user_id=$1", userID); err != nil {
		return uuid.Nil, err
	}
	return userID, transaction.Commit()
}
