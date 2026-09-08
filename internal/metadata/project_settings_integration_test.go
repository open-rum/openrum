//go:build integration

package metadata

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"openrum/internal/processing"
)

const settingsTruncate = "TRUNCATE audit_logs, sessions, project_keys, projects, organization_members, organizations, users CASCADE"

// seedProject creates the minimum control-plane rows the settings repositories
// need: a user who owns an organization, and a project inside it.
func seedProject(t *testing.T, ctx context.Context) (uuid.UUID, uuid.UUID) {
	t.Helper()
	database := openIntegrationDatabase(t)
	if _, err := database.ExecContext(ctx, settingsTruncate); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = database.ExecContext(context.WithoutCancel(ctx), settingsTruncate)
	})
	owner, organization, project := uuid.New(), uuid.New(), uuid.New()
	statements := []struct {
		query     string
		arguments []any
	}{
		{"INSERT INTO users (id,email,display_name,password_hash) VALUES ($1,'owner@example.com','Owner','hash')",
			[]any{owner}},
		{"INSERT INTO organizations (id,name,slug,created_by) VALUES ($1,'A','a',$2)",
			[]any{organization, owner}},
		{"INSERT INTO organization_members (organization_id,user_id,role) VALUES ($1,$2,'owner')",
			[]any{organization, owner}},
		{"INSERT INTO projects (id,organization_id,name,slug) VALUES ($1,$2,'Web','web')",
			[]any{project, organization}},
	}
	for _, statement := range statements {
		if _, err := database.ExecContext(ctx, statement.query, statement.arguments...); err != nil {
			t.Fatal(err)
		}
	}
	return owner, project
}

func TestProcessingRulesRoundTrip(t *testing.T) {
	database := openIntegrationDatabase(t)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	owner, project := seedProject(t, ctx)
	repository := NewProjectProcessingRepository(database)

	// A project that has never been configured reads as unconfigured rather
	// than as an error, which is what the column default has to guarantee.
	settings, err := repository.Get(ctx, project)
	if err != nil {
		t.Fatal(err)
	}
	if len(settings.URL.Rules) != 0 || len(settings.Scrub.Patterns) != 0 {
		t.Fatalf("a fresh project came back configured: %+v", settings)
	}

	if _, err := repository.UpdateURLRules(ctx, owner, project, processing.URLRules{Rules: []processing.Rule{
		{ID: "orders", Target: processing.TargetBoth, Pattern: "/orders/:orderId", Note: "short slugs"},
	}}); err != nil {
		t.Fatal(err)
	}
	if _, err := repository.UpdateScrubRules(ctx, owner, project, processing.ScrubRules{
		Patterns:      []processing.ScrubPattern{{ID: "order", Expression: `ORD-[0-9]{6}`}},
		SensitiveKeys: []string{"ssn"},
	}); err != nil {
		t.Fatal(err)
	}

	// Both documents are read in one statement, so the round trip is what
	// proves they are stored in separate columns rather than overwriting one
	// another.
	settings, err = repository.Get(ctx, project)
	if err != nil {
		t.Fatal(err)
	}
	if len(settings.URL.Rules) != 1 || settings.URL.Rules[0].Pattern != "/orders/:orderId" {
		t.Fatalf("URL rules came back as %+v", settings.URL)
	}
	if len(settings.Scrub.Patterns) != 1 || len(settings.Scrub.SensitiveKeys) != 1 {
		t.Fatalf("scrub rules came back as %+v", settings.Scrub)
	}
	if _, err := processing.Compile(settings); err != nil {
		t.Fatalf("stored settings do not compile: %v", err)
	}
}

func TestProcessingRulesRefuseInvalidDocuments(t *testing.T) {
	database := openIntegrationDatabase(t)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	owner, project := seedProject(t, ctx)
	repository := NewProjectProcessingRepository(database)

	if _, err := repository.UpdateURLRules(ctx, owner, project, processing.URLRules{Rules: []processing.Rule{
		{ID: "bad", Target: processing.TargetPage, Pattern: "orders/:id"},
	}}); err == nil {
		t.Fatal("a pattern without a leading slash was stored")
	}
	if _, err := repository.UpdateScrubRules(ctx, owner, project, processing.ScrubRules{
		Patterns: []processing.ScrubPattern{{ID: "bad", Expression: "([unclosed"}},
	}); err == nil {
		t.Fatal("an expression that does not compile was stored")
	}
}

func TestProjectQuotaOverrideCanBeSetAndCleared(t *testing.T) {
	database := openIntegrationDatabase(t)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	owner, project := seedProject(t, ctx)
	repository := NewProjectRepository(database)

	access, err := repository.GetForUser(ctx, owner, project)
	if err != nil {
		t.Fatal(err)
	}
	if access.Project.IngestRateLimit != nil || access.Project.OverLimitBehavior != OverLimitReject {
		t.Fatalf("a fresh project has quota %+v, want no override and reject",
			access.Project.IngestRateLimit)
	}

	limit := int32(250)
	behavior := OverLimitSample
	updated, err := repository.Update(ctx, owner, project, UpdateProjectInput{
		IngestRateLimit: pointerTo(&limit), OverLimitBehavior: &behavior,
	})
	if err != nil {
		t.Fatal(err)
	}
	if updated.IngestRateLimit == nil || *updated.IngestRateLimit != limit ||
		updated.OverLimitBehavior != OverLimitSample {
		t.Fatalf("quota was stored as %+v", updated)
	}

	// An update that does not mention the quota must leave it alone, which is
	// what separates "not sent" from "cleared".
	name := "Renamed"
	updated, err = repository.Update(ctx, owner, project, UpdateProjectInput{Name: &name})
	if err != nil {
		t.Fatal(err)
	}
	if updated.IngestRateLimit == nil || *updated.IngestRateLimit != limit {
		t.Fatalf("an unrelated update cleared the quota: %+v", updated.IngestRateLimit)
	}

	var cleared *int32
	updated, err = repository.Update(ctx, owner, project, UpdateProjectInput{IngestRateLimit: &cleared})
	if err != nil {
		t.Fatal(err)
	}
	if updated.IngestRateLimit != nil {
		t.Fatalf("the override was not cleared: %+v", updated.IngestRateLimit)
	}
	if updated.OverLimitBehavior != OverLimitSample {
		t.Fatal("clearing the limit also reset the behaviour")
	}
}

func pointerTo[T any](value T) *T { return &value }
