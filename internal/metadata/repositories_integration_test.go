//go:build integration

package metadata

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestRepositoryIsolationAndLastOwnerInvariant(t *testing.T) {
	database := openIntegrationDatabase(t)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if _, err := database.ExecContext(ctx, "TRUNCATE audit_logs, sessions, project_keys, projects, organization_members, organizations, users CASCADE"); err != nil {
		t.Fatal(err)
	}
	defer func() {
		_, _ = database.ExecContext(context.WithoutCancel(ctx), "TRUNCATE audit_logs, sessions, project_keys, projects, organization_members, organizations, users CASCADE")
	}()

	ownerA, ownerB, secondOwner := uuid.New(), uuid.New(), uuid.New()
	organizationA, organizationB := uuid.New(), uuid.New()
	projectB := uuid.New()
	for _, user := range []struct {
		id    uuid.UUID
		email string
	}{{ownerA, "a@example.com"}, {ownerB, "b@example.com"}, {secondOwner, "c@example.com"}} {
		if _, err := database.ExecContext(ctx,
			"INSERT INTO users (id,email,display_name,password_hash) VALUES ($1,$2,$3,'hash')", user.id, user.email, user.email); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := database.ExecContext(ctx,
		"INSERT INTO organizations (id,name,slug,created_by) VALUES ($1,'A','a',$2),($3,'B','b',$4)",
		organizationA, ownerA, organizationB, ownerB); err != nil {
		t.Fatal(err)
	}
	if _, err := database.ExecContext(ctx,
		"INSERT INTO organization_members (organization_id,user_id,role) VALUES ($1,$2,'owner'),($3,$4,'owner')",
		organizationA, ownerA, organizationB, ownerB); err != nil {
		t.Fatal(err)
	}
	if _, err := database.ExecContext(ctx,
		"INSERT INTO projects (id,organization_id,name,slug) VALUES ($1,$2,'Private B','private-b')", projectB, organizationB); err != nil {
		t.Fatal(err)
	}

	projects := NewProjectRepository(database)
	if _, err := projects.GetForUser(ctx, ownerA, projectB); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-organization project error=%v", err)
	}
	projectA, err := projects.Create(ctx, ownerA, CreateProjectInput{
		OrganizationID: organizationA, Name: "Web", Slug: "web", AllowedOrigins: []string{"https://example.com"},
		Environment: "production", RetentionDays: 14, EventSampleRate: 1, APISampleRate: 0.2,
	})
	if err != nil {
		t.Fatal(err)
	}
	access, err := projects.GetForUser(ctx, ownerA, projectA.ID)
	if err != nil || access.Role != RoleOwner || len(access.Project.AllowedOrigins) != 1 {
		t.Fatalf("project access=%+v err=%v", access, err)
	}

	organizations := NewOrganizationRepository(database)
	if err := organizations.UpdateMemberRole(ctx, ownerA, organizationA, ownerA, RoleAdmin); !errors.Is(err, ErrLastOwner) {
		t.Fatalf("sole owner demotion error=%v", err)
	}
	if err := organizations.RemoveMember(ctx, ownerA, organizationA, ownerA); !errors.Is(err, ErrLastOwner) {
		t.Fatalf("sole owner removal error=%v", err)
	}
	if err := organizations.AddMember(ctx, ownerA, organizationA, secondOwner, RoleOwner); err != nil {
		t.Fatal(err)
	}

	start := make(chan struct{})
	errorsFound := make(chan error, 2)
	var waitGroup sync.WaitGroup
	for _, userID := range []uuid.UUID{ownerA, secondOwner} {
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()
			<-start
			errorsFound <- organizations.UpdateMemberRole(ctx, ownerA, organizationA, userID, RoleAdmin)
		}()
	}
	close(start)
	waitGroup.Wait()
	close(errorsFound)
	successes, lastOwnerFailures := 0, 0
	for updateErr := range errorsFound {
		switch {
		case updateErr == nil:
			successes++
		case errors.Is(updateErr, ErrLastOwner):
			lastOwnerFailures++
		default:
			t.Fatalf("unexpected concurrent update error=%v", updateErr)
		}
	}
	if successes != 1 || lastOwnerFailures != 1 {
		t.Fatalf("concurrent demotions: success=%d last-owner=%d", successes, lastOwnerFailures)
	}
}
