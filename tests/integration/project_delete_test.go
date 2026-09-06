//go:build integration

package integration_test

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"openrum/internal/metadata"
	"openrum/internal/migrate"
	"openrum/migrations"
)

func TestDeletionRequestIsOwnerOnlyAndImmediatelyRevokesAccess(t *testing.T) {
	dsn := os.Getenv("TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("TEST_POSTGRES_DSN is required")
	}
	if !strings.Contains(dsn, "openrum_test") {
		t.Fatal("refusing deletion integration test outside openrum_test")
	}
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	database, err := metadata.OpenPostgres(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = database.Close() }()
	if err := migrate.PostgresUp(ctx, database, migrations.Files); err != nil {
		t.Fatal(err)
	}
	ownerID, memberID, organizationID, projectID := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	for _, userID := range []uuid.UUID{ownerID, memberID} {
		if _, err := database.ExecContext(ctx, `INSERT INTO users (id,email,display_name,password_hash) VALUES ($1,$2,'Delete Test','hash')`, userID, userID.String()+"@example.test"); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := database.ExecContext(ctx, `INSERT INTO organizations (id,name,slug,created_by) VALUES ($1,'Delete Test',$2,$3)`, organizationID, "delete-test-"+organizationID.String(), ownerID); err != nil {
		t.Fatal(err)
	}
	defer func() {
		_, _ = database.ExecContext(context.Background(), "DELETE FROM organizations WHERE id=$1", organizationID)
		_, _ = database.ExecContext(context.Background(), "DELETE FROM users WHERE id IN ($1,$2)", ownerID, memberID)
	}()
	if _, err := database.ExecContext(ctx, `INSERT INTO organization_members (organization_id,user_id,role) VALUES ($1,$2,'owner'),($1,$3,'member')`, organizationID, ownerID, memberID); err != nil {
		t.Fatal(err)
	}
	if _, err := database.ExecContext(ctx, `INSERT INTO projects (id,organization_id,name,slug) VALUES ($1,$2,'Delete Test','delete-test')`, projectID, organizationID); err != nil {
		t.Fatal(err)
	}
	repository := metadata.NewProjectRepository(database)
	if err := repository.RequestDeletion(ctx, memberID, projectID); !errors.Is(err, metadata.ErrForbidden) {
		t.Fatalf("member deletion error=%v", err)
	}
	if err := repository.RequestDeletion(ctx, ownerID, projectID); err != nil {
		t.Fatal(err)
	}
	if _, err := repository.GetForUser(ctx, ownerID, projectID); !errors.Is(err, metadata.ErrNotFound) {
		t.Fatalf("deleting project access error=%v", err)
	}
}
