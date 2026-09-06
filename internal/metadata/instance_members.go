package metadata

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/google/uuid"
)

const instanceMembershipLock int64 = 764680621014

type InstanceMemberView struct {
	UserID      uuid.UUID
	Email       string
	DisplayName string
	Role        InstanceRole
	CreatedBy   *uuid.UUID
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

type InstanceMemberRepository struct {
	database *sql.DB
}

func NewInstanceMemberRepository(database *sql.DB) *InstanceMemberRepository {
	return &InstanceMemberRepository{database: database}
}

func (repository *InstanceMemberRepository) RoleForUser(ctx context.Context, userID uuid.UUID) (InstanceRole, error) {
	var role InstanceRole
	err := repository.database.QueryRowContext(ctx,
		"SELECT role FROM instance_members WHERE user_id=$1", userID).Scan(&role)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrForbidden
	}
	return role, err
}

func (repository *InstanceMemberRepository) List(ctx context.Context) ([]InstanceMemberView, error) {
	rows, err := repository.database.QueryContext(ctx,
		`SELECT users.id, users.email, users.display_name, instance_members.role,
		        instance_members.created_by, instance_members.created_at, instance_members.updated_at
		 FROM instance_members
		 JOIN users ON users.id=instance_members.user_id
		 ORDER BY CASE instance_members.role WHEN 'instance_owner' THEN 0 ELSE 1 END,
		          users.display_name, users.id`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	members := make([]InstanceMemberView, 0)
	for rows.Next() {
		var member InstanceMemberView
		if err := rows.Scan(&member.UserID, &member.Email, &member.DisplayName, &member.Role,
			&member.CreatedBy, &member.CreatedAt, &member.UpdatedAt); err != nil {
			return nil, err
		}
		members = append(members, member)
	}
	return members, rows.Err()
}

func (repository *InstanceMemberRepository) Get(ctx context.Context, userID uuid.UUID) (InstanceMemberView, error) {
	var member InstanceMemberView
	err := repository.database.QueryRowContext(ctx,
		`SELECT users.id, users.email, users.display_name, instance_members.role,
		        instance_members.created_by, instance_members.created_at, instance_members.updated_at
		 FROM instance_members
		 JOIN users ON users.id=instance_members.user_id
		 WHERE instance_members.user_id=$1`, userID,
	).Scan(&member.UserID, &member.Email, &member.DisplayName, &member.Role,
		&member.CreatedBy, &member.CreatedAt, &member.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return InstanceMemberView{}, ErrNotFound
	}
	return member, err
}

func (repository *InstanceMemberRepository) FindActiveUserByEmail(ctx context.Context, email string) (User, error) {
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

func (repository *InstanceMemberRepository) Add(ctx context.Context, actorID, userID uuid.UUID, role InstanceRole) error {
	transaction, err := repository.database.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = transaction.Rollback() }()
	if err := lockInstanceMembership(ctx, transaction); err != nil {
		return err
	}
	if err := requireInstanceOwner(ctx, transaction, actorID); err != nil {
		return err
	}
	if _, err := transaction.ExecContext(ctx,
		"INSERT INTO instance_members (user_id, role, created_by) VALUES ($1, $2, $3)",
		userID, role, actorID); err != nil {
		return translateConstraintError(err)
	}
	return transaction.Commit()
}

func (repository *InstanceMemberRepository) UpdateRole(ctx context.Context, actorID, userID uuid.UUID, role InstanceRole) error {
	transaction, err := repository.database.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = transaction.Rollback() }()
	if err := lockInstanceMembership(ctx, transaction); err != nil {
		return err
	}
	if err := requireInstanceOwner(ctx, transaction, actorID); err != nil {
		return err
	}
	currentRole, err := instanceRoleForUpdate(ctx, transaction, userID)
	if err != nil {
		return err
	}
	if currentRole == InstanceRoleOwner && role != InstanceRoleOwner {
		owners, err := countInstanceOwners(ctx, transaction)
		if err != nil {
			return err
		}
		if owners <= 1 {
			return ErrLastInstanceOwner
		}
	}
	if _, err := transaction.ExecContext(ctx,
		"UPDATE instance_members SET role=$1, updated_at=now() WHERE user_id=$2", role, userID); err != nil {
		return err
	}
	return transaction.Commit()
}

func (repository *InstanceMemberRepository) Remove(ctx context.Context, actorID, userID uuid.UUID) error {
	transaction, err := repository.database.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = transaction.Rollback() }()
	if err := lockInstanceMembership(ctx, transaction); err != nil {
		return err
	}
	if err := requireInstanceOwner(ctx, transaction, actorID); err != nil {
		return err
	}
	currentRole, err := instanceRoleForUpdate(ctx, transaction, userID)
	if err != nil {
		return err
	}
	if currentRole == InstanceRoleOwner {
		owners, err := countInstanceOwners(ctx, transaction)
		if err != nil {
			return err
		}
		if owners <= 1 {
			return ErrLastInstanceOwner
		}
	}
	if _, err := transaction.ExecContext(ctx, "DELETE FROM instance_members WHERE user_id=$1", userID); err != nil {
		return err
	}
	return transaction.Commit()
}

func lockInstanceMembership(ctx context.Context, transaction *sql.Tx) error {
	_, err := transaction.ExecContext(ctx, "SELECT pg_advisory_xact_lock($1)", instanceMembershipLock)
	return err
}

func requireInstanceOwner(ctx context.Context, transaction *sql.Tx, userID uuid.UUID) error {
	role, err := instanceRoleForUpdate(ctx, transaction, userID)
	if errors.Is(err, ErrNotFound) {
		return ErrForbidden
	}
	if err != nil {
		return err
	}
	if role != InstanceRoleOwner {
		return ErrForbidden
	}
	return nil
}

func instanceRoleForUpdate(ctx context.Context, transaction *sql.Tx, userID uuid.UUID) (InstanceRole, error) {
	var role InstanceRole
	err := transaction.QueryRowContext(ctx,
		"SELECT role FROM instance_members WHERE user_id=$1 FOR UPDATE", userID).Scan(&role)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	return role, err
}

func countInstanceOwners(ctx context.Context, transaction *sql.Tx) (int, error) {
	var count int
	err := transaction.QueryRowContext(ctx,
		"SELECT count(*) FROM instance_members WHERE role='instance_owner'").Scan(&count)
	return count, err
}
