// local-fixture creates an isolated, short-lived load-test identity in the local
// development database. It never changes a real user's Project or credentials.
package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"openrum/internal/auth"
	"openrum/internal/devstack"
	"openrum/internal/metadata"

	"github.com/google/uuid"
)

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

func run() error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	env, err := devstack.LoadEnvironment(".")
	if err != nil {
		return err
	}
	host, err := env.HostEnvironment()
	if err != nil {
		return err
	}
	var dsn string
	for _, value := range host {
		if strings.HasPrefix(value, "POSTGRES_DSN=") {
			dsn = strings.TrimPrefix(value, "POSTGRES_DSN=")
		}
	}
	db, err := metadata.OpenPostgres(ctx, dsn)
	if err != nil {
		return err
	}
	defer func() { _ = db.Close() }()
	if len(os.Args) == 3 && os.Args[1] == "revoke" {
		projectID, err := uuid.Parse(os.Args[2])
		if err != nil {
			return err
		}
		// Scope every update to identities created by this utility.
		var actorID uuid.UUID
		err = db.QueryRowContext(ctx, `SELECT o.created_by FROM projects p JOIN organizations o ON o.id=p.organization_id JOIN users u ON u.id=o.created_by WHERE p.id=$1 AND u.oidc_subject LIKE 'local-benchmark:%'`, projectID).Scan(&actorID)
		if err != nil {
			return err
		}
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		defer func() { _ = tx.Rollback() }()
		for _, query := range []string{`UPDATE sessions SET revoked_at=now() WHERE user_id=$1`, `UPDATE users SET status='disabled' WHERE id=$1`} {
			if _, err = tx.ExecContext(ctx, query, actorID); err != nil {
				return err
			}
		}
		if _, err = tx.ExecContext(ctx, `UPDATE project_keys SET revoked_at=now() WHERE project_id=$1`, projectID); err != nil {
			return err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE projects SET status='disabled' WHERE id=$1`, projectID); err != nil {
			return err
		}
		return tx.Commit()
	}
	if len(os.Args) != 2 {
		return fmt.Errorf("usage: go run ./tests/load/local-fixture <private-output-directory> | revoke <project-id>")
	}
	dir := os.Args[1]
	credentialPath := filepath.Join(dir, "credentials.env")
	if _, statErr := os.Stat(credentialPath); statErr == nil {
		return fmt.Errorf("fixture credentials already exist; use a new directory or revoke that fixture first")
	} else if !os.IsNotExist(statErr) {
		return statErr
	}
	if err = os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	actorID := uuid.New()
	suffix := actorID.String()[:8]
	_, err = db.ExecContext(ctx, `INSERT INTO users (id,email,display_name,auth_source,oidc_subject) VALUES ($1,$2,'Local benchmark','oidc',$3)`, actorID, "benchmark-"+suffix+"@example.invalid", "local-benchmark:"+actorID.String())
	if err != nil {
		return err
	}
	org, err := metadata.NewOrganizationRepository(db).Create(ctx, actorID, "Local benchmark "+suffix, "benchmark-"+suffix)
	if err != nil {
		return err
	}
	project, key, err := metadata.NewProjectRepository(db).CreateWithKey(ctx, actorID, metadata.CreateProjectInput{OrganizationID: org.Organization.ID, Name: "Local capacity test", Slug: "capacity", AllowedOrigins: []string{"https://load.example.com"}, Environment: "production", Environments: []string{"production"}, RetentionDays: 1, EventSampleRate: 1, APISampleRate: 1, ErrorSampleRate: 1}, "Local benchmark")
	if err != nil {
		return err
	}
	session, err := auth.NewSessionManager(db).Create(ctx, actorID, "127.0.0.1", "OpenRUM local benchmark")
	if err != nil {
		return err
	}
	_, err = db.ExecContext(ctx, `UPDATE sessions SET expires_at=now()+interval '2 hours', idle_expires_at=now()+interval '2 hours' WHERE user_id=$1`, actorID)
	if err != nil {
		return err
	}
	content := fmt.Sprintf("OPENRUM_PROJECT_ID=%s\nOPENRUM_WRITE_KEY=%s\nOPENRUM_SESSION=%s\nOPENRUM_API_URL=http://host.docker.internal:8080\nOPENRUM_INGEST_URL=http://ingest:8081/ingest/v1/envelope\n", project.ID, key.Raw, session.Token)
	if err = os.WriteFile(credentialPath, []byte(content), 0600); err != nil {
		return err
	}
	fmt.Printf("Created isolated benchmark project %s; credentials saved privately (not printed).\n", project.ID)
	return nil
}
