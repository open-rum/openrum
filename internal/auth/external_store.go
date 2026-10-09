package auth

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/mail"
	"regexp"
	"strings"

	openrumcrypto "openrum/internal/crypto"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
)

var (
	ErrProviderUnavailable = errors.New("authentication provider is unavailable")
	ErrIdentityConflict    = errors.New("email already belongs to another account")
	ErrIdentityLinked      = errors.New("identity is already linked")
	ErrIdentityLastMethod  = errors.New("cannot remove the last login method")
	ErrProviderChanged     = errors.New("provider identity scope cannot be changed")
	providerIDPattern      = regexp.MustCompile(`^[a-z][a-z0-9-]{0,39}$`)
)

type ProviderSettings struct {
	ClientID       string `json:"clientId,omitempty"`
	IssuerURL      string `json:"issuerUrl,omitempty"`
	LDAPURL        string `json:"ldapUrl,omitempty"`
	BaseDN         string `json:"baseDn,omitempty"`
	BindDN         string `json:"bindDn,omitempty"`
	UserFilter     string `json:"userFilter,omitempty"`
	IDAttribute    string `json:"idAttribute,omitempty"`
	EmailAttribute string `json:"emailAttribute,omitempty"`
	NameAttribute  string `json:"nameAttribute,omitempty"`
	CACertificate  string `json:"caCertificate,omitempty"`
}

type Provider struct {
	ID            string           `json:"id"`
	Kind          string           `json:"kind"`
	Label         string           `json:"label"`
	IdentityScope string           `json:"-"`
	Settings      ProviderSettings `json:"settings"`
	Enabled       bool             `json:"enabled"`
	Version       int64            `json:"version"`
	Configured    bool             `json:"configured"`
	Secret        string           `json:"-"`
}

type ExternalUser struct {
	ID           uuid.UUID
	Email        string
	DisplayName  string
	AccessStatus string
}

type LinkedIdentity struct {
	ID         uuid.UUID `json:"id"`
	ProviderID string    `json:"providerId"`
	Label      string    `json:"label"`
	Kind       string    `json:"kind"`
}

type ExternalStore struct {
	database *sql.DB
	keyring  *openrumcrypto.Keyring
}

func NewExternalStore(database *sql.DB, keyring *openrumcrypto.Keyring) *ExternalStore {
	return &ExternalStore{database: database, keyring: keyring}
}

func (store *ExternalStore) ManagedSecretsAvailable() bool { return store.keyring != nil }

func (store *ExternalStore) ListProviders(ctx context.Context, enabledOnly bool) ([]Provider, error) {
	if enabledOnly && store.keyring == nil {
		return []Provider{}, nil
	}
	query := `SELECT p.id,p.kind,p.label,p.identity_scope,p.settings,p.enabled,p.version,
		EXISTS(SELECT 1 FROM instance_secrets s WHERE s.name='auth-provider:'||p.id)
		FROM auth_providers p`
	if enabledOnly {
		query += " WHERE p.enabled=true"
	}
	query += " ORDER BY p.kind,p.label,p.id"
	rows, err := store.database.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	providers := make([]Provider, 0)
	for rows.Next() {
		var p Provider
		var settings []byte
		if err := rows.Scan(&p.ID, &p.Kind, &p.Label, &p.IdentityScope, &settings, &p.Enabled, &p.Version, &p.Configured); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(settings, &p.Settings); err != nil {
			return nil, err
		}
		if !enabledOnly || p.Configured {
			providers = append(providers, p)
		}
	}
	return providers, rows.Err()
}

func (store *ExternalStore) GetProvider(ctx context.Context, id string) (Provider, error) {
	return store.getProvider(ctx, id, true)
}

// GetProviderForTest loads a configured provider before it is exposed on the login page.
func (store *ExternalStore) GetProviderForTest(ctx context.Context, id string) (Provider, error) {
	return store.getProvider(ctx, id, false)
}

func (store *ExternalStore) getProvider(ctx context.Context, id string, enabledOnly bool) (Provider, error) {
	if store.keyring == nil {
		return Provider{}, ErrProviderUnavailable
	}
	var p Provider
	var settings, encrypted []byte
	var keyID string
	err := store.database.QueryRowContext(ctx, `SELECT p.id,p.kind,p.label,p.identity_scope,p.settings,p.enabled,p.version,s.encrypted_value,s.key_id
		FROM auth_providers p JOIN instance_secrets s ON s.name='auth-provider:'||p.id
		WHERE p.id=$1 AND (NOT $2 OR p.enabled=true)`, id, enabledOnly).Scan(&p.ID, &p.Kind, &p.Label, &p.IdentityScope, &settings, &p.Enabled, &p.Version, &encrypted, &keyID)
	if errors.Is(err, sql.ErrNoRows) {
		return Provider{}, ErrProviderUnavailable
	}
	if err != nil {
		return Provider{}, err
	}
	if err := json.Unmarshal(settings, &p.Settings); err != nil {
		return Provider{}, err
	}
	plain, _, err := store.keyring.Open(encrypted, []byte("auth-provider:"+id))
	if err != nil {
		return Provider{}, fmt.Errorf("decrypt authentication provider: %w", err)
	}
	defer clear(plain)
	p.Secret = string(plain)
	p.Configured = true
	return p, nil
}

func (store *ExternalStore) SaveProvider(ctx context.Context, actorID uuid.UUID, p Provider, secret string) error {
	if store.keyring == nil {
		return ErrProviderUnavailable
	}
	if !providerIDPattern.MatchString(p.ID) || len(p.Label) == 0 || len(p.Label) > 80 {
		return ErrProviderUnavailable
	}
	settings, err := json.Marshal(p.Settings)
	if err != nil {
		return err
	}
	tx, err := store.database.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	var oldKind, oldScope string
	err = tx.QueryRowContext(ctx, "SELECT kind,identity_scope FROM auth_providers WHERE id=$1 FOR UPDATE", p.ID).Scan(&oldKind, &oldScope)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if err == nil && (oldKind != p.Kind || oldScope != p.IdentityScope) {
		return ErrProviderChanged
	}
	if secret == "" {
		var count int
		if err := tx.QueryRowContext(ctx, "SELECT count(*) FROM instance_secrets WHERE name=$1", "auth-provider:"+p.ID).Scan(&count); err != nil {
			return err
		}
		if count == 0 {
			return ErrProviderUnavailable
		}
	} else {
		plain := []byte(secret)
		ciphertext, keyID, sealErr := store.keyring.Seal(plain, []byte("auth-provider:"+p.ID))
		clear(plain)
		if sealErr != nil {
			return sealErr
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO instance_secrets(name,encrypted_value,key_id,updated_by)
			VALUES($1,$2,$3,$4) ON CONFLICT(name) DO UPDATE SET encrypted_value=EXCLUDED.encrypted_value,
			key_id=EXCLUDED.key_id,updated_by=EXCLUDED.updated_by,version=instance_secrets.version+1,updated_at=now()`,
			"auth-provider:"+p.ID, ciphertext, keyID, actorID)
		if err != nil {
			return err
		}
	}
	result, err := tx.ExecContext(ctx, `INSERT INTO auth_providers(id,kind,label,identity_scope,settings,enabled)
		VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET label=EXCLUDED.label,
		settings=EXCLUDED.settings,enabled=EXCLUDED.enabled,version=auth_providers.version+1,updated_at=now()
		WHERE auth_providers.kind=EXCLUDED.kind AND auth_providers.identity_scope=EXCLUDED.identity_scope`,
		p.ID, p.Kind, p.Label, p.IdentityScope, settings, p.Enabled)
	if err != nil {
		return err
	}
	if count, err := result.RowsAffected(); err != nil {
		return err
	} else if count != 1 {
		return ErrProviderChanged
	}
	return tx.Commit()
}

func (store *ExternalStore) DisableProvider(ctx context.Context, id string) error {
	result, err := store.database.ExecContext(ctx, "UPDATE auth_providers SET enabled=false,version=version+1,updated_at=now() WHERE id=$1", id)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count == 0 {
		return ErrProviderUnavailable
	}
	return nil
}

func (store *ExternalStore) ResolveIdentity(ctx context.Context, p Provider, subject, email, name string) (ExternalUser, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	parsed, err := mail.ParseAddress(email)
	if err != nil || parsed.Address != email || len(email) > 320 || subject == "" || len(subject) > 512 {
		return ExternalUser{}, ErrProviderUnavailable
	}
	name = strings.TrimSpace(name)
	if name == "" {
		name = email
	}
	if len([]rune(name)) > 120 {
		name = string([]rune(name)[:120])
	}
	tx, err := store.database.BeginTx(ctx, nil)
	if err != nil {
		return ExternalUser{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if err := requireEnabledProvider(ctx, tx, p); err != nil {
		return ExternalUser{}, err
	}
	// Serialize first logins by subject and email across API replicas.
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", p.ID+":"+subject); err != nil {
		return ExternalUser{}, err
	}
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", email); err != nil {
		return ExternalUser{}, err
	}
	var user ExternalUser
	var status string
	err = tx.QueryRowContext(ctx, `SELECT u.id,u.email,u.display_name,u.access_status,u.status FROM auth_identities i
		JOIN users u ON u.id=i.user_id WHERE i.provider_id=$1 AND i.subject=$2`, p.ID, subject).
		Scan(&user.ID, &user.Email, &user.DisplayName, &user.AccessStatus, &status)
	if err == nil {
		if status != "active" {
			return ExternalUser{}, ErrProviderUnavailable
		}
		return user, tx.Commit()
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return ExternalUser{}, err
	}
	var existing uuid.UUID
	err = tx.QueryRowContext(ctx, "SELECT id FROM users WHERE email=$1", email).Scan(&existing)
	if err == nil {
		return ExternalUser{}, ErrIdentityConflict
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return ExternalUser{}, err
	}
	user.ID = uuid.New()
	user.Email = email
	user.DisplayName = name
	user.AccessStatus = "pending"
	_, err = tx.ExecContext(ctx, `INSERT INTO users(id,email,display_name,auth_source,access_status)
		VALUES($1,$2,$3,$4,'pending')`, user.ID, email, name, p.Kind)
	if err != nil {
		return ExternalUser{}, err
	}
	_, err = tx.ExecContext(ctx, "INSERT INTO auth_identities(user_id,provider_id,subject) VALUES($1,$2,$3)", user.ID, p.ID, subject)
	if err != nil {
		return ExternalUser{}, err
	}
	return user, tx.Commit()
}

func (store *ExternalStore) LinkIdentity(ctx context.Context, userID uuid.UUID, p Provider, subject string) error {
	if subject == "" || len(subject) > 512 {
		return ErrProviderUnavailable
	}
	tx, err := store.database.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if err := requireEnabledProvider(ctx, tx, p); err != nil {
		return err
	}
	var exists bool
	if err := tx.QueryRowContext(ctx, "SELECT true FROM users WHERE id=$1 AND status='active' AND access_status='approved' FOR SHARE", userID).Scan(&exists); err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, "INSERT INTO auth_identities(user_id,provider_id,subject) VALUES($1,$2,$3)", userID, p.ID, subject)
	if err != nil {
		var postgresError *pgconn.PgError
		if errors.As(err, &postgresError) && postgresError.Code == "23505" {
			return ErrIdentityLinked
		}
		return err
	}
	return tx.Commit()
}

func requireEnabledProvider(ctx context.Context, tx *sql.Tx, provider Provider) error {
	var version int64
	var enabled bool
	err := tx.QueryRowContext(ctx, "SELECT version,enabled FROM auth_providers WHERE id=$1 FOR SHARE", provider.ID).Scan(&version, &enabled)
	if errors.Is(err, sql.ErrNoRows) || err == nil && (!enabled || version != provider.Version) {
		return ErrProviderUnavailable
	}
	return err
}

func (store *ExternalStore) ListIdentities(ctx context.Context, userID uuid.UUID) ([]LinkedIdentity, error) {
	rows, err := store.database.QueryContext(ctx, `SELECT i.id,i.provider_id,p.label,p.kind FROM auth_identities i
		JOIN auth_providers p ON p.id=i.provider_id WHERE i.user_id=$1 ORDER BY p.label`, userID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	identities := make([]LinkedIdentity, 0)
	for rows.Next() {
		var i LinkedIdentity
		if err := rows.Scan(&i.ID, &i.ProviderID, &i.Label, &i.Kind); err != nil {
			return nil, err
		}
		identities = append(identities, i)
	}
	return identities, rows.Err()
}

func (store *ExternalStore) UnlinkIdentity(ctx context.Context, userID, identityID uuid.UUID) error {
	tx, err := store.database.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	var hasPassword, targetEnabled bool
	if err := tx.QueryRowContext(ctx, "SELECT password_hash IS NOT NULL FROM users WHERE id=$1 FOR UPDATE", userID).Scan(&hasPassword); err != nil {
		return err
	}
	if err := tx.QueryRowContext(ctx, `SELECT p.enabled FROM auth_identities i JOIN auth_providers p ON p.id=i.provider_id
		WHERE i.id=$1 AND i.user_id=$2`, identityID, userID).Scan(&targetEnabled); err != nil {
		return err
	}
	var activeMethods int
	if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM auth_identities i JOIN auth_providers p ON p.id=i.provider_id
		WHERE i.user_id=$1 AND p.enabled=true`, userID).Scan(&activeMethods); err != nil {
		return err
	}
	if targetEnabled && !hasPassword && activeMethods <= 1 {
		return ErrIdentityLastMethod
	}
	result, err := tx.ExecContext(ctx, "DELETE FROM auth_identities WHERE id=$1 AND user_id=$2", identityID, userID)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count == 0 {
		return sql.ErrNoRows
	}
	return tx.Commit()
}
