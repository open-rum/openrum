//go:build integration

package metadata

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestControlPlaneConstraints(t *testing.T) {
	database := openIntegrationDatabase(t)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	transaction, err := database.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = transaction.Rollback() }()

	expectConstraint(t, ctx, transaction,
		"INSERT INTO users (email, display_name, auth_source) VALUES ($1, $2, 'local')",
		"invalid-local@example.com", "Invalid Local")

	userID := uuid.New()
	organizationID := uuid.New()
	projectID := uuid.New()
	mustExec(t, ctx, transaction,
		"INSERT INTO users (id, email, display_name, password_hash) VALUES ($1, $2, $3, $4)",
		userID, "owner@example.com", "Owner", "argon2id-placeholder")
	mustExec(t, ctx, transaction,
		"INSERT INTO organizations (id, name, slug, created_by) VALUES ($1, $2, $3, $4)",
		organizationID, "Example", "example", userID)
	mustExec(t, ctx, transaction,
		"INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'owner')",
		organizationID, userID)

	expectConstraint(t, ctx, transaction,
		"INSERT INTO projects (organization_id, name, slug, retention_days) VALUES ($1, $2, $3, 91)",
		organizationID, "Invalid Retention", "invalid-retention")
	mustExec(t, ctx, transaction,
		"INSERT INTO projects (id, organization_id, name, slug) VALUES ($1, $2, $3, $4)",
		projectID, organizationID, "Web", "web")
	expectConstraint(t, ctx, transaction,
		"INSERT INTO projects (organization_id, name, slug) VALUES ($1, $2, $3)",
		organizationID, "Duplicate", "web")
	expectConstraint(t, ctx, transaction,
		"INSERT INTO project_keys (project_id, key_prefix, key_hash, name) VALUES ($1, $2, $3, $4)",
		projectID, "orr_bad12", []byte("too-short"), "Invalid key")
	expectConstraint(t, ctx, transaction,
		"INSERT INTO sessions (user_id, token_hash, expires_at, idle_expires_at) VALUES ($1, $2, now(), now() + interval '1 hour')",
		userID, make([]byte, 32))
	expectConstraint(t, ctx, transaction,
		"INSERT INTO audit_logs (organization_id, actor_user_id, action, resource_type, metadata) VALUES ($1, $2, $3, $4, $5)",
		organizationID, userID, "project.created", "project", `[]`)
}

func expectConstraint(t *testing.T, ctx context.Context, transaction *sql.Tx, query string, arguments ...any) {
	t.Helper()
	mustExec(t, ctx, transaction, "SAVEPOINT constraint_check")
	if _, err := transaction.ExecContext(ctx, query, arguments...); err == nil {
		t.Fatalf("query unexpectedly satisfied its constraint: %s", query)
	}
	mustExec(t, ctx, transaction, "ROLLBACK TO SAVEPOINT constraint_check")
}

func mustExec(t *testing.T, ctx context.Context, transaction *sql.Tx, query string, arguments ...any) {
	t.Helper()
	if _, err := transaction.ExecContext(ctx, query, arguments...); err != nil {
		t.Fatalf("execute %q: %v", query, err)
	}
}
