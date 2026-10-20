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
	InvitationPrefix = "ori_"
	// InvitationTTL is how long a link works. A link only lets its holder ask to join, so a
	// week is long enough to be forwarded without becoming a standing door.
	InvitationTTL = 7 * 24 * time.Hour
	// MaxActiveInvitations and MaxPendingJoinRequests bound what a leaked link or a hostile
	// visitor can pile up for an administrator to read.
	MaxActiveInvitations   = 50
	MaxPendingJoinRequests = 200

	invitationTokenLength = 128
)

var (
	// ErrInvitationInvalid covers a link that does not exist, has expired or was revoked. The
	// caller is not told which: only the preview distinguishes them, and only for a real link.
	ErrInvitationInvalid = errors.New("invitation is not valid")
	// ErrInvitationLimit means the organization already holds as many open invitations or
	// pending requests as it may.
	ErrInvitationLimit = errors.New("invitation limit reached")
)

type InvitationState string

const (
	InvitationValid   InvitationState = "valid"
	InvitationExpired InvitationState = "expired"
	InvitationRevoked InvitationState = "revoked"
)

// InvitationRoles are the roles a link can offer. Owner is never offered by a link.
func InvitationRole(role OrganizationRole) bool {
	return role == RoleAdmin || role == RoleMember || role == RoleViewer
}

type Invitation struct {
	ID            uuid.UUID
	Role          OrganizationRole
	Email         *string
	CreatedByName *string
	CreatedAt     time.Time
	ExpiresAt     time.Time
}

type InvitationCredential struct {
	Invitation Invitation
	// Secret is the link's token. It is returned once; only its hash is stored.
	Secret string
}

// InvitationPreview is everything a visitor who holds a link may learn about it.
type InvitationPreview struct {
	OrganizationName string
	InviterName      *string
	Role             OrganizationRole
	State            InvitationState
}

type JoinRequestView struct {
	ID          uuid.UUID
	UserID      uuid.UUID
	Email       string
	DisplayName string
	Avatar      string
	Role        OrganizationRole
	CreatedAt   time.Time
}

type JoinOutcome string

const (
	JoinRequested        JoinOutcome = "requested"
	JoinAlreadyRequested JoinOutcome = "already_requested"
	JoinAlreadyMember    JoinOutcome = "already_member"
)

type InvitationRegistration struct {
	Email        string
	DisplayName  string
	PasswordHash string
}

type InvitationRegistrationResult struct {
	UserID           uuid.UUID
	OrganizationName string
}

type InvitationRepository struct {
	database *sql.DB
	now      func() time.Time
}

func NewInvitationRepository(database *sql.DB) *InvitationRepository {
	return &InvitationRepository{database: database, now: time.Now}
}

func (repository *InvitationRepository) Create(ctx context.Context, actorID, organizationID uuid.UUID, role OrganizationRole, email *string) (InvitationCredential, error) {
	if !InvitationRole(role) {
		return InvitationCredential{}, ErrForbidden
	}
	randomBytes := make([]byte, 32)
	if _, err := rand.Read(randomBytes); err != nil {
		return InvitationCredential{}, fmt.Errorf("generate invitation token: %w", err)
	}
	secret := InvitationPrefix + base64.RawURLEncoding.EncodeToString(randomBytes)
	digest := sha256.Sum256([]byte(secret))

	transaction, err := repository.database.BeginTx(ctx, nil)
	if err != nil {
		return InvitationCredential{}, err
	}
	defer func() { _ = transaction.Rollback() }()
	if err := requireMemberManager(ctx, transaction, actorID, organizationID); err != nil {
		return InvitationCredential{}, err
	}
	now := repository.now()
	var open int
	if err := transaction.QueryRowContext(ctx,
		`SELECT count(*) FROM organization_invitations
		 WHERE organization_id=$1 AND revoked_at IS NULL AND expires_at > $2`, organizationID, now).Scan(&open); err != nil {
		return InvitationCredential{}, err
	}
	if open >= MaxActiveInvitations {
		return InvitationCredential{}, errors.Join(ErrConflict, ErrInvitationLimit)
	}
	invitation := Invitation{ID: uuid.New(), Role: role, Email: email, ExpiresAt: now.Add(InvitationTTL)}
	err = transaction.QueryRowContext(ctx,
		`INSERT INTO organization_invitations (id, organization_id, token_hash, role, email, created_by, created_at, expires_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		 RETURNING created_at, (SELECT display_name FROM users WHERE id=$6)`,
		invitation.ID, organizationID, digest[:], role, email, actorID, now, invitation.ExpiresAt,
	).Scan(&invitation.CreatedAt, &invitation.CreatedByName)
	if err != nil {
		return InvitationCredential{}, translateConstraintError(err)
	}
	if err := insertAudit(ctx, transaction, organizationID, actorID, "member_invitation.created", "member_invitation", invitation.ID); err != nil {
		return InvitationCredential{}, err
	}
	if err := transaction.Commit(); err != nil {
		return InvitationCredential{}, err
	}
	return InvitationCredential{Invitation: invitation, Secret: secret}, nil
}

// List returns the links that still work, newest first.
func (repository *InvitationRepository) List(ctx context.Context, actorID, organizationID uuid.UUID) ([]Invitation, error) {
	transaction, err := repository.database.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer func() { _ = transaction.Rollback() }()
	if err := requireMemberManagerShared(ctx, transaction, actorID, organizationID); err != nil {
		return nil, err
	}
	rows, err := transaction.QueryContext(ctx,
		`SELECT i.id, i.role, i.email, u.display_name, i.created_at, i.expires_at
		 FROM organization_invitations i LEFT JOIN users u ON u.id=i.created_by
		 WHERE i.organization_id=$1 AND i.revoked_at IS NULL AND i.expires_at > $2
		 ORDER BY i.created_at DESC, i.id`, organizationID, repository.now())
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	invitations := make([]Invitation, 0)
	for rows.Next() {
		var invitation Invitation
		if err := rows.Scan(&invitation.ID, &invitation.Role, &invitation.Email, &invitation.CreatedByName,
			&invitation.CreatedAt, &invitation.ExpiresAt); err != nil {
			return nil, err
		}
		invitations = append(invitations, invitation)
	}
	return invitations, rows.Err()
}

// Revoke is idempotent: revoking a link twice succeeds without a second audit entry.
func (repository *InvitationRepository) Revoke(ctx context.Context, actorID, organizationID, invitationID uuid.UUID) error {
	transaction, err := repository.database.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = transaction.Rollback() }()
	if err := requireMemberManager(ctx, transaction, actorID, organizationID); err != nil {
		return err
	}
	result, err := transaction.ExecContext(ctx,
		`UPDATE organization_invitations SET revoked_at=now()
		 WHERE id=$1 AND organization_id=$2 AND revoked_at IS NULL`, invitationID, organizationID)
	if err != nil {
		return err
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if changed == 0 {
		var exists bool
		if err := transaction.QueryRowContext(ctx,
			"SELECT EXISTS (SELECT 1 FROM organization_invitations WHERE id=$1 AND organization_id=$2)",
			invitationID, organizationID).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return ErrNotFound
		}
		return transaction.Commit()
	}
	if err := insertAudit(ctx, transaction, organizationID, actorID, "member_invitation.revoked", "member_invitation", invitationID); err != nil {
		return err
	}
	return transaction.Commit()
}

// Inspect tells a visitor what a link is for. An unknown token is ErrNotFound.
func (repository *InvitationRepository) Inspect(ctx context.Context, token string) (InvitationPreview, error) {
	hash, ok := invitationHash(token)
	if !ok {
		return InvitationPreview{}, ErrNotFound
	}
	loaded, err := loadInvitation(ctx, repository.database, hash, repository.now())
	if err != nil {
		return InvitationPreview{}, err
	}
	return loaded.preview(), nil
}

// Join records that a signed-in user asks to join through a link. It grants nothing.
func (repository *InvitationRepository) Join(ctx context.Context, userID uuid.UUID, token string) (JoinOutcome, InvitationPreview, error) {
	hash, ok := invitationHash(token)
	if !ok {
		return "", InvitationPreview{}, ErrInvitationInvalid
	}
	transaction, err := repository.database.BeginTx(ctx, nil)
	if err != nil {
		return "", InvitationPreview{}, err
	}
	defer func() { _ = transaction.Rollback() }()
	loaded, err := loadAndLock(ctx, transaction, hash, repository.now())
	if errors.Is(err, ErrNotFound) {
		return "", InvitationPreview{}, ErrInvitationInvalid
	}
	if err != nil {
		return "", InvitationPreview{}, err
	}
	if loaded.state != InvitationValid {
		return "", loaded.preview(), ErrInvitationInvalid
	}
	var member bool
	if err := transaction.QueryRowContext(ctx,
		"SELECT EXISTS (SELECT 1 FROM organization_members WHERE organization_id=$1 AND user_id=$2)",
		loaded.organizationID, userID).Scan(&member); err != nil {
		return "", InvitationPreview{}, err
	}
	if member {
		return JoinAlreadyMember, loaded.preview(), nil
	}
	var pending bool
	if err := transaction.QueryRowContext(ctx,
		`SELECT EXISTS (SELECT 1 FROM organization_join_requests
		 WHERE organization_id=$1 AND user_id=$2 AND status='pending')`,
		loaded.organizationID, userID).Scan(&pending); err != nil {
		return "", InvitationPreview{}, err
	}
	if pending {
		return JoinAlreadyRequested, loaded.preview(), nil
	}
	if err := insertJoinRequest(ctx, transaction, loaded, userID); err != nil {
		return "", InvitationPreview{}, err
	}
	if err := transaction.Commit(); err != nil {
		return "", InvitationPreview{}, err
	}
	return JoinRequested, loaded.preview(), nil
}

// Register creates the account of someone who holds a link, together with their request to
// join. The account stays pending, so it can sign in and wait but reach nothing, until an
// administrator approves the request.
func (repository *InvitationRepository) Register(ctx context.Context, token string, input InvitationRegistration) (InvitationRegistrationResult, error) {
	hash, ok := invitationHash(token)
	if !ok {
		return InvitationRegistrationResult{}, ErrInvitationInvalid
	}
	transaction, err := repository.database.BeginTx(ctx, nil)
	if err != nil {
		return InvitationRegistrationResult{}, err
	}
	defer func() { _ = transaction.Rollback() }()
	loaded, err := loadAndLock(ctx, transaction, hash, repository.now())
	if errors.Is(err, ErrNotFound) {
		return InvitationRegistrationResult{}, ErrInvitationInvalid
	}
	if err != nil {
		return InvitationRegistrationResult{}, err
	}
	if loaded.state != InvitationValid {
		return InvitationRegistrationResult{}, ErrInvitationInvalid
	}
	userID := uuid.New()
	if _, err := transaction.ExecContext(ctx,
		`INSERT INTO users (id, email, display_name, password_hash, access_status)
		 VALUES ($1,$2,$3,$4,'pending')`,
		userID, input.Email, input.DisplayName, input.PasswordHash); err != nil {
		return InvitationRegistrationResult{}, translateConstraintError(err)
	}
	if err := insertJoinRequest(ctx, transaction, loaded, userID); err != nil {
		return InvitationRegistrationResult{}, err
	}
	if err := transaction.Commit(); err != nil {
		return InvitationRegistrationResult{}, err
	}
	return InvitationRegistrationResult{UserID: userID, OrganizationName: loaded.organizationName}, nil
}

func (repository *InvitationRepository) ListJoinRequests(ctx context.Context, actorID, organizationID uuid.UUID) ([]JoinRequestView, error) {
	transaction, err := repository.database.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer func() { _ = transaction.Rollback() }()
	if err := requireMemberManagerShared(ctx, transaction, actorID, organizationID); err != nil {
		return nil, err
	}
	rows, err := transaction.QueryContext(ctx,
		`SELECT r.id, r.user_id, u.email, u.display_name, COALESCE(u.avatar, ''), r.role, r.created_at
		 FROM organization_join_requests r JOIN users u ON u.id=r.user_id
		 WHERE r.organization_id=$1 AND r.status='pending'
		 ORDER BY r.created_at, r.id`, organizationID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	requests := make([]JoinRequestView, 0)
	for rows.Next() {
		var request JoinRequestView
		if err := rows.Scan(&request.ID, &request.UserID, &request.Email, &request.DisplayName, &request.Avatar, &request.Role, &request.CreatedAt); err != nil {
			return nil, err
		}
		requests = append(requests, request)
	}
	return requests, rows.Err()
}

// Approve makes the requester a member with the given role, using the same rules as adding
// a member directly: only an Owner can grant Owner, and a pending account becomes approved.
func (repository *InvitationRepository) Approve(ctx context.Context, actorID, organizationID, requestID uuid.UUID, role OrganizationRole) error {
	transaction, err := repository.database.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = transaction.Rollback() }()
	if err := lockOrganization(ctx, transaction, organizationID); err != nil {
		return err
	}
	actorRole, err := lockMembership(ctx, transaction, organizationID, actorID)
	if err != nil {
		return err
	}
	if !canManageMembers(actorRole) || (role == RoleOwner && actorRole != RoleOwner) {
		return ErrForbidden
	}
	var userID uuid.UUID
	err = transaction.QueryRowContext(ctx,
		`SELECT user_id FROM organization_join_requests
		 WHERE id=$1 AND organization_id=$2 AND status='pending' FOR UPDATE`, requestID, organizationID).Scan(&userID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	// Someone may have been added by hand since they asked; the request is then just closed.
	inserted, err := transaction.ExecContext(ctx,
		`INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1,$2,$3)
		 ON CONFLICT (organization_id, user_id) DO NOTHING`, organizationID, userID, role)
	if err != nil {
		return err
	}
	if _, err := transaction.ExecContext(ctx,
		"UPDATE users SET access_status='approved', updated_at=now() WHERE id=$1 AND access_status='pending'", userID); err != nil {
		return err
	}
	if _, err := transaction.ExecContext(ctx,
		`UPDATE organization_join_requests SET status='approved', role=$2, decided_by=$3, decided_at=now() WHERE id=$1`,
		requestID, role, actorID); err != nil {
		return err
	}
	if added, _ := inserted.RowsAffected(); added > 0 {
		if err := insertAudit(ctx, transaction, organizationID, actorID, "member.added", "user", userID); err != nil {
			return err
		}
	}
	if err := insertAudit(ctx, transaction, organizationID, actorID, "join_request.approved", "join_request", requestID); err != nil {
		return err
	}
	return transaction.Commit()
}

func (repository *InvitationRepository) Reject(ctx context.Context, actorID, organizationID, requestID uuid.UUID) error {
	transaction, err := repository.database.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = transaction.Rollback() }()
	if err := requireMemberManager(ctx, transaction, actorID, organizationID); err != nil {
		return err
	}
	result, err := transaction.ExecContext(ctx,
		`UPDATE organization_join_requests SET status='rejected', decided_by=$3, decided_at=now()
		 WHERE id=$1 AND organization_id=$2 AND status='pending'`, requestID, organizationID, actorID)
	if err != nil {
		return err
	}
	if changed, err := result.RowsAffected(); err != nil {
		return err
	} else if changed == 0 {
		return ErrNotFound
	}
	if err := insertAudit(ctx, transaction, organizationID, actorID, "join_request.rejected", "join_request", requestID); err != nil {
		return err
	}
	return transaction.Commit()
}

// PendingOrganizations names the organizations a user has asked to join and not yet heard
// back from, for the page a pending account waits on.
func (repository *InvitationRepository) PendingOrganizations(ctx context.Context, userID uuid.UUID) ([]string, error) {
	rows, err := repository.database.QueryContext(ctx,
		`SELECT o.name FROM organization_join_requests r JOIN organizations o ON o.id=r.organization_id
		 WHERE r.user_id=$1 AND r.status='pending' ORDER BY r.created_at, r.id`, userID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	names := make([]string, 0)
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		names = append(names, name)
	}
	return names, rows.Err()
}

type loadedInvitation struct {
	id               uuid.UUID
	organizationID   uuid.UUID
	organizationName string
	inviterName      *string
	role             OrganizationRole
	state            InvitationState
}

func (loaded loadedInvitation) preview() InvitationPreview {
	return InvitationPreview{
		OrganizationName: loaded.organizationName, InviterName: loaded.inviterName, Role: loaded.role, State: loaded.state,
	}
}

type invitationQueryer interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

func loadInvitation(ctx context.Context, queryer invitationQueryer, hash []byte, now time.Time) (loadedInvitation, error) {
	query := `SELECT i.id, i.organization_id, o.name, u.display_name, i.role, i.revoked_at IS NOT NULL, i.expires_at <= $2
	          FROM organization_invitations i
	          JOIN organizations o ON o.id=i.organization_id
	          LEFT JOIN users u ON u.id=i.created_by
	          WHERE i.token_hash=$1`
	var loaded loadedInvitation
	var revoked, expired bool
	err := queryer.QueryRowContext(ctx, query, hash, now).Scan(
		&loaded.id, &loaded.organizationID, &loaded.organizationName, &loaded.inviterName, &loaded.role, &revoked, &expired)
	if errors.Is(err, sql.ErrNoRows) {
		return loadedInvitation{}, ErrNotFound
	}
	if err != nil {
		return loadedInvitation{}, err
	}
	switch {
	case revoked:
		loaded.state = InvitationRevoked
	case expired:
		loaded.state = InvitationExpired
	default:
		loaded.state = InvitationValid
	}
	return loaded, nil
}

// loadAndLock finds the invitation, takes the organization lock and reads the invitation
// again, so a revocation that committed in between is seen. The organization is always
// locked before anything else, as Revoke does, which keeps the two from deadlocking and
// serializes requests to one organization so the pending cap holds.
func loadAndLock(ctx context.Context, transaction *sql.Tx, hash []byte, now time.Time) (loadedInvitation, error) {
	loaded, err := loadInvitation(ctx, transaction, hash, now)
	if err != nil {
		return loadedInvitation{}, err
	}
	if err := lockOrganization(ctx, transaction, loaded.organizationID); err != nil {
		return loadedInvitation{}, err
	}
	return loadInvitation(ctx, transaction, hash, now)
}

// insertJoinRequest runs inside a transaction that already holds the organization lock.
func insertJoinRequest(ctx context.Context, transaction *sql.Tx, loaded loadedInvitation, userID uuid.UUID) error {
	var pending int
	if err := transaction.QueryRowContext(ctx,
		"SELECT count(*) FROM organization_join_requests WHERE organization_id=$1 AND status='pending'",
		loaded.organizationID).Scan(&pending); err != nil {
		return err
	}
	if pending >= MaxPendingJoinRequests {
		return errors.Join(ErrConflict, ErrInvitationLimit)
	}
	requestID := uuid.New()
	if _, err := transaction.ExecContext(ctx,
		`INSERT INTO organization_join_requests (id, organization_id, invitation_id, user_id, role)
		 VALUES ($1,$2,$3,$4,$5)`, requestID, loaded.organizationID, loaded.id, userID, loaded.role); err != nil {
		return translateConstraintError(err)
	}
	return insertAudit(ctx, transaction, loaded.organizationID, userID, "join_request.created", "join_request", requestID)
}

func requireMemberManager(ctx context.Context, transaction *sql.Tx, actorID, organizationID uuid.UUID) error {
	if err := lockOrganization(ctx, transaction, organizationID); err != nil {
		return err
	}
	role, err := lockMembership(ctx, transaction, organizationID, actorID)
	if err != nil {
		return err
	}
	if !canManageMembers(role) {
		return ErrForbidden
	}
	return nil
}

// requireMemberManagerShared is the read-only form: it needs no row locks.
func requireMemberManagerShared(ctx context.Context, transaction *sql.Tx, actorID, organizationID uuid.UUID) error {
	var role OrganizationRole
	err := transaction.QueryRowContext(ctx,
		"SELECT role FROM organization_members WHERE organization_id=$1 AND user_id=$2", organizationID, actorID).Scan(&role)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if !canManageMembers(role) {
		return ErrForbidden
	}
	return nil
}

func invitationHash(token string) ([]byte, bool) {
	token = strings.TrimSpace(token)
	if !strings.HasPrefix(token, InvitationPrefix) || len(token) > invitationTokenLength {
		return nil, false
	}
	digest := sha256.Sum256([]byte(token))
	return digest[:], true
}
