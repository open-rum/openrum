package metadata

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
)

var (
	ErrNotFound                 = errors.New("resource not found")
	ErrLastOwner                = errors.New("organization must retain an owner")
	ErrLastInstanceOwner        = errors.New("instance must retain an owner")
	ErrInstancePasswordRequired = errors.New("instance administrator must have an OpenRUM password")
	ErrForbidden                = errors.New("operation is forbidden")
	ErrConflict                 = errors.New("resource already exists")
)

type OrganizationAccess struct {
	Organization Organization
	Role         OrganizationRole
}

type OrganizationMemberView struct {
	UserID      uuid.UUID
	Email       string
	DisplayName string
	Role        OrganizationRole
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

type OrganizationRepository struct {
	database *sql.DB
}

func NewOrganizationRepository(database *sql.DB) *OrganizationRepository {
	return &OrganizationRepository{database: database}
}

func (repository *OrganizationRepository) ListForUser(ctx context.Context, userID uuid.UUID) ([]OrganizationAccess, error) {
	rows, err := repository.database.QueryContext(ctx,
		`SELECT organizations.id, organizations.name, organizations.slug, organizations.created_by,
		        organizations.created_at, organizations.updated_at, organization_members.role
		 FROM organizations
		 JOIN organization_members ON organization_members.organization_id=organizations.id
		 WHERE organization_members.user_id=$1
		 ORDER BY organizations.name, organizations.id`, userID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	accesses := make([]OrganizationAccess, 0)
	for rows.Next() {
		var access OrganizationAccess
		if err := rows.Scan(&access.Organization.ID, &access.Organization.Name, &access.Organization.Slug,
			&access.Organization.CreatedBy, &access.Organization.CreatedAt, &access.Organization.UpdatedAt, &access.Role); err != nil {
			return nil, err
		}
		accesses = append(accesses, access)
	}
	return accesses, rows.Err()
}

func (repository *OrganizationRepository) Create(ctx context.Context, actorID uuid.UUID, name, slug string) (OrganizationAccess, error) {
	transaction, err := repository.database.BeginTx(ctx, nil)
	if err != nil {
		return OrganizationAccess{}, err
	}
	defer func() { _ = transaction.Rollback() }()
	organization := Organization{ID: uuid.New(), Name: name, Slug: slug, CreatedBy: actorID}
	err = transaction.QueryRowContext(ctx,
		`INSERT INTO organizations (id, name, slug, created_by) VALUES ($1, $2, $3, $4)
		 RETURNING created_at, updated_at`, organization.ID, organization.Name, organization.Slug, actorID,
	).Scan(&organization.CreatedAt, &organization.UpdatedAt)
	if err != nil {
		return OrganizationAccess{}, translateConstraintError(err)
	}
	if _, err := transaction.ExecContext(ctx,
		"INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'owner')",
		organization.ID, actorID); err != nil {
		return OrganizationAccess{}, err
	}
	if err := insertAudit(ctx, transaction, organization.ID, actorID, "organization.created", "organization", organization.ID); err != nil {
		return OrganizationAccess{}, err
	}
	if err := transaction.Commit(); err != nil {
		return OrganizationAccess{}, err
	}
	return OrganizationAccess{Organization: organization, Role: RoleOwner}, nil
}

func (repository *OrganizationRepository) GetForUser(ctx context.Context, userID, organizationID uuid.UUID) (OrganizationAccess, error) {
	var access OrganizationAccess
	err := repository.database.QueryRowContext(ctx,
		`SELECT organizations.id, organizations.name, organizations.slug, organizations.created_by,
		        organizations.created_at, organizations.updated_at, organization_members.role
		 FROM organizations
		 JOIN organization_members ON organization_members.organization_id=organizations.id
		 WHERE organizations.id=$1 AND organization_members.user_id=$2`,
		organizationID, userID,
	).Scan(&access.Organization.ID, &access.Organization.Name, &access.Organization.Slug,
		&access.Organization.CreatedBy, &access.Organization.CreatedAt, &access.Organization.UpdatedAt, &access.Role)
	if errors.Is(err, sql.ErrNoRows) {
		return OrganizationAccess{}, ErrNotFound
	}
	return access, err
}

func (repository *OrganizationRepository) ListMembers(ctx context.Context, actorID, organizationID uuid.UUID) ([]OrganizationMemberView, error) {
	if _, err := repository.GetForUser(ctx, actorID, organizationID); err != nil {
		return nil, err
	}
	rows, err := repository.database.QueryContext(ctx,
		`SELECT users.id, users.email, users.display_name, organization_members.role,
		        organization_members.created_at, organization_members.updated_at
		 FROM organization_members
		 JOIN users ON users.id=organization_members.user_id
		 WHERE organization_members.organization_id=$1
		 ORDER BY users.display_name, users.id`, organizationID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	members := make([]OrganizationMemberView, 0)
	for rows.Next() {
		var member OrganizationMemberView
		if err := rows.Scan(&member.UserID, &member.Email, &member.DisplayName, &member.Role,
			&member.CreatedAt, &member.UpdatedAt); err != nil {
			return nil, err
		}
		members = append(members, member)
	}
	return members, rows.Err()
}

func (repository *OrganizationRepository) GetMember(ctx context.Context, actorID, organizationID, userID uuid.UUID) (OrganizationMemberView, error) {
	var member OrganizationMemberView
	err := repository.database.QueryRowContext(ctx,
		`SELECT target.id, target.email, target.display_name, target_membership.role,
		        target_membership.created_at, target_membership.updated_at
		 FROM organization_members AS actor_membership
		 JOIN organization_members AS target_membership
		   ON target_membership.organization_id=actor_membership.organization_id
		 JOIN users AS target ON target.id=target_membership.user_id
		 WHERE actor_membership.organization_id=$1 AND actor_membership.user_id=$2
		   AND target_membership.user_id=$3`, organizationID, actorID, userID,
	).Scan(&member.UserID, &member.Email, &member.DisplayName, &member.Role, &member.CreatedAt, &member.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return OrganizationMemberView{}, ErrNotFound
	}
	return member, err
}

func (repository *OrganizationRepository) FindActiveUserByEmail(ctx context.Context, email string) (User, error) {
	var user User
	err := repository.database.QueryRowContext(ctx,
		`SELECT id, email, display_name, password_hash, status, auth_source, oidc_subject, created_at, updated_at
		 FROM users WHERE email=$1 AND status='active'`, email,
	).Scan(&user.ID, &user.Email, &user.DisplayName, &user.PasswordHash, &user.Status, &user.AuthSource,
		&user.OIDCSubject, &user.CreatedAt, &user.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, ErrNotFound
	}
	return user, err
}

func (repository *OrganizationRepository) AddMember(ctx context.Context, actorID, organizationID, userID uuid.UUID, role OrganizationRole) error {
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
	if _, err := transaction.ExecContext(ctx,
		"INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, $3)",
		organizationID, userID, role); err != nil {
		return translateConstraintError(err)
	}
	if _, err := transaction.ExecContext(ctx, "UPDATE users SET access_status='approved', updated_at=now() WHERE id=$1 AND access_status='pending'", userID); err != nil {
		return err
	}
	if err := insertAudit(ctx, transaction, organizationID, actorID, "member.added", "user", userID); err != nil {
		return err
	}
	return transaction.Commit()
}

func (repository *OrganizationRepository) UpdateMemberRole(ctx context.Context, actorID, organizationID, userID uuid.UUID, role OrganizationRole) error {
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
	currentRole, err := lockMembership(ctx, transaction, organizationID, userID)
	if err != nil {
		return err
	}
	if !canManageMembers(actorRole) || (actorRole != RoleOwner && (currentRole == RoleOwner || role == RoleOwner)) {
		return ErrForbidden
	}
	if currentRole == RoleOwner && role != RoleOwner {
		owners, err := lockAndCountOwners(ctx, transaction, organizationID)
		if err != nil {
			return err
		}
		if owners <= 1 {
			return ErrLastOwner
		}
	}
	if _, err := transaction.ExecContext(ctx,
		"UPDATE organization_members SET role=$1, updated_at=now() WHERE organization_id=$2 AND user_id=$3",
		role, organizationID, userID); err != nil {
		return err
	}
	if err := insertAudit(ctx, transaction, organizationID, actorID, "member.role_updated", "user", userID); err != nil {
		return err
	}
	return transaction.Commit()
}

func (repository *OrganizationRepository) RemoveMember(ctx context.Context, actorID, organizationID, userID uuid.UUID) error {
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
	currentRole, err := lockMembership(ctx, transaction, organizationID, userID)
	if err != nil {
		return err
	}
	if !canManageMembers(actorRole) || (actorRole != RoleOwner && currentRole == RoleOwner) {
		return ErrForbidden
	}
	if currentRole == RoleOwner {
		owners, err := lockAndCountOwners(ctx, transaction, organizationID)
		if err != nil {
			return err
		}
		if owners <= 1 {
			return ErrLastOwner
		}
	}
	if _, err := transaction.ExecContext(ctx,
		"DELETE FROM organization_members WHERE organization_id=$1 AND user_id=$2",
		organizationID, userID); err != nil {
		return err
	}
	if err := insertAudit(ctx, transaction, organizationID, actorID, "member.removed", "user", userID); err != nil {
		return err
	}
	return transaction.Commit()
}

func lockOrganization(ctx context.Context, transaction *sql.Tx, organizationID uuid.UUID) error {
	var id uuid.UUID
	err := transaction.QueryRowContext(ctx,
		"SELECT id FROM organizations WHERE id=$1 FOR UPDATE", organizationID).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

func lockMembership(ctx context.Context, transaction *sql.Tx, organizationID, userID uuid.UUID) (OrganizationRole, error) {
	var role OrganizationRole
	err := transaction.QueryRowContext(ctx,
		"SELECT role FROM organization_members WHERE organization_id=$1 AND user_id=$2 FOR UPDATE",
		organizationID, userID).Scan(&role)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	return role, err
}

func lockAndCountOwners(ctx context.Context, transaction *sql.Tx, organizationID uuid.UUID) (int, error) {
	rows, err := transaction.QueryContext(ctx,
		"SELECT user_id FROM organization_members WHERE organization_id=$1 AND role='owner' ORDER BY user_id FOR UPDATE",
		organizationID)
	if err != nil {
		return 0, err
	}
	defer func() { _ = rows.Close() }()
	count := 0
	for rows.Next() {
		count++
	}
	return count, rows.Err()
}

func canManageMembers(role OrganizationRole) bool {
	return role == RoleOwner || role == RoleAdmin
}

func insertAudit(ctx context.Context, transaction *sql.Tx, organizationID, actorID uuid.UUID, action, resourceType string, resourceID uuid.UUID) error {
	if _, err := transaction.ExecContext(ctx,
		"INSERT INTO audit_logs (organization_id, actor_user_id, action, resource_type, resource_id) VALUES ($1, $2, $3, $4, $5)",
		organizationID, actorID, action, resourceType, resourceID); err != nil {
		return fmt.Errorf("insert audit log: %w", err)
	}
	return nil
}
