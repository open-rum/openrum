//go:build integration

package metadata

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	secure "openrum/internal/crypto"
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
	projectA, credential, err := projects.CreateWithKey(ctx, ownerA, CreateProjectInput{
		OrganizationID: organizationA, Name: "Web", Slug: "web", AllowedOrigins: []string{"https://example.com"},
		Environment: "production", Environments: []string{"production", "staging"}, RetentionDays: 14,
		EventSampleRate: 1, APISampleRate: 0.2, ErrorSampleRate: 1,
	}, "Integration")
	if err != nil {
		t.Fatal(err)
	}
	access, err := projects.GetForUser(ctx, ownerA, projectA.ID)
	if err != nil || access.Role != RoleOwner || len(access.Project.AllowedOrigins) != 1 ||
		!access.Project.AcceptsEnvironment("staging") {
		t.Fatalf("project access=%+v err=%v", access, err)
	}
	defaultEnvironment := "staging"
	environments := []string{"production", "staging", "development"}
	updatedProject, err := projects.Update(ctx, ownerA, projectA.ID, UpdateProjectInput{
		Environment:  &defaultEnvironment,
		Environments: &environments,
	})
	if err != nil || updatedProject.Environment != defaultEnvironment ||
		len(updatedProject.Environments) != len(environments) || !updatedProject.AcceptsEnvironment("development") {
		t.Fatalf("updated project environments=%+v err=%v", updatedProject, err)
	}
	keyAccess, err := NewProjectKeyRepository(database).Validate(ctx, credential.Raw)
	if err != nil || !keyAccess.Project.AcceptsEnvironment("production") ||
		!keyAccess.Project.AcceptsEnvironment("development") {
		t.Fatalf("project key environments=%+v err=%v", keyAccess.Project.Environments, err)
	}
	configs := NewProjectConfigRepository(database)
	initialConfig, err := configs.Get(ctx, projectA.ID, time.Now())
	if err != nil || initialConfig.Version != 1 {
		t.Fatalf("initial SDK config=%+v err=%v", initialConfig, err)
	}
	updatedRate := 0.4
	if _, err := projects.Update(ctx, ownerA, projectA.ID, UpdateProjectInput{EventSampleRate: &updatedRate}); err != nil {
		t.Fatal(err)
	}
	updatedConfig, err := configs.Get(ctx, projectA.ID, time.Now())
	if err != nil || updatedConfig.Version != 2 || updatedConfig.EventSampleRate != updatedRate {
		t.Fatalf("updated SDK config=%+v err=%v", updatedConfig, err)
	}
	// The error sample rate used to be a SQL literal, so the SDK could never be
	// told to collect fewer errors. Assert it round-trips and bumps the version
	// SDKs poll against.
	errorRate := 0.25
	if _, err := projects.Update(ctx, ownerA, projectA.ID, UpdateProjectInput{ErrorSampleRate: &errorRate}); err != nil {
		t.Fatal(err)
	}
	errorConfig, err := configs.Get(ctx, projectA.ID, time.Now())
	if err != nil || errorConfig.Version != 3 || errorConfig.ErrorSampleRate != errorRate {
		t.Fatalf("error sample rate SDK config=%+v err=%v", errorConfig, err)
	}
	emergencyRate, emergencyExpiry := 0.05, time.Now().UTC().Add(time.Hour)
	emergencyConfig, err := configs.SetEmergency(ctx, ownerA, projectA.ID, &emergencyRate, &emergencyExpiry)
	if err != nil || emergencyConfig.Version != 4 || emergencyConfig.EmergencySampleRate == nil {
		t.Fatalf("emergency SDK config=%+v err=%v", emergencyConfig, err)
	}
	var auditCount int
	if err := database.QueryRowContext(ctx, `SELECT count(*) FROM audit_logs WHERE resource_id=$1
		AND action IN ('project.updated','project.sdk_config.emergency_updated')`, projectA.ID).Scan(&auditCount); err != nil || auditCount != 4 {
		t.Fatalf("SDK config audit count=%d err=%v", auditCount, err)
	}
	oldEncryptionKey := secure.Key{ID: "integration-old", Material: bytes.Repeat([]byte{7}, 32)}
	oldKeyring, err := secure.NewKeyring(oldEncryptionKey.ID, oldEncryptionKey)
	if err != nil {
		t.Fatal(err)
	}
	alerts := NewAlertRepository(database, oldKeyring)
	channel, err := alerts.CreateChannel(ctx, ownerA, organizationA, "Incident webhook", ChannelWebhook, json.RawMessage(`{"url":"https://hooks.example.test/incident"}`))
	if err != nil || channel.EncryptionKeyID != oldEncryptionKey.ID || bytes.Contains(channel.EncryptedConfig, []byte("hooks.example")) {
		t.Fatalf("channel=%+v err=%v", channel, err)
	}
	newEncryptionKey := secure.Key{ID: "integration-new", Material: bytes.Repeat([]byte{8}, 32)}
	newKeyring, err := secure.NewKeyring(newEncryptionKey.ID, oldEncryptionKey, newEncryptionKey)
	if err != nil {
		t.Fatal(err)
	}
	alerts = NewAlertRepository(database, newKeyring)
	if changed, err := alerts.RotateChannelConfig(ctx, channel.ID); err != nil || !changed {
		t.Fatalf("rotate channel changed=%v err=%v", changed, err)
	}
	opened, err := alerts.OpenChannelConfig(ctx, ownerA, channel.ID)
	if err != nil || string(opened) != `{"url":"https://hooks.example.test/incident"}` {
		t.Fatalf("opened channel=%s err=%v", opened, err)
	}
	var storedKeyID string
	if err := database.QueryRowContext(ctx, "SELECT encryption_key_id FROM notification_channels WHERE id=$1", channel.ID).Scan(&storedKeyID); err != nil || storedKeyID != newEncryptionKey.ID {
		t.Fatalf("stored channel key=%q err=%v", storedKeyID, err)
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
	// Whichever demotion lands first wins. If the first owner demotes themselves, they are an
	// Admin when the second request runs, and an Admin may not change an Owner (forbidden);
	// if the second owner is demoted first, the first owner is the last Owner. Both losses are
	// correct, so the invariant is one winner, one refusal and an Owner left standing.
	successes, refusals := 0, 0
	for updateErr := range errorsFound {
		switch {
		case updateErr == nil:
			successes++
		case errors.Is(updateErr, ErrLastOwner), errors.Is(updateErr, ErrForbidden):
			refusals++
		default:
			t.Fatalf("unexpected concurrent update error=%v", updateErr)
		}
	}
	if successes != 1 || refusals != 1 {
		t.Fatalf("concurrent demotions: success=%d refusals=%d", successes, refusals)
	}
	var owners int
	if err := database.QueryRowContext(ctx,
		"SELECT count(*) FROM organization_members WHERE organization_id=$1 AND role='owner'", organizationA).Scan(&owners); err != nil || owners != 1 {
		t.Fatalf("owners left after concurrent demotions=%d err=%v", owners, err)
	}
}
