//go:build integration

package metadata

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestInstanceMemberRepositoryEnforcesOwnerBoundary(t *testing.T) {
	database := openIntegrationDatabase(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	ownerID := uuid.New()
	secondOwnerID := uuid.New()
	adminID := uuid.New()
	organizationOwnerID := uuid.New()
	organizationID := uuid.New()
	for id, email := range map[uuid.UUID]string{
		ownerID: "instance-owner@example.com", secondOwnerID: "second-instance-owner@example.com",
		adminID: "instance-admin@example.com", organizationOwnerID: "organization-owner-only@example.com",
	} {
		mustExecDatabase(t, ctx, database,
			"INSERT INTO users (id,email,display_name,password_hash) VALUES ($1,$2,$3,'hash')",
			id, email, email)
	}
	defer func() {
		_, _ = database.ExecContext(context.WithoutCancel(ctx), "DELETE FROM organizations WHERE id=$1", organizationID)
		_, _ = database.ExecContext(context.WithoutCancel(ctx),
			"DELETE FROM users WHERE id=ANY($1)", []uuid.UUID{ownerID, secondOwnerID, adminID, organizationOwnerID})
	}()
	mustExecDatabase(t, ctx, database,
		"INSERT INTO instance_members (user_id,role,created_by) VALUES ($1,'instance_owner',$1)", ownerID)
	mustExecDatabase(t, ctx, database,
		"INSERT INTO organizations (id,name,slug,created_by) VALUES ($1,'Organization Owner Only',$2,$3)",
		organizationID, "org-owner-only-"+organizationID.String(), organizationOwnerID)
	mustExecDatabase(t, ctx, database,
		"INSERT INTO organization_members (organization_id,user_id,role) VALUES ($1,$2,'owner')",
		organizationID, organizationOwnerID)

	repository := NewInstanceMemberRepository(database)
	if _, err := repository.RoleForUser(ctx, organizationOwnerID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("organization-only owner role lookup err=%v", err)
	}
	if err := repository.Add(ctx, organizationOwnerID, adminID, InstanceRoleAdmin); !errors.Is(err, ErrForbidden) {
		t.Fatalf("organization-only owner add err=%v", err)
	}
	if err := repository.Add(ctx, ownerID, adminID, InstanceRoleAdmin); err != nil {
		t.Fatal(err)
	}
	if err := repository.Add(ctx, adminID, secondOwnerID, InstanceRoleOwner); !errors.Is(err, ErrForbidden) {
		t.Fatalf("instance admin add err=%v", err)
	}
	if err := repository.UpdateRole(ctx, ownerID, ownerID, InstanceRoleAdmin); !errors.Is(err, ErrLastInstanceOwner) {
		t.Fatalf("sole owner demotion err=%v", err)
	}
	if err := repository.Remove(ctx, ownerID, ownerID); !errors.Is(err, ErrLastInstanceOwner) {
		t.Fatalf("sole owner removal err=%v", err)
	}
	if err := repository.Add(ctx, ownerID, secondOwnerID, InstanceRoleOwner); err != nil {
		t.Fatal(err)
	}
	if err := repository.UpdateRole(ctx, secondOwnerID, ownerID, InstanceRoleAdmin); err != nil {
		t.Fatal(err)
	}
	if err := repository.Remove(ctx, secondOwnerID, ownerID); err != nil {
		t.Fatal(err)
	}
}

func TestInstanceAdminRequiresPasswordBeforeApproval(t *testing.T) {
	database := openIntegrationDatabase(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	ownerID, pendingID := uuid.New(), uuid.New()
	for _, user := range []struct {
		id                      uuid.UUID
		email, source, password string
	}{
		{ownerID, "owner-" + ownerID.String() + "@example.test", "local", "hash"},
		{pendingID, "pending-" + pendingID.String() + "@example.test", "oidc", ""},
	} {
		var hash any = user.password
		if hash == "" {
			hash = nil
		}
		mustExecDatabase(t, ctx, database, "INSERT INTO users(id,email,display_name,password_hash,auth_source,access_status) VALUES($1,$2,'User',$3,$4,$5)",
			user.id, user.email, hash, user.source, map[bool]string{true: "pending", false: "approved"}[user.id == pendingID])
	}
	t.Cleanup(func() {
		_, _ = database.ExecContext(context.Background(), "DELETE FROM users WHERE id=ANY($1)", []uuid.UUID{ownerID, pendingID})
	})
	mustExecDatabase(t, ctx, database, "INSERT INTO instance_members(user_id,role,created_by) VALUES($1,'instance_owner',$1)", ownerID)
	repository := NewInstanceMemberRepository(database)
	if err := repository.Add(ctx, ownerID, pendingID, InstanceRoleAdmin); !errors.Is(err, ErrInstancePasswordRequired) {
		t.Fatalf("passwordless administrator was accepted: %v", err)
	}
	mustExecDatabase(t, ctx, database, "UPDATE users SET password_hash='hash' WHERE id=$1", pendingID)
	if err := repository.Add(ctx, ownerID, pendingID, InstanceRoleAdmin); err != nil {
		t.Fatal(err)
	}
	var status string
	if err := database.QueryRowContext(ctx, "SELECT access_status FROM users WHERE id=$1", pendingID).Scan(&status); err != nil || status != "approved" {
		t.Fatalf("status=%q err=%v", status, err)
	}
}

func mustExecDatabase(t *testing.T, ctx context.Context, database interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}, query string, arguments ...any) {
	t.Helper()
	if _, err := database.ExecContext(ctx, query, arguments...); err != nil {
		t.Fatalf("execute %q: %v", query, err)
	}
}
