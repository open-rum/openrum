//go:build integration

package metadata

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestReleaseCreateIsIdempotentAndListsWithCounts(t *testing.T) {
	database := integrationDatabase(t)
	ctx := context.Background()
	ownerID, projectID := seedIssueProject(t, database)
	repository := NewIssueRepository(database)
	first, created, err := repository.CreateReleaseForActor(ctx, ownerID, Release{ProjectID: projectID, Version: "web@1.0.0", Dist: "browser"})
	if err != nil || !created || first.ArtifactCount != 0 {
		t.Fatalf("first=%+v created=%v err=%v", first, created, err)
	}
	again, created, err := repository.CreateReleaseForActor(ctx, ownerID, Release{ProjectID: projectID, Version: "web@1.0.0", Dist: "browser"})
	if err != nil || created || again.ID != first.ID {
		t.Fatalf("again=%+v created=%v err=%v", again, created, err)
	}
	var audits int
	if err := database.QueryRowContext(ctx, "SELECT count(*) FROM audit_logs WHERE resource_id=$1 AND action='release.created'", first.ID).Scan(&audits); err != nil || audits != 1 {
		t.Fatalf("audits=%d err=%v", audits, err)
	}
	for index, status := range []SourceMapArtifactStatus{ArtifactStatusReady, ArtifactStatusPending} {
		if _, err := repository.CreateArtifact(ctx, SourceMapArtifact{ReleaseID: first.ID, ArtifactName: []string{"a.js.map", "b.js.map"}[index],
			OSSKey: uuid.NewString(), SHA256: make([]byte, 32), SizeBytes: 10, Status: status}); err != nil {
			t.Fatal(err)
		}
	}
	for _, version := range []string{"web@1.1.0", "web_2.0.0", "api@1.0.0"} {
		if _, _, err := repository.CreateReleaseForActor(ctx, ownerID, Release{ProjectID: projectID, Version: version}); err != nil {
			t.Fatal(err)
		}
		time.Sleep(2 * time.Millisecond)
	}
	page, err := repository.ListReleases(ctx, projectID, ReleaseListOptions{Limit: 2})
	if err != nil || len(page.Releases) != 2 || page.NextCursor == nil || page.Releases[0].Version != "api@1.0.0" {
		t.Fatalf("page=%+v err=%v", page, err)
	}
	rest, err := repository.ListReleases(ctx, projectID, ReleaseListOptions{Limit: 2, Cursor: *page.NextCursor})
	if err != nil || len(rest.Releases) != 2 || rest.NextCursor != nil || rest.Releases[1].ID != first.ID ||
		rest.Releases[1].ArtifactCount != 2 || rest.Releases[1].ReadyCount != 1 {
		t.Fatalf("rest=%+v err=%v", rest, err)
	}
	// Underscore is a LIKE wildcard; the search must treat it literally.
	search, err := repository.ListReleases(ctx, projectID, ReleaseListOptions{Query: "WEB_"})
	if err != nil || len(search.Releases) != 1 || search.Releases[0].Version != "web_2.0.0" {
		t.Fatalf("search=%+v err=%v", search, err)
	}
	if _, err := repository.ListReleases(ctx, projectID, ReleaseListOptions{Cursor: "not-a-cursor"}); err != ErrInvalidReleaseCursor {
		t.Fatalf("cursor err=%v", err)
	}
}

func TestReleaseDeleteClearsIssueResolutionAndArtifacts(t *testing.T) {
	database := integrationDatabase(t)
	ctx := context.Background()
	ownerID, projectID := seedIssueProject(t, database)
	repository := NewIssueRepository(database)
	release, _, err := repository.CreateReleaseForActor(ctx, ownerID, Release{ProjectID: projectID, Version: "web@3"})
	if err != nil {
		t.Fatal(err)
	}
	artifact, err := repository.CreateArtifact(ctx, SourceMapArtifact{ReleaseID: release.ID, ArtifactName: "app.js.map", OSSKey: uuid.NewString(), SHA256: make([]byte, 32), SizeBytes: 1})
	if err != nil {
		t.Fatal(err)
	}
	found, err := repository.GetArtifactByName(ctx, projectID, release.ID, "app.js.map")
	if err != nil || found.ID != artifact.ID {
		t.Fatalf("found=%+v err=%v", found, err)
	}
	if _, err := repository.PutIssueState(ctx, IssueState{ProjectID: projectID, Fingerprint: "v1:delete", FingerprintVersion: 1,
		Status: IssueStatusResolved, ResolvedInRelease: &release.ID}); err != nil {
		t.Fatal(err)
	}
	if err := repository.DeleteRelease(ctx, ownerID, uuid.New(), release.ID); err != ErrNotFound {
		t.Fatalf("cross-project delete err=%v", err)
	}
	if err := repository.DeleteRelease(ctx, ownerID, projectID, release.ID); err != nil {
		t.Fatal(err)
	}
	state, err := repository.GetIssueState(ctx, projectID, "v1:delete")
	if err != nil || state.ResolvedInRelease != nil || state.Status != IssueStatusResolved {
		t.Fatalf("state=%+v err=%v", state, err)
	}
	if _, err := repository.GetArtifactByName(ctx, projectID, release.ID, "app.js.map"); err != ErrNotFound {
		t.Fatalf("artifact after release delete err=%v", err)
	}
	var audits int
	if err := database.QueryRowContext(ctx, "SELECT count(*) FROM audit_logs WHERE resource_id=$1 AND action='release.deleted'", release.ID).Scan(&audits); err != nil || audits != 1 {
		t.Fatalf("audits=%d err=%v", audits, err)
	}
}

func TestRemapQueueDedupesAndSurvivesConcurrentUpload(t *testing.T) {
	database := integrationDatabase(t)
	ctx := context.Background()
	_, projectID := seedIssueProject(t, database)
	queue := NewRemapRepository(database)
	for range 3 {
		if err := queue.Queue(ctx, projectID, "web@1", "browser"); err != nil {
			t.Fatal(err)
		}
	}
	var pending int
	if err := database.QueryRowContext(ctx, "SELECT count(*) FROM sourcemap_remap_requests WHERE project_id=$1 AND processed_at IS NULL", projectID).Scan(&pending); err != nil || pending != 1 {
		t.Fatalf("pending=%d err=%v", pending, err)
	}
	if _, found, err := queue.Claim(ctx); err != nil || found {
		// Requests settle before they are claimed so a build's uploads batch up.
		t.Fatalf("unsettled request claimed found=%v err=%v", found, err)
	}
	settle := func() {
		if _, err := database.ExecContext(ctx, "UPDATE sourcemap_remap_requests SET requested_at=requested_at-interval '1 minute' WHERE project_id=$1 AND processed_at IS NULL", projectID); err != nil {
			t.Fatal(err)
		}
	}
	settle()
	request, found, err := claimProject(ctx, queue, projectID)
	if err != nil || !found || request.Version != "web@1" || request.Dist != "browser" || request.Attempts != 1 {
		t.Fatalf("request=%+v found=%v err=%v", request, found, err)
	}
	// A new upload during the run bumps the same row; completing the old run
	// must leave it pending for another pass.
	if err := queue.Queue(ctx, projectID, "web@1", "browser"); err != nil {
		t.Fatal(err)
	}
	if err := queue.Complete(ctx, request); err != nil {
		t.Fatal(err)
	}
	settle()
	again, found, err := claimProject(ctx, queue, projectID)
	if err != nil || !found || again.ID != request.ID {
		t.Fatalf("again=%+v found=%v err=%v", again, found, err)
	}
	if err := queue.Complete(ctx, again); err != nil {
		t.Fatal(err)
	}
	if err := database.QueryRowContext(ctx, "SELECT count(*) FROM sourcemap_remap_requests WHERE project_id=$1 AND processed_at IS NULL", projectID).Scan(&pending); err != nil || pending != 0 {
		t.Fatalf("pending after completion=%d err=%v", pending, err)
	}
}

// claimProject claims until it finds this test's project, releasing others, so
// requests left by parallel packages sharing the database do not interfere.
func claimProject(ctx context.Context, queue *RemapRepository, projectID uuid.UUID) (RemapRequest, bool, error) {
	for range 50 {
		request, found, err := queue.Claim(ctx)
		if err != nil || !found {
			return request, found, err
		}
		if request.ProjectID == projectID {
			return request, true, nil
		}
	}
	return RemapRequest{}, false, nil
}

func TestUploadTokensAuthenticateUntilRevoked(t *testing.T) {
	database := integrationDatabase(t)
	ctx := context.Background()
	ownerID, projectID := seedIssueProject(t, database)
	repository := NewUploadTokenRepository(database)
	credential, err := repository.Create(ctx, ownerID, projectID, "CI")
	if err != nil || len(credential.Secret) != len(UploadTokenPrefix)+43 || credential.Token.TokenPrefix != credential.Secret[:12] ||
		credential.Token.CreatedByName == nil || *credential.Token.CreatedByName != "Issue Owner" {
		t.Fatalf("credential=%+v err=%v", credential, err)
	}
	var stored []byte
	if err := database.QueryRowContext(ctx, "SELECT token_hash FROM project_upload_tokens WHERE id=$1", credential.Token.ID).Scan(&stored); err != nil || string(stored) == credential.Secret {
		t.Fatalf("stored hash err=%v", err)
	}
	access, err := repository.Authenticate(ctx, credential.Secret)
	if err != nil || access.ProjectID != projectID || access.CreatedBy == nil || *access.CreatedBy != ownerID {
		t.Fatalf("access=%+v err=%v", access, err)
	}
	var firstUse time.Time
	if err := database.QueryRowContext(ctx, "SELECT last_used_at FROM project_upload_tokens WHERE id=$1", credential.Token.ID).Scan(&firstUse); err != nil {
		t.Fatal(err)
	}
	if _, err := repository.Authenticate(ctx, credential.Secret); err != nil {
		t.Fatal(err)
	}
	var secondUse time.Time
	if err := database.QueryRowContext(ctx, "SELECT last_used_at FROM project_upload_tokens WHERE id=$1", credential.Token.ID).Scan(&secondUse); err != nil || !secondUse.Equal(firstUse) {
		t.Fatalf("last_used_at rewritten within a minute: %s -> %s err=%v", firstUse, secondUse, err)
	}
	listed, err := repository.List(ctx, projectID)
	if err != nil || len(listed) != 1 || listed[0].LastUsedAt == nil {
		t.Fatalf("listed=%+v err=%v", listed, err)
	}
	if err := repository.Revoke(ctx, ownerID, projectID, credential.Token.ID); err != nil {
		t.Fatal(err)
	}
	if err := repository.Revoke(ctx, ownerID, projectID, credential.Token.ID); err != nil {
		t.Fatalf("second revoke err=%v", err)
	}
	if _, err := repository.Authenticate(ctx, credential.Secret); err != ErrInvalidUploadToken {
		t.Fatalf("revoked token err=%v", err)
	}
	if _, err := repository.Authenticate(ctx, "orut_unknown"); err != ErrInvalidUploadToken {
		t.Fatalf("unknown token err=%v", err)
	}
	var audits int
	if err := database.QueryRowContext(ctx, "SELECT count(*) FROM audit_logs WHERE resource_id=$1 AND action IN ('upload_token.created','upload_token.revoked')", credential.Token.ID).Scan(&audits); err != nil || audits != 2 {
		t.Fatalf("audits=%d err=%v", audits, err)
	}
	// Deleting the creator keeps the token usable, attributed to nobody.
	other, err := repository.Create(ctx, ownerID, projectID, "Other")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := database.ExecContext(ctx, "UPDATE project_upload_tokens SET created_by=NULL WHERE id=$1", other.Token.ID); err != nil {
		t.Fatal(err)
	}
	if access, err := repository.Authenticate(ctx, other.Secret); err != nil || access.CreatedBy != nil {
		t.Fatalf("orphan access=%+v err=%v", access, err)
	}
	release, created, err := NewIssueRepository(database).CreateReleaseForActor(ctx, uuid.Nil, Release{ProjectID: projectID, Version: "orphan@1"})
	if err != nil || !created || release.ID == uuid.Nil {
		t.Fatalf("release by orphan token err=%v", err)
	}
}
