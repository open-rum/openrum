package auth

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"errors"
	"fmt"
	"net/mail"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"
)

var (
	ErrAlreadyInitialized    = errors.New("instance is already initialized")
	ErrInvalidBootstrapToken = errors.New("invalid bootstrap token")
)

type ValidationError struct {
	Field string
}

func (validationError *ValidationError) Error() string {
	return fmt.Sprintf("invalid %s", validationError.Field)
}

type BootstrapInput struct {
	Email            string
	DisplayName      string
	Password         string
	OrganizationName string
}

type BootstrapResult struct {
	UserID         uuid.UUID
	OrganizationID uuid.UUID
}

type passwordHasher func(string) (string, error)

type Bootstrapper struct {
	database       *sql.DB
	bootstrapToken string
	hashPassword   passwordHasher
}

func NewBootstrapper(database *sql.DB, bootstrapToken string) *Bootstrapper {
	return &Bootstrapper{
		database:       database,
		bootstrapToken: bootstrapToken,
		hashPassword:   HashPassword,
	}
}

func (bootstrapper *Bootstrapper) Status(ctx context.Context) (bool, error) {
	var initialized bool
	err := bootstrapper.database.QueryRowContext(ctx, "SELECT EXISTS (SELECT 1 FROM users)").Scan(&initialized)
	return initialized, err
}

func (bootstrapper *Bootstrapper) Bootstrap(ctx context.Context, input BootstrapInput, providedToken string) (BootstrapResult, error) {
	result, _, err := bootstrapper.bootstrap(ctx, input, providedToken, "", "", false)
	return result, err
}

func (bootstrapper *Bootstrapper) BootstrapWithSession(ctx context.Context, input BootstrapInput, providedToken, ipAddress, userAgent string) (BootstrapResult, SessionCredentials, error) {
	return bootstrapper.bootstrap(ctx, input, providedToken, ipAddress, userAgent, true)
}

func (bootstrapper *Bootstrapper) bootstrap(ctx context.Context, input BootstrapInput, providedToken, ipAddress, userAgent string, createSession bool) (BootstrapResult, SessionCredentials, error) {
	input, err := validateBootstrapInput(input)
	if err != nil {
		return BootstrapResult{}, SessionCredentials{}, err
	}
	if !bootstrapTokenMatches(bootstrapper.bootstrapToken, providedToken) {
		return BootstrapResult{}, SessionCredentials{}, ErrInvalidBootstrapToken
	}

	transaction, err := bootstrapper.database.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return BootstrapResult{}, SessionCredentials{}, err
	}
	defer func() { _ = transaction.Rollback() }()
	if _, err := transaction.ExecContext(ctx, "SELECT pg_advisory_xact_lock(764680621013)"); err != nil {
		return BootstrapResult{}, SessionCredentials{}, err
	}
	var initialized bool
	if err := transaction.QueryRowContext(ctx, "SELECT EXISTS (SELECT 1 FROM users)").Scan(&initialized); err != nil {
		return BootstrapResult{}, SessionCredentials{}, err
	}
	if initialized {
		return BootstrapResult{}, SessionCredentials{}, ErrAlreadyInitialized
	}

	passwordHash, err := bootstrapper.hashPassword(input.Password)
	if err != nil {
		return BootstrapResult{}, SessionCredentials{}, fmt.Errorf("hash bootstrap password: %w", err)
	}
	result := BootstrapResult{UserID: uuid.New(), OrganizationID: uuid.New()}
	organizationSlug := slugify(input.OrganizationName)
	if _, err := transaction.ExecContext(ctx,
		"INSERT INTO users (id, email, display_name, password_hash) VALUES ($1, $2, $3, $4)",
		result.UserID, input.Email, input.DisplayName, passwordHash); err != nil {
		return BootstrapResult{}, SessionCredentials{}, fmt.Errorf("create bootstrap user: %w", err)
	}
	if _, err := transaction.ExecContext(ctx,
		"INSERT INTO organizations (id, name, slug, created_by) VALUES ($1, $2, $3, $4)",
		result.OrganizationID, input.OrganizationName, organizationSlug, result.UserID); err != nil {
		return BootstrapResult{}, SessionCredentials{}, fmt.Errorf("create bootstrap organization: %w", err)
	}
	if _, err := transaction.ExecContext(ctx,
		"INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'owner')",
		result.OrganizationID, result.UserID); err != nil {
		return BootstrapResult{}, SessionCredentials{}, fmt.Errorf("create bootstrap owner membership: %w", err)
	}
	if _, err := transaction.ExecContext(ctx,
		"INSERT INTO audit_logs (organization_id, actor_user_id, action, resource_type, resource_id, metadata) VALUES ($1, $2, 'instance.bootstrapped', 'organization', $1, $3)",
		result.OrganizationID, result.UserID, `{"source":"bootstrap"}`); err != nil {
		return BootstrapResult{}, SessionCredentials{}, fmt.Errorf("record bootstrap audit log: %w", err)
	}
	var credentials SessionCredentials
	if createSession {
		now := time.Now()
		var tokenHash [32]byte
		credentials, tokenHash, err = newSessionCredentials(now)
		if err != nil {
			return BootstrapResult{}, SessionCredentials{}, err
		}
		if _, err := transaction.ExecContext(ctx,
			`INSERT INTO sessions (id, user_id, token_hash, ip_hash, user_agent, expires_at, idle_expires_at, created_at, last_seen_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
			uuid.New(), result.UserID, tokenHash[:], hashOptional(ipAddress), truncateRunes(userAgent, 512),
			credentials.ExpiresAt, now.Add(SessionIdleTTL), now); err != nil {
			return BootstrapResult{}, SessionCredentials{}, fmt.Errorf("create bootstrap session: %w", err)
		}
	}
	if err := transaction.Commit(); err != nil {
		return BootstrapResult{}, SessionCredentials{}, err
	}
	return result, credentials, nil
}

func validateBootstrapInput(input BootstrapInput) (BootstrapInput, error) {
	input.Email = strings.ToLower(strings.TrimSpace(input.Email))
	input.DisplayName = strings.TrimSpace(input.DisplayName)
	input.OrganizationName = strings.TrimSpace(input.OrganizationName)
	parsedEmail, err := mail.ParseAddress(input.Email)
	if err != nil || parsedEmail.Address != input.Email || len(input.Email) > 320 {
		return BootstrapInput{}, &ValidationError{Field: "email"}
	}
	if count := utf8.RuneCountInString(input.DisplayName); count < 1 || count > 120 {
		return BootstrapInput{}, &ValidationError{Field: "displayName"}
	}
	if err := ValidatePassword(input.Password); err != nil {
		return BootstrapInput{}, err
	}
	if count := utf8.RuneCountInString(input.OrganizationName); count < 1 || count > 120 {
		return BootstrapInput{}, &ValidationError{Field: "organizationName"}
	}
	return input, nil
}

func bootstrapTokenMatches(expected, provided string) bool {
	if expected == "" {
		return true
	}
	expectedHash := sha256.Sum256([]byte(expected))
	providedHash := sha256.Sum256([]byte(provided))
	return subtle.ConstantTimeCompare(expectedHash[:], providedHash[:]) == 1
}

func slugify(value string) string {
	var builder strings.Builder
	lastWasSeparator := false
	for _, character := range strings.ToLower(value) {
		switch {
		case character >= 'a' && character <= 'z', character >= '0' && character <= '9':
			builder.WriteRune(character)
			lastWasSeparator = false
		case unicode.IsSpace(character), character == '-', character == '_':
			if builder.Len() > 0 && !lastWasSeparator {
				builder.WriteByte('-')
				lastWasSeparator = true
			}
		}
		if builder.Len() >= 63 {
			break
		}
	}
	result := strings.Trim(builder.String(), "-")
	if result == "" {
		return "organization"
	}
	return result
}
