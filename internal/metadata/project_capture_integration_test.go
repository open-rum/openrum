//go:build integration

package metadata

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	"openrum/internal/capture"
)

func TestProjectCaptureRulesRoundTripAndGuardWrites(t *testing.T) {
	database := openIntegrationDatabase(t)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	owner, viewer, organization := uuid.New(), uuid.New(), uuid.New()
	for _, user := range []uuid.UUID{owner, viewer} {
		if _, err := database.ExecContext(ctx,
			"INSERT INTO users (id,email,display_name,password_hash) VALUES ($1,$2,'Capture','hash')", user, user.String()+"@example.test"); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := database.ExecContext(ctx, "INSERT INTO organizations (id,name,slug,created_by) VALUES ($1,'Capture',$2,$3)",
		organization, "capture-"+organization.String()[:8], owner); err != nil {
		t.Fatal(err)
	}
	if _, err := database.ExecContext(ctx, "INSERT INTO organization_members (organization_id,user_id,role) VALUES ($1,$2,'owner'),($1,$3,'viewer')",
		organization, owner, viewer); err != nil {
		t.Fatal(err)
	}
	project, _, err := NewProjectRepository(database).CreateWithKey(ctx, owner, CreateProjectInput{
		OrganizationID: organization, Name: "Capture", Slug: "capture-" + organization.String()[:8],
		AllowedOrigins: []string{"https://example.com"}, Environment: "production", Environments: []string{"production"},
		RetentionDays: 14, EventSampleRate: 1, APISampleRate: 1, ErrorSampleRate: 1,
	}, "Integration")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		background := context.WithoutCancel(ctx)
		_, _ = database.ExecContext(background, "DELETE FROM audit_logs WHERE organization_id=$1", organization)
		_, _ = database.ExecContext(background, "DELETE FROM project_keys WHERE project_id=$1", project.ID)
		_, _ = database.ExecContext(background, "DELETE FROM projects WHERE id=$1", project.ID)
		_, _ = database.ExecContext(background, "DELETE FROM organization_members WHERE organization_id=$1", organization)
		_, _ = database.ExecContext(background, "DELETE FROM organizations WHERE id=$1", organization)
		_, _ = database.ExecContext(background, "DELETE FROM users WHERE id IN ($1,$2)", owner, viewer)
	})

	repository := NewProjectCaptureRepository(database)
	configs := NewProjectConfigRepository(database)

	initial, err := repository.Get(ctx, project.ID)
	if err != nil || len(initial.Rules) != 0 {
		t.Fatalf("a new project must capture nothing: %+v err=%v", initial, err)
	}
	before, err := configs.Get(ctx, project.ID, time.Now())
	if err != nil || len(before.APICapture.Rules) != 0 {
		t.Fatalf("initial SDK config=%+v err=%v", before, err)
	}

	stored, err := repository.Update(ctx, owner, project.ID, capture.Settings{Rules: []capture.Rule{{
		ID: " orders ", Method: "get", Pattern: "https://api.example.com/orders/:id",
		RequestHeaders: []string{"X-Request-Id"}, ResponseHeaders: []string{"ETag"}, ResponseBody: true, Note: "debug",
	}}})
	if err != nil {
		t.Fatal(err)
	}
	rule := stored.Rules[0]
	if rule.ID != "orders" || rule.Method != "GET" || rule.RequestHeaders[0] != "x-request-id" || rule.ResponseHeaders[0] != "etag" {
		t.Fatalf("the stored document must be canonical: %+v", rule)
	}
	again, err := repository.Get(ctx, project.ID)
	if err != nil || len(again.Rules) != 1 || again.Rules[0].Note != "debug" || !again.Rules[0].ResponseBody || again.Rules[0].RequestBody {
		t.Fatalf("round trip = %+v err=%v", again, err)
	}

	after, err := configs.Get(ctx, project.ID, time.Now())
	if err != nil || after.Version != before.Version+1 {
		t.Fatalf("saving rules must bump the SDK config version: before=%d after=%+v err=%v", before.Version, after, err)
	}
	projected := after.APICapture.Rules[0]
	if projected.Pattern != "https://api.example.com/orders/*" || projected.Note != "" || !projected.ResponseBody {
		t.Fatalf("the browser must receive the widened pattern and no note: %+v", projected)
	}

	if _, err := repository.Update(ctx, owner, project.ID, capture.Settings{Rules: []capture.Rule{{
		ID: "bad", Method: "GET", Pattern: "https://api.example.com/*", RequestHeaders: []string{"authorization"},
	}}}); !errors.Is(err, capture.ErrInvalidSettings) {
		t.Fatalf("a credential header must be refused, got %v", err)
	}
	if _, err := repository.Update(ctx, viewer, project.ID, capture.Settings{Rules: []capture.Rule{{
		ID: "r", Method: "GET", Pattern: "https://api.example.com/*", ResponseHeaders: []string{"etag"},
	}}}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("a viewer must not change capture rules, got %v", err)
	}
	if kept, _ := repository.Get(ctx, project.ID); len(kept.Rules) != 1 {
		t.Fatalf("refused writes must leave the rules unchanged: %+v", kept)
	}

	var audits int
	if err := database.QueryRowContext(ctx, `SELECT count(*) FROM audit_logs WHERE resource_id=$1 AND action='project.api_capture_rules.updated'`,
		project.ID).Scan(&audits); err != nil || audits != 1 {
		t.Fatalf("audit entries=%d err=%v", audits, err)
	}

	if _, err := repository.Update(ctx, owner, project.ID, capture.Settings{}); err != nil {
		t.Fatal(err)
	}
	if cleared, _ := repository.Get(ctx, project.ID); len(cleared.Rules) != 0 {
		t.Fatalf("an empty document must switch capture off: %+v", cleared)
	}
}
