//go:build integration

package sourcemap

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"

	"openrum/internal/metadata"
)

func TestArtifactCatalogListsOnlyReadyArtifactsOfOneBuild(t *testing.T) {
	dsn := os.Getenv("TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("TEST_POSTGRES_DSN is not set")
	}
	ctx := context.Background()
	database, err := metadata.OpenPostgres(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = database.Close() }()
	userID, organizationID, projectID, releaseID, otherReleaseID := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	for _, statement := range []struct {
		query string
		args  []any
	}{
		{`INSERT INTO users (id,email,display_name,password_hash) VALUES ($1,$2,'Catalog','hash')`, []any{userID, userID.String() + "@example.test"}},
		{`INSERT INTO organizations (id,name,slug,created_by) VALUES ($1,'Catalog',$2,$3)`, []any{organizationID, "catalog-" + organizationID.String(), userID}},
		{`INSERT INTO projects (id,organization_id,name,slug) VALUES ($1,$2,'Catalog',$3)`, []any{projectID, organizationID, "catalog-" + projectID.String()}},
		{`INSERT INTO releases (id,project_id,version,dist) VALUES ($1,$2,'web@1','browser')`, []any{releaseID, projectID}},
		{`INSERT INTO releases (id,project_id,version,dist) VALUES ($1,$2,'web@1','')`, []any{otherReleaseID, projectID}},
		{`INSERT INTO sourcemap_artifacts (release_id,artifact_name,oss_key,sha256,size_bytes,status) VALUES ($1,'a.js.map',$2,$3,1,'ready')`, []any{releaseID, uuid.NewString(), make([]byte, 32)}},
		{`INSERT INTO sourcemap_artifacts (release_id,artifact_name,oss_key,sha256,size_bytes,status) VALUES ($1,'b.js.map',$2,$3,1,'pending')`, []any{releaseID, uuid.NewString(), make([]byte, 32)}},
		{`INSERT INTO sourcemap_artifacts (release_id,artifact_name,oss_key,sha256,size_bytes,status) VALUES ($1,'a.js.map',$2,$3,1,'ready')`, []any{otherReleaseID, uuid.NewString(), make([]byte, 32)}},
	} {
		if _, err := database.ExecContext(ctx, statement.query, statement.args...); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() {
		_, _ = database.ExecContext(ctx, "DELETE FROM organizations WHERE id=$1", organizationID)
		_, _ = database.ExecContext(ctx, "DELETE FROM users WHERE id=$1", userID)
	})
	artifacts, err := NewArtifactCatalog(database).ReadyArtifacts(ctx, projectID, "web@1", "browser")
	if err != nil || len(artifacts) != 1 || artifacts[0].ArtifactName != "a.js.map" || artifacts[0].Dist != "browser" {
		t.Fatalf("artifacts=%+v err=%v", artifacts, err)
	}
}
