package handlers

import (
	"context"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"openrum/internal/auth"
	"openrum/internal/httpx"
	"openrum/internal/mailer"
	"openrum/internal/mailservice"
	"openrum/internal/metadata"
)

type fakeEmailService struct {
	effective mailservice.Effective
	probed    []mailer.Settings
	probeErr  error
	sent      []mailer.Message
	sendErr   error
}

func (service *fakeEmailService) Effective(context.Context) (mailservice.Effective, error) {
	effective := service.effective
	if effective.Source == "" {
		effective.Source = mailservice.SourceNone
	}
	return effective, nil
}

func (service *fakeEmailService) Send(_ context.Context, message mailer.Message) error {
	service.sent = append(service.sent, message)
	return service.sendErr
}

func (service *fakeEmailService) Probe(_ context.Context, settings mailer.Settings) error {
	service.probed = append(service.probed, settings)
	return service.probeErr
}

type fakeEmailStore struct {
	saved   []mailer.Settings
	deleted int
}

func (store *fakeEmailStore) PutSMTP(_ context.Context, _ uuid.UUID, settings mailer.Settings) (metadata.InstanceSecret, error) {
	store.saved = append(store.saved, settings)
	return metadata.InstanceSecret{Version: int64(len(store.saved))}, nil
}

func (store *fakeEmailStore) DeleteSMTP(context.Context) (bool, error) {
	store.deleted++
	return true, nil
}

var emailAdmin = uuid.New()

func emailRouter(handler *AdminEmailHandler, role metadata.InstanceRole) http.Handler {
	router := httpx.NewRouter(zerolog.Nop())
	_ = role
	requireSession := httpx.RequireSession(adminAuthenticator{principals: map[string]auth.Principal{
		"session": {UserID: emailAdmin, Email: "admin@example.org"},
	}})
	baseURL, _ := url.Parse("http://openrum.test")
	requireCSRF := httpx.RequireCSRF(baseURL)
	router.Handle("GET /api/v1/admin/email", requireSession(http.HandlerFunc(handler.Get)))
	router.Handle("PUT /api/v1/admin/email/managed", requireSession(requireCSRF(http.HandlerFunc(handler.PutManaged))))
	router.Handle("DELETE /api/v1/admin/email/managed", requireSession(requireCSRF(http.HandlerFunc(handler.DeleteManaged))))
	router.Handle("POST /api/v1/admin/email/test", requireSession(requireCSRF(http.HandlerFunc(handler.Test))))
	return router
}

func newEmailHandler(role metadata.InstanceRole, service *fakeEmailService, store managedEmailStore) *AdminEmailHandler {
	members := &fakeInstanceMembers{roles: map[uuid.UUID]metadata.InstanceRole{emailAdmin: role}}
	handler := NewAdminEmailHandler(members, retentionReauthFixture{}, service, zerolog.Nop())
	if store != nil {
		handler.EnableManagedSecrets(store)
	}
	return handler
}

const emailPayload = `{"host":"smtp.example.com","port":587,"security":"starttls","username":"mailer","password":"s3cret","from":"no-reply@example.com"}`

func TestEmailStatusNeverReturnsThePassword(t *testing.T) {
	service := &fakeEmailService{effective: mailservice.Effective{
		Source:   mailservice.SourceManaged,
		Settings: mailer.Settings{Host: "smtp.example.com", Port: 587, Security: mailer.SecurityStartTLS, Username: "mailer", Password: "s3cret", From: "no-reply@example.com"},
	}}
	router := emailRouter(newEmailHandler(metadata.InstanceRoleAdmin, service, &fakeEmailStore{}), metadata.InstanceRoleAdmin)
	response := performAdminRequest(router, "session", http.MethodGet, "/api/v1/admin/email", "", false)
	body := response.Body.String()
	if response.Code != http.StatusOK || strings.Contains(body, "s3cret") || !strings.Contains(body, `"passwordSet":true`) ||
		!strings.Contains(body, `"source":"managed"`) || !strings.Contains(body, `"locked":false`) {
		t.Fatalf("status=%d body=%s", response.Code, body)
	}
}

func TestEmailStatusReportsDeploymentLockAndHiddenManagedServer(t *testing.T) {
	managed := mailer.Settings{Host: "old.example.com", Port: 465, Security: mailer.SecurityTLS, From: "old@example.com"}
	service := &fakeEmailService{effective: mailservice.Effective{
		Source:   mailservice.SourceDeployment,
		Settings: mailer.Settings{Host: "deploy.example.com", Port: 587, Security: mailer.SecurityStartTLS, From: "d@example.com"},
		Managed:  &managed,
	}}
	router := emailRouter(newEmailHandler(metadata.InstanceRoleAdmin, service, &fakeEmailStore{}), metadata.InstanceRoleAdmin)
	body := performAdminRequest(router, "session", http.MethodGet, "/api/v1/admin/email", "", false).Body.String()
	if !strings.Contains(body, `"locked":true`) || !strings.Contains(body, `"managedOverridden":true`) || !strings.Contains(body, "deploy.example.com") {
		t.Fatalf("body=%s", body)
	}
}

func TestEmailStatusWhenNothingIsConfigured(t *testing.T) {
	router := emailRouter(newEmailHandler(metadata.InstanceRoleAdmin, &fakeEmailService{}, nil), metadata.InstanceRoleAdmin)
	body := performAdminRequest(router, "session", http.MethodGet, "/api/v1/admin/email", "", false).Body.String()
	if !strings.Contains(body, `"configured":false`) || !strings.Contains(body, `"source":"none"`) || !strings.Contains(body, `"managedSecretsAvailable":false`) {
		t.Fatalf("body=%s", body)
	}
}

func TestEmailRequiresAnInstanceRole(t *testing.T) {
	router := emailRouter(newEmailHandler("", &fakeEmailService{}, &fakeEmailStore{}), "")
	if code := performAdminRequest(router, "session", http.MethodGet, "/api/v1/admin/email", "", false).Code; code != http.StatusForbidden {
		t.Fatalf("status=%d, want 403", code)
	}
}

func TestSavingProbesFirstThenStoresNormalizedSettings(t *testing.T) {
	service, store := &fakeEmailService{}, &fakeEmailStore{}
	router := emailRouter(newEmailHandler(metadata.InstanceRoleOwner, service, store), metadata.InstanceRoleOwner)
	response := performAdminRequest(router, "session", http.MethodPut, "/api/v1/admin/email/managed",
		`{"host":" smtp.example.com ","security":"STARTTLS","username":"mailer","password":"s3cret","from":"no-reply@example.com"}`, true)
	if response.Code != http.StatusOK || len(service.probed) != 1 || len(store.saved) != 1 {
		t.Fatalf("status=%d probed=%d saved=%d body=%s", response.Code, len(service.probed), len(store.saved), response.Body.String())
	}
	if saved := store.saved[0]; saved.Host != "smtp.example.com" || saved.Port != 587 || saved.Security != mailer.SecurityStartTLS {
		t.Fatalf("saved = %+v, want trimmed host, default port and lowercased security", saved)
	}
	if strings.Contains(response.Body.String(), "s3cret") {
		t.Fatalf("response leaks the password: %s", response.Body.String())
	}
}

func TestFailedProbeDoesNotSaveAndExplainsTheStage(t *testing.T) {
	service := &fakeEmailService{probeErr: &mailer.Error{Stage: mailer.StageAuth, Message: "535 5.7.8 authentication failed"}}
	store := &fakeEmailStore{}
	router := emailRouter(newEmailHandler(metadata.InstanceRoleOwner, service, store), metadata.InstanceRoleOwner)
	response := performAdminRequest(router, "session", http.MethodPut, "/api/v1/admin/email/managed", emailPayload, true)
	body := response.Body.String()
	if response.Code != http.StatusUnprocessableEntity || len(store.saved) != 0 ||
		!strings.Contains(body, `"stage":"auth"`) || !strings.Contains(body, "535") || strings.Contains(body, "s3cret") {
		t.Fatalf("status=%d saved=%d body=%s", response.Code, len(store.saved), body)
	}
}

func TestInvalidSettingsAreRejectedBeforeProbing(t *testing.T) {
	service, store := &fakeEmailService{}, &fakeEmailStore{}
	router := emailRouter(newEmailHandler(metadata.InstanceRoleOwner, service, store), metadata.InstanceRoleOwner)
	response := performAdminRequest(router, "session", http.MethodPut, "/api/v1/admin/email/managed",
		`{"host":"smtp://smtp.example.com","from":"no-reply@example.com"}`, true)
	if response.Code != http.StatusBadRequest || len(service.probed) != 0 || !strings.Contains(response.Body.String(), "VALIDATION_ERROR") {
		t.Fatalf("status=%d probed=%d body=%s", response.Code, len(service.probed), response.Body.String())
	}
}

func TestBlankPasswordKeepsTheStoredOneOnlyForTheSameUserAndHost(t *testing.T) {
	managed := mailer.Settings{Host: "smtp.example.com", Port: 587, Security: mailer.SecurityStartTLS, Username: "mailer", Password: "stored", From: "no-reply@example.com"}
	service := &fakeEmailService{effective: mailservice.Effective{Source: mailservice.SourceManaged, Settings: managed, Managed: &managed}}
	store := &fakeEmailStore{}
	router := emailRouter(newEmailHandler(metadata.InstanceRoleOwner, service, store), metadata.InstanceRoleOwner)

	response := performAdminRequest(router, "session", http.MethodPut, "/api/v1/admin/email/managed",
		`{"host":"smtp.example.com","username":"mailer","from":"alerts@example.com"}`, true)
	if response.Code != http.StatusOK || store.saved[0].Password != "stored" || store.saved[0].From != "alerts@example.com" {
		t.Fatalf("status=%d saved=%+v body=%s", response.Code, store.saved, response.Body.String())
	}

	// Pointing the same user at another host must not carry the stored password along.
	response = performAdminRequest(router, "session", http.MethodPut, "/api/v1/admin/email/managed",
		`{"host":"other.example.com","username":"mailer","from":"alerts@example.com"}`, true)
	if response.Code != http.StatusBadRequest || len(store.saved) != 1 {
		t.Fatalf("status=%d saved=%d body=%s", response.Code, len(store.saved), response.Body.String())
	}
}

func TestDeploymentConfigurationCannotBeOverriddenFromTheConsole(t *testing.T) {
	service := &fakeEmailService{effective: mailservice.Effective{
		Source:   mailservice.SourceDeployment,
		Settings: mailer.Settings{Host: "deploy.example.com", Port: 587, Security: mailer.SecurityStartTLS, From: "d@example.com"},
	}}
	store := &fakeEmailStore{}
	router := emailRouter(newEmailHandler(metadata.InstanceRoleOwner, service, store), metadata.InstanceRoleOwner)
	response := performAdminRequest(router, "session", http.MethodPut, "/api/v1/admin/email/managed", emailPayload, true)
	if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), "EMAIL_LOCKED_BY_DEPLOYMENT") || len(store.saved) != 0 || len(service.probed) != 0 {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestConsoleManagementNeedsManagedSecrets(t *testing.T) {
	router := emailRouter(newEmailHandler(metadata.InstanceRoleOwner, &fakeEmailService{}, nil), metadata.InstanceRoleOwner)
	for _, method := range []string{http.MethodPut, http.MethodDelete} {
		response := performAdminRequest(router, "session", method, "/api/v1/admin/email/managed", emailPayload, true)
		if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), "MANAGED_SECRETS_DISABLED") {
			t.Fatalf("%s status=%d body=%s", method, response.Code, response.Body.String())
		}
	}
}

func TestAdminsCannotSaveOrRemoveWithoutOwnerLevelAccess(t *testing.T) {
	store := &fakeEmailStore{}
	router := emailRouter(newEmailHandler(metadata.InstanceRoleAdmin, &fakeEmailService{}, store), metadata.InstanceRoleAdmin)
	for _, method := range []string{http.MethodPut, http.MethodDelete} {
		if code := performAdminRequest(router, "session", method, "/api/v1/admin/email/managed", emailPayload, true).Code; code != http.StatusForbidden {
			t.Fatalf("%s status=%d, want 403", method, code)
		}
	}
	if len(store.saved) != 0 || store.deleted != 0 {
		t.Fatal("a forbidden request changed the stored configuration")
	}
}

func TestRemovingTheManagedServer(t *testing.T) {
	store := &fakeEmailStore{}
	router := emailRouter(newEmailHandler(metadata.InstanceRoleOwner, &fakeEmailService{}, store), metadata.InstanceRoleOwner)
	if code := performAdminRequest(router, "session", http.MethodDelete, "/api/v1/admin/email/managed", "", true).Code; code != http.StatusNoContent || store.deleted != 1 {
		t.Fatalf("status=%d deleted=%d", code, store.deleted)
	}
}

func TestTestMessageGoesOnlyToTheSignedInAdministrator(t *testing.T) {
	service := &fakeEmailService{effective: mailservice.Effective{Source: mailservice.SourceManaged}}
	router := emailRouter(newEmailHandler(metadata.InstanceRoleAdmin, service, &fakeEmailStore{}), metadata.InstanceRoleAdmin)
	// A recipient in the body must be ignored.
	response := performAdminRequest(router, "session", http.MethodPost, "/api/v1/admin/email/test", `{"to":"victim@example.net"}`, true)
	if response.Code != http.StatusOK || len(service.sent) != 1 || len(service.sent[0].To) != 1 || service.sent[0].To[0] != "admin@example.org" {
		t.Fatalf("status=%d sent=%+v body=%s", response.Code, service.sent, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"success":true`) || !strings.Contains(response.Body.String(), "admin@example.org") {
		t.Fatalf("body=%s", response.Body.String())
	}
}

func TestTestMessageReportsDeliveryFailureAndIsRateLimited(t *testing.T) {
	service := &fakeEmailService{
		effective: mailservice.Effective{Source: mailservice.SourceManaged},
		sendErr:   &mailer.Error{Stage: mailer.StageRecipient, Message: "550 5.1.1 no such user"},
	}
	handler := newEmailHandler(metadata.InstanceRoleAdmin, service, &fakeEmailStore{})
	clock := time.Date(2026, 10, 11, 12, 0, 0, 0, time.UTC)
	handler.now = func() time.Time { return clock }
	router := emailRouter(handler, metadata.InstanceRoleAdmin)

	response := performAdminRequest(router, "session", http.MethodPost, "/api/v1/admin/email/test", "", true)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"success":false`) || !strings.Contains(response.Body.String(), `"stage":"recipient"`) {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	if code := performAdminRequest(router, "session", http.MethodPost, "/api/v1/admin/email/test", "", true).Code; code != http.StatusTooManyRequests {
		t.Fatalf("second immediate test status=%d, want 429", code)
	}
	clock = clock.Add(emailTestInterval + time.Second)
	if code := performAdminRequest(router, "session", http.MethodPost, "/api/v1/admin/email/test", "", true).Code; code != http.StatusOK {
		t.Fatalf("test after the interval status=%d, want 200", code)
	}
}

func TestTestMessageNeedsAConfiguredServer(t *testing.T) {
	router := emailRouter(newEmailHandler(metadata.InstanceRoleAdmin, &fakeEmailService{}, nil), metadata.InstanceRoleAdmin)
	response := performAdminRequest(router, "session", http.MethodPost, "/api/v1/admin/email/test", "", true)
	if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), "EMAIL_NOT_CONFIGURED") {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}
