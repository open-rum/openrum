package handlers

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"openrum/internal/auth"
	"openrum/internal/httpx"
	"openrum/internal/mailer"
	"openrum/internal/mailservice"
	"openrum/internal/metadata"
)

// emailTestInterval keeps the test button from being used to flood an inbox.
const emailTestInterval = 5 * time.Second

type adminEmailService interface {
	Effective(context.Context) (mailservice.Effective, error)
	Send(context.Context, mailer.Message) error
	Probe(context.Context, mailer.Settings) error
}

type managedEmailStore interface {
	PutSMTP(context.Context, uuid.UUID, mailer.Settings) (metadata.InstanceSecret, error)
	DeleteSMTP(context.Context) (bool, error)
}

// AdminEmailHandler manages the instance mail server: it shows where the configuration comes
// from, saves a Console-managed server when the deployment has none, and sends a test message.
type AdminEmailHandler struct {
	members adminOverviewRoles
	reauth  recentElevationChecker
	service adminEmailService
	store   managedEmailStore
	logger  zerolog.Logger

	mutex    sync.Mutex
	lastTest map[uuid.UUID]time.Time
	now      func() time.Time
}

// NewAdminEmailHandler starts read-only: until EnableManagedSecrets is called the Console can
// show and test the mail server but the deployment is the only way to configure it.
func NewAdminEmailHandler(
	members adminOverviewRoles,
	reauth recentElevationChecker,
	service adminEmailService,
	logger zerolog.Logger,
) *AdminEmailHandler {
	return &AdminEmailHandler{
		members: members, reauth: reauth, service: service, logger: logger,
		lastTest: map[uuid.UUID]time.Time{}, now: time.Now,
	}
}

// EnableManagedSecrets lets administrators save a Console-managed mail server.
func (handler *AdminEmailHandler) EnableManagedSecrets(store managedEmailStore) {
	handler.store = store
}

type emailSettingsView struct {
	Host        string `json:"host"`
	Port        int    `json:"port"`
	Security    string `json:"security"`
	Username    string `json:"username"`
	From        string `json:"from"`
	PasswordSet bool   `json:"passwordSet"`
}

type adminEmailStatus struct {
	Configured bool   `json:"configured"`
	Source     string `json:"source"`
	// Locked is true when the deployment configures mail: the Console shows it but cannot change it.
	Locked                  bool               `json:"locked"`
	ManagedSecretsAvailable bool               `json:"managedSecretsAvailable"`
	Settings                *emailSettingsView `json:"settings"`
	// ManagedOverridden means a Console-managed server is stored but the deployment's takes precedence.
	ManagedOverridden bool       `json:"managedOverridden"`
	UpdatedAt         *time.Time `json:"updatedAt,omitempty"`
}

type emailSettingsRequest struct {
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Security string `json:"security"`
	Username string `json:"username"`
	Password string `json:"password"`
	From     string `json:"from"`
}

func viewOf(settings mailer.Settings) *emailSettingsView {
	return &emailSettingsView{
		Host: settings.Host, Port: settings.Port, Security: string(settings.Security),
		Username: settings.Username, From: settings.From, PasswordSet: settings.Password != "",
	}
}

func (handler *AdminEmailHandler) Get(writer http.ResponseWriter, request *http.Request) {
	if _, ok := handler.authorize(writer, request, auth.InstanceActionRead); !ok {
		return
	}
	effective, err := handler.service.Effective(request.Context())
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	status := adminEmailStatus{
		Configured: effective.Source != mailservice.SourceNone, Source: string(effective.Source),
		Locked: effective.Source == mailservice.SourceDeployment, ManagedSecretsAvailable: handler.store != nil,
	}
	switch {
	case effective.Source != mailservice.SourceNone:
		status.Settings = viewOf(effective.Settings)
	case effective.Managed != nil:
		status.Settings = viewOf(*effective.Managed)
	}
	if effective.Managed != nil {
		status.ManagedOverridden = effective.Source == mailservice.SourceDeployment
		if effective.Source == mailservice.SourceManaged {
			updated := effective.UpdatedAt
			status.UpdatedAt = &updated
		}
	}
	writeJSON(writer, http.StatusOK, status)
}

func (handler *AdminEmailHandler) PutManaged(writer http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorize(writer, request, auth.InstanceActionDangerousChanges)
	if !ok {
		return
	}
	if !requireAdminElevation(writer, request, principal, handler.reauth, handler.logger) {
		return
	}
	if handler.store == nil {
		httpx.WriteError(writer, request, http.StatusConflict, "MANAGED_SECRETS_DISABLED", "Managed secrets require an explicit deployment opt-in and external master key.")
		return
	}
	effective, err := handler.service.Effective(request.Context())
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	if effective.Source == mailservice.SourceDeployment {
		httpx.WriteError(writer, request, http.StatusConflict, "EMAIL_LOCKED_BY_DEPLOYMENT", "The deployment configures the mail server through SMTP_* settings; change it there.")
		return
	}
	var payload emailSettingsRequest
	if !decodeJSONBody(writer, request, &payload) {
		return
	}
	settings := mailer.Settings{
		Host: payload.Host, Port: payload.Port, Security: mailer.Security(payload.Security),
		Username: payload.Username, Password: payload.Password, From: payload.From,
	}.Normalize()
	// A blank password keeps the stored one, so changing the sender address does not require
	// retyping it. It is only kept for the same user on the same host, so a stored credential
	// can never be sent to a server the administrator just pointed somewhere else.
	if settings.Password == "" && settings.Username != "" && effective.Managed != nil &&
		effective.Managed.Username == settings.Username && strings.EqualFold(effective.Managed.Host, settings.Host) {
		settings.Password = effective.Managed.Password
	}
	if err := settings.Validate(); err != nil {
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", capitalize(err.Error())+".")
		return
	}
	if err := handler.service.Probe(request.Context(), settings); err != nil {
		writeJSON(writer, http.StatusUnprocessableEntity, emailFailure(err, handler.logger))
		return
	}
	secret, err := handler.store.PutSMTP(request.Context(), principal.UserID, settings)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"configured": true, "version": secret.Version})
}

func (handler *AdminEmailHandler) DeleteManaged(writer http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorize(writer, request, auth.InstanceActionDangerousChanges)
	if !ok {
		return
	}
	if !requireAdminElevation(writer, request, principal, handler.reauth, handler.logger) {
		return
	}
	if handler.store == nil {
		httpx.WriteError(writer, request, http.StatusConflict, "MANAGED_SECRETS_DISABLED", "Managed secrets require an explicit deployment opt-in and external master key.")
		return
	}
	if _, err := handler.store.DeleteSMTP(request.Context()); err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

// Test sends one message to the signed-in administrator's own address. The recipient is not
// a parameter: the endpoint must not become a way to send mail to arbitrary people.
func (handler *AdminEmailHandler) Test(writer http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorize(writer, request, auth.InstanceActionManageSettings)
	if !ok {
		return
	}
	effective, err := handler.service.Effective(request.Context())
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	if effective.Source == mailservice.SourceNone {
		httpx.WriteError(writer, request, http.StatusConflict, "EMAIL_NOT_CONFIGURED", "No mail server is configured.")
		return
	}
	if strings.TrimSpace(principal.Email) == "" {
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "Your account has no email address to send the test to.")
		return
	}
	if !handler.allowTest(principal.UserID) {
		httpx.WriteError(writer, request, http.StatusTooManyRequests, "RATE_LIMITED", "Wait a few seconds before sending another test message.")
		return
	}
	err = handler.service.Send(request.Context(), mailer.Message{
		To:      []string{principal.Email},
		Subject: "OpenRUM test email",
		Body: "This is a test message from OpenRUM. If you received it, the mail server settings work.\n\n" +
			"这是一封来自 OpenRUM 的测试邮件。收到它，说明邮件服务配置可用。\n",
	})
	if err != nil {
		result := emailFailure(err, handler.logger)
		result["recipient"] = principal.Email
		writeJSON(writer, http.StatusOK, result)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"success": true, "recipient": principal.Email})
}

func (handler *AdminEmailHandler) allowTest(user uuid.UUID) bool {
	handler.mutex.Lock()
	defer handler.mutex.Unlock()
	now := handler.now()
	if last, ok := handler.lastTest[user]; ok && now.Sub(last) < emailTestInterval {
		return false
	}
	handler.lastTest[user] = now
	return true
}

// emailFailure turns a delivery error into something an administrator can act on. Delivery
// errors carry the stage and the server's own reply, never the settings or the password.
func emailFailure(err error, logger zerolog.Logger) map[string]any {
	var failure *mailer.Error
	if errors.As(err, &failure) {
		return map[string]any{"success": false, "stage": string(failure.Stage), "message": failure.Message}
	}
	logger.Error().Err(err).Msg("mail delivery failed outside a known stage")
	return map[string]any{"success": false, "stage": "send", "message": "The message could not be sent."}
}

func capitalize(value string) string {
	if value == "" {
		return value
	}
	return strings.ToUpper(value[:1]) + value[1:]
}

func (handler *AdminEmailHandler) authorize(
	writer http.ResponseWriter,
	request *http.Request,
	action auth.InstanceAction,
) (auth.Principal, bool) {
	principal, ok := httpx.PrincipalFromContext(request.Context())
	if !ok {
		httpx.WriteError(writer, request, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication is required.")
		return auth.Principal{}, false
	}
	role, err := handler.members.RoleForUser(request.Context(), principal.UserID)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return auth.Principal{}, false
	}
	if err := auth.AuthorizeInstance(role, action); err != nil {
		writeControlPlaneError(writer, request, handler.logger, errors.Join(metadata.ErrForbidden, err))
		return auth.Principal{}, false
	}
	return principal, true
}
