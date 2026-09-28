//go:build integration

package auth

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"

	openrumcrypto "openrum/internal/crypto"
)

func TestExternalIdentityLifecycle(t *testing.T) {
	dsn := os.Getenv("TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("TEST_POSTGRES_DSN is not set")
	}
	assertSafeTestDatabase(t, dsn)
	database, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = database.Close() }()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	ownerID, localID := uuid.New(), uuid.New()
	providerID := "oidc-" + uuid.NewString()[:12]
	for id, email := range map[uuid.UUID]string{ownerID: "owner-" + ownerID.String() + "@example.test", localID: "local-" + localID.String() + "@example.test"} {
		if _, err := database.ExecContext(ctx, "INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,'Local user','hash')", id, email); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() {
		cleanCtx := context.Background()
		_, _ = database.ExecContext(cleanCtx, "DELETE FROM users WHERE id=ANY($1)", []uuid.UUID{ownerID, localID})
		_, _ = database.ExecContext(cleanCtx, "DELETE FROM auth_providers WHERE id=$1", providerID)
		_, _ = database.ExecContext(cleanCtx, "DELETE FROM instance_secrets WHERE name=$1", "auth-provider:"+providerID)
	})
	key := openrumcrypto.Key{ID: "test", Material: bytes.Repeat([]byte{0x42}, 32)}
	keyring, err := openrumcrypto.NewKeyring(key.ID, key)
	if err != nil {
		t.Fatal(err)
	}
	store := NewExternalStore(database, keyring)
	provider := Provider{ID: providerID, Kind: "oidc", Label: "Company SSO", Enabled: true,
		Settings: ProviderSettings{ClientID: "company-app", IssuerURL: "https://sso.example.test/"}}
	if err := ValidateProvider(&provider); err != nil {
		t.Fatal(err)
	}
	secret := "private-client-secret"
	if err := store.SaveProvider(ctx, ownerID, provider, secret); err != nil {
		t.Fatal(err)
	}
	configured, err := store.GetProvider(ctx, providerID)
	if err != nil || configured.Secret != secret || configured.Version != 1 {
		t.Fatalf("configured provider=%+v err=%v", configured, err)
	}
	public, err := store.ListProviders(ctx, true)
	if err != nil || len(public) != 1 {
		t.Fatalf("public providers=%+v err=%v", public, err)
	}
	encoded, err := json.Marshal(public)
	if err != nil || bytes.Contains(encoded, []byte(secret)) {
		t.Fatalf("public provider leaks secret: %s, %v", encoded, err)
	}
	var encrypted []byte
	if err := database.QueryRowContext(ctx, "SELECT encrypted_value FROM instance_secrets WHERE name=$1", "auth-provider:"+providerID).Scan(&encrypted); err != nil || bytes.Contains(encrypted, []byte(secret)) {
		t.Fatalf("stored provider leaks secret: %v", err)
	}

	var localEmail string
	if err := database.QueryRowContext(ctx, "SELECT email FROM users WHERE id=$1", localID).Scan(&localEmail); err != nil {
		t.Fatal(err)
	}
	if _, err := store.ResolveIdentity(ctx, configured, "external-subject", localEmail, "External user"); !errors.Is(err, ErrIdentityConflict) {
		t.Fatalf("same-email first sign-in should not merge: %v", err)
	}
	if err := store.LinkIdentity(ctx, localID, configured, "external-subject"); err != nil {
		t.Fatal(err)
	}
	linked, err := store.ResolveIdentity(ctx, configured, "external-subject", "other@example.test", "External user")
	if err != nil || linked.ID != localID || linked.AccessStatus != "approved" {
		t.Fatalf("explicitly linked identity=%+v err=%v", linked, err)
	}
	if err := store.LinkIdentity(ctx, ownerID, configured, "external-subject"); !errors.Is(err, ErrIdentityLinked) {
		t.Fatalf("duplicate subject link should fail: %v", err)
	}

	newEmail := "pending-" + uuid.NewString() + "@example.test"
	pending, err := store.ResolveIdentity(ctx, configured, "new-subject", newEmail, "Pending user")
	if err != nil || pending.AccessStatus != "pending" {
		t.Fatalf("first external sign-in=%+v err=%v", pending, err)
	}
	t.Cleanup(func() { _, _ = database.ExecContext(context.Background(), "DELETE FROM users WHERE id=$1", pending.ID) })
	again, err := store.ResolveIdentity(ctx, configured, "new-subject", "changed@example.test", "Changed")
	if err != nil || again.ID != pending.ID || again.Email != newEmail {
		t.Fatalf("stable subject did not retain account: %+v, %v", again, err)
	}
	pendingIdentities, err := store.ListIdentities(ctx, pending.ID)
	if err != nil || len(pendingIdentities) != 1 {
		t.Fatalf("pending identities=%+v err=%v", pendingIdentities, err)
	}
	if err := store.UnlinkIdentity(ctx, pending.ID, pendingIdentities[0].ID); !errors.Is(err, ErrIdentityLastMethod) {
		t.Fatalf("only active sign-in method was removed: %v", err)
	}

	changed := provider
	changed.Settings.ClientID = "another-app"
	if err := ValidateProvider(&changed); err != nil {
		t.Fatal(err)
	}
	if err := store.SaveProvider(ctx, ownerID, changed, "new-secret"); !errors.Is(err, ErrProviderChanged) {
		t.Fatalf("provider directory changed: %v", err)
	}
	if err := store.DisableProvider(ctx, providerID); err != nil {
		t.Fatal(err)
	}
	public, err = store.ListProviders(ctx, true)
	if err != nil || len(public) != 0 {
		t.Fatalf("disabled provider still advertised: %+v, %v", public, err)
	}
	if _, err := store.GetProvider(ctx, providerID); !errors.Is(err, ErrProviderUnavailable) {
		t.Fatalf("disabled provider still signs in: %v", err)
	}
	if testProvider, err := store.GetProviderForTest(ctx, providerID); err != nil || testProvider.Enabled || testProvider.Secret != secret {
		t.Fatalf("disabled provider cannot be tested: %+v, %v", testProvider, err)
	}
	if _, err := store.ResolveIdentity(ctx, configured, "new-subject", newEmail, "Pending user"); !errors.Is(err, ErrProviderUnavailable) {
		t.Fatalf("stale provider completed sign-in after disable: %v", err)
	}
	identities, err := store.ListIdentities(ctx, localID)
	if err != nil || len(identities) != 1 || !strings.EqualFold(identities[0].ProviderID, providerID) {
		t.Fatalf("disabled provider lost historical link: %+v, %v", identities, err)
	}
	if err := store.UnlinkIdentity(ctx, localID, identities[0].ID); err != nil {
		t.Fatal(err)
	}
}
