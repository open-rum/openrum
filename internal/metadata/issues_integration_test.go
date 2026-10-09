//go:build integration

package metadata

import (
	"context"
	"database/sql"
	"os"
	"testing"

	"github.com/google/uuid"
)

func TestIssueReleaseArtifactConstraintsAndCascades(t *testing.T) {
	database := integrationDatabase(t)
	ctx := context.Background()
	ownerID, projectID := seedIssueProject(t, database)
	repository := NewIssueRepository(database)
	release, created, err := repository.CreateReleaseForActor(ctx, ownerID, Release{ProjectID: projectID, Version: "checkout@1.0.0", Dist: "web"})
	if err != nil || !created {
		t.Fatalf("created=%v err=%v", created, err)
	}
	if _, err := repository.CreateRelease(ctx, Release{ProjectID: projectID, Version: release.Version, Dist: release.Dist}); err == nil {
		t.Fatal("expected duplicate release to fail")
	}
	artifact, err := repository.CreateArtifact(ctx, SourceMapArtifact{
		ReleaseID: release.ID, ArtifactName: "~/assets/index.js.map", OSSKey: "projects/test/index.js.map",
		SHA256: make([]byte, 32), SizeBytes: 1024,
	})
	if err != nil || artifact.Status != ArtifactStatusPending {
		t.Fatalf("artifact=%+v err=%v", artifact, err)
	}
	listed, err := repository.ListArtifacts(ctx, projectID, release.ID)
	if err != nil || len(listed) != 1 || listed[0].ID != artifact.ID {
		t.Fatalf("listed=%+v err=%v", listed, err)
	}
	ready, err := repository.SetArtifactStatus(ctx, projectID, release.ID, artifact.ID, ArtifactStatusReady, nil)
	if err != nil || ready.Status != ArtifactStatusReady {
		t.Fatalf("ready=%+v err=%v", ready, err)
	}
	if err := repository.DeleteArtifact(ctx, ownerID, projectID, release.ID, artifact.ID); err != nil {
		t.Fatal(err)
	}
	artifact, err = repository.CreateArtifact(ctx, SourceMapArtifact{
		ReleaseID: release.ID, ArtifactName: "~/assets/other.js.map", OSSKey: "projects/test/other.js.map",
		SHA256: make([]byte, 32), SizeBytes: 2048,
	})
	if err != nil {
		t.Fatal(err)
	}
	var audits int
	if err := database.QueryRowContext(ctx,
		"SELECT count(*) FROM audit_logs WHERE actor_user_id=$1 AND action IN ('release.created','sourcemap.deleted')", ownerID).Scan(&audits); err != nil || audits != 2 {
		t.Fatalf("audits=%d err=%v", audits, err)
	}
	state, err := repository.PutIssueState(ctx, IssueState{
		ProjectID: projectID, Fingerprint: "v1:fixture", FingerprintVersion: 1,
		Status: IssueStatusResolved, AssigneeUserID: &ownerID, ResolvedInRelease: &release.ID,
	})
	if err != nil || state.Status != IssueStatusResolved {
		t.Fatalf("state=%+v err=%v", state, err)
	}
	if _, err := database.ExecContext(ctx, "DELETE FROM projects WHERE id=$1", projectID); err != nil {
		t.Fatal(err)
	}
	var releases, artifacts, states int
	if err := database.QueryRowContext(ctx, "SELECT count(*) FROM releases WHERE project_id=$1", projectID).Scan(&releases); err != nil {
		t.Fatal(err)
	}
	if err := database.QueryRowContext(ctx, "SELECT count(*) FROM sourcemap_artifacts WHERE release_id=$1", release.ID).Scan(&artifacts); err != nil {
		t.Fatal(err)
	}
	if err := database.QueryRowContext(ctx, "SELECT count(*) FROM issue_states WHERE project_id=$1", projectID).Scan(&states); err != nil {
		t.Fatal(err)
	}
	if releases+artifacts+states != 0 {
		t.Fatalf("cascade rows releases=%d artifacts=%d states=%d", releases, artifacts, states)
	}
}

func integrationDatabase(t *testing.T) *sql.DB {
	t.Helper()
	dsn := os.Getenv("TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("TEST_POSTGRES_DSN is not set")
	}
	database, err := OpenPostgres(context.Background(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	return database
}

func seedIssueProject(t *testing.T, database *sql.DB) (uuid.UUID, uuid.UUID) {
	t.Helper()
	ownerID, organizationID, projectID := uuid.New(), uuid.New(), uuid.New()
	ctx := context.Background()
	if _, err := database.ExecContext(ctx, `INSERT INTO users (id,email,display_name,password_hash) VALUES ($1,$2,'Issue Owner','hash')`, ownerID, ownerID.String()+"@example.test"); err != nil {
		t.Fatal(err)
	}
	if _, err := database.ExecContext(ctx, `INSERT INTO organizations (id,name,slug,created_by) VALUES ($1,'Issue Org',$2,$3)`, organizationID, "issue-"+organizationID.String(), ownerID); err != nil {
		t.Fatal(err)
	}
	if _, err := database.ExecContext(ctx, `INSERT INTO organization_members (organization_id,user_id,role) VALUES ($1,$2,'owner')`, organizationID, ownerID); err != nil {
		t.Fatal(err)
	}
	if _, err := database.ExecContext(ctx, `INSERT INTO projects (id,organization_id,name,slug) VALUES ($1,$2,'Issue Project',$3)`, projectID, organizationID, "issue-"+projectID.String()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = database.ExecContext(ctx, "DELETE FROM organizations WHERE id=$1", organizationID)
		_, _ = database.ExecContext(ctx, "DELETE FROM users WHERE id=$1", ownerID)
	})
	return ownerID, projectID
}

func TestBatchMutateIssueStatesKeepsUntouchedFieldsAndRestartsRegressionClock(t *testing.T) {
	database := integrationDatabase(t)
	ctx := context.Background()
	ownerID, projectID := seedIssueProject(t, database)
	repository := NewIssueRepository(database)
	refs := []IssueRef{{Fingerprint: "v1:a", FingerprintVersion: 1}, {Fingerprint: "v1:b", FingerprintVersion: 1}}

	assign := IssueStatePatch{SetAssignee: true, AssigneeUserID: &ownerID}
	if updated, err := repository.BatchMutateIssueStates(ctx, ownerID, projectID, refs, assign); err != nil || updated != 2 {
		t.Fatalf("assign updated=%d err=%v", updated, err)
	}
	resolved := IssueStatusResolved
	if _, err := repository.BatchMutateIssueStates(ctx, ownerID, projectID, refs[:1], IssueStatePatch{Status: &resolved}); err != nil {
		t.Fatal(err)
	}
	first, err := repository.GetIssueState(ctx, projectID, "v1:a")
	if err != nil || first.Status != IssueStatusResolved || first.ResolvedAt == nil || first.AssigneeUserID == nil || *first.AssigneeUserID != ownerID {
		t.Fatalf("resolving keeps the assignee and stamps the time: %+v err=%v", first, err)
	}
	second, err := repository.GetIssueState(ctx, projectID, "v1:b")
	if err != nil || second.Status != IssueStatusUnresolved || second.ResolvedAt != nil {
		t.Fatalf("an Issue outside the batch keeps its state: %+v err=%v", second, err)
	}
	// Clearing the assignee is different from leaving it.
	if _, err := repository.BatchMutateIssueStates(ctx, ownerID, projectID, refs, IssueStatePatch{SetAssignee: true}); err != nil {
		t.Fatal(err)
	}
	cleared, err := repository.GetIssueState(ctx, projectID, "v1:a")
	if err != nil || cleared.AssigneeUserID != nil || cleared.Status != IssueStatusResolved {
		t.Fatalf("cleared assignee, status kept: %+v err=%v", cleared, err)
	}
	reopened := IssueStatusUnresolved
	if _, err := repository.BatchMutateIssueStates(ctx, ownerID, projectID, refs, IssueStatePatch{Status: &reopened}); err != nil {
		t.Fatal(err)
	}
	reopenedState, err := repository.GetIssueState(ctx, projectID, "v1:a")
	if err != nil || reopenedState.Status != IssueStatusUnresolved || reopenedState.ResolvedAt != nil {
		t.Fatalf("reopening forgets the resolution time: %+v err=%v", reopenedState, err)
	}
	stranger := uuid.New()
	if _, err := repository.BatchMutateIssueStates(ctx, ownerID, projectID, refs, IssueStatePatch{SetAssignee: true, AssigneeUserID: &stranger}); err != ErrNotFound {
		t.Fatalf("assigning outside the organization must fail, got %v", err)
	}
	var audits int
	if err := database.QueryRowContext(ctx,
		"SELECT count(*) FROM audit_logs WHERE actor_user_id=$1 AND action='issue.states_updated'", ownerID).Scan(&audits); err != nil || audits != 4 {
		t.Fatalf("one audit entry per applied batch: audits=%d err=%v", audits, err)
	}
}
