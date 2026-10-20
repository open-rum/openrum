package handlers

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"

	"openrum/internal/auth"
	"openrum/internal/httpx"
	"openrum/internal/mailer"
	"openrum/internal/metadata"
)

// Registration is the one unauthenticated way to make an account, so each step is bounded
// per address, and the answers do not say whether an address is already registered.
const (
	registerLimit  = 10
	resendLimit    = 10
	verifyLimit    = 30
	registerWindow = 3600
)

type registrationMailer interface {
	Configured(context.Context) (bool, error)
	Send(context.Context, mailer.Message) error
}

type registrationStore interface {
	Policy(context.Context) (metadata.RegistrationPolicy, error)
	SetOpen(context.Context, uuid.UUID, bool) error
	Register(context.Context, metadata.EmailRegistration) (metadata.RegistrationOutcome, error)
	Resend(context.Context, string, []byte) (metadata.RegistrationOutcome, error)
	Verify(context.Context, string) (uuid.UUID, error)
}

// RegistrationHandler lets anyone create an account by email when an administrator has opened
// registration, confirms the address with a mailed link, and lets administrators open or
// close registration.
type RegistrationHandler struct {
	store         registrationStore
	sessions      *auth.SessionManager
	mail          registrationMailer
	members       adminOverviewRoles
	redis         redis.UniversalClient
	publicBaseURL *url.URL
	secureCookie  bool
	logger        zerolog.Logger
}

func NewRegistrationHandler(
	store registrationStore,
	sessions *auth.SessionManager,
	mail registrationMailer,
	members adminOverviewRoles,
	redisClient redis.UniversalClient,
	publicBaseURL *url.URL,
	secureCookie bool,
	logger zerolog.Logger,
) *RegistrationHandler {
	return &RegistrationHandler{
		store: store, sessions: sessions, mail: mail, members: members, redis: redisClient,
		publicBaseURL: publicBaseURL, secureCookie: secureCookie, logger: logger,
	}
}

type registrationStatus struct {
	// Open is whether anyone may create an account without an invitation.
	Open bool `json:"open"`
	// Email is whether the email form works: registration is open and a mail server can send
	// the verification link. Signing up through an external provider needs no mail.
	Email bool `json:"email"`
}

func (handler *RegistrationHandler) status(ctx context.Context) (registrationStatus, error) {
	policy, err := handler.store.Policy(ctx)
	if err != nil {
		return registrationStatus{}, err
	}
	configured, err := handler.mail.Configured(ctx)
	if err != nil {
		// A broken mail lookup must not close the sign-in page; it only turns the email form off.
		handler.logger.Error().Err(err).Msg("read mail configuration for registration")
		configured = false
	}
	return registrationStatus{Open: policy.Open, Email: policy.Open && configured}, nil
}

// Status tells the login and registration pages which sign-up methods to offer.
func (handler *RegistrationHandler) Status(writer http.ResponseWriter, request *http.Request) {
	status, err := handler.status(request.Context())
	if err != nil {
		handler.internalError(writer, request, err)
		return
	}
	writeJSON(writer, http.StatusOK, status)
}

type registerRequest struct {
	Email       string `json:"email"`
	DisplayName string `json:"displayName"`
	Password    string `json:"password"`
}

// Register creates an unverified account and mails its link. A repeat sign-up for an address
// that is already registered gets the same answer and changes nothing.
func (handler *RegistrationHandler) Register(writer http.ResponseWriter, request *http.Request) {
	var payload registerRequest
	if !decodeJSONBody(writer, request, &payload) {
		return
	}
	status, err := handler.status(request.Context())
	if err != nil {
		handler.internalError(writer, request, err)
		return
	}
	if !status.Open {
		httpx.WriteError(writer, request, http.StatusForbidden, "REGISTRATION_CLOSED", "Registration is not open.")
		return
	}
	if !status.Email {
		httpx.WriteError(writer, request, http.StatusServiceUnavailable, "EMAIL_UNAVAILABLE", "Email sign-up needs a mail server.")
		return
	}
	payload.Email = strings.ToLower(strings.TrimSpace(payload.Email))
	payload.DisplayName = strings.TrimSpace(payload.DisplayName)
	if !validEmail(payload.Email) {
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "Email is invalid.")
		return
	}
	if count := utf8.RuneCountInString(payload.DisplayName); count < 1 || count > 120 {
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "Name must be between 1 and 120 characters.")
		return
	}
	if err := auth.ValidatePassword(payload.Password); err != nil {
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", passwordRuleMessage)
		return
	}
	if !handler.allowed(writer, request, "register", registerLimit) {
		return
	}
	hash, err := auth.HashPassword(payload.Password)
	if err != nil {
		handler.internalError(writer, request, err)
		return
	}
	token, tokenHash, err := metadata.NewEmailVerificationToken()
	if err != nil {
		handler.internalError(writer, request, err)
		return
	}
	outcome, err := handler.store.Register(request.Context(), metadata.EmailRegistration{
		Email: payload.Email, DisplayName: payload.DisplayName, PasswordHash: hash, TokenHash: tokenHash,
	})
	if err != nil {
		handler.internalError(writer, request, err)
		return
	}
	if !handler.deliver(writer, request, outcome, payload.Email, token) {
		return
	}
	writeJSON(writer, http.StatusAccepted, map[string]string{"status": "verification_sent"})
}

type resendRequest struct {
	Email string `json:"email"`
}

// Resend mails a fresh link to an account that is still unverified. It answers the same way
// for every address.
func (handler *RegistrationHandler) Resend(writer http.ResponseWriter, request *http.Request) {
	var payload resendRequest
	if !decodeJSONBody(writer, request, &payload) {
		return
	}
	payload.Email = strings.ToLower(strings.TrimSpace(payload.Email))
	if !validEmail(payload.Email) {
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "Email is invalid.")
		return
	}
	configured, err := handler.mail.Configured(request.Context())
	if err != nil || !configured {
		httpx.WriteError(writer, request, http.StatusServiceUnavailable, "EMAIL_UNAVAILABLE", "Email sign-up needs a mail server.")
		return
	}
	if !handler.allowed(writer, request, "resend", resendLimit) {
		return
	}
	token, tokenHash, err := metadata.NewEmailVerificationToken()
	if err != nil {
		handler.internalError(writer, request, err)
		return
	}
	outcome, err := handler.store.Resend(request.Context(), payload.Email, tokenHash)
	if err != nil {
		handler.internalError(writer, request, err)
		return
	}
	if !handler.deliver(writer, request, outcome, payload.Email, token) {
		return
	}
	writeJSON(writer, http.StatusAccepted, map[string]string{"status": "verification_sent"})
}

type verifyRequest struct {
	Token string `json:"token"`
}

// Verify confirms the address behind a link, approves the account and signs it in. It is a
// POST so a mail scanner that opens the link cannot use it up.
func (handler *RegistrationHandler) Verify(writer http.ResponseWriter, request *http.Request) {
	var payload verifyRequest
	if !decodeJSONBody(writer, request, &payload) {
		return
	}
	if !handler.allowed(writer, request, "verify", verifyLimit) {
		return
	}
	userID, err := handler.store.Verify(request.Context(), payload.Token)
	if err != nil {
		if errors.Is(err, metadata.ErrVerificationInvalid) {
			httpx.WriteError(writer, request, http.StatusGone, "VERIFICATION_INVALID", "This verification link is no longer valid.")
			return
		}
		handler.internalError(writer, request, err)
		return
	}
	previousToken := ""
	if cookie, cookieErr := request.Cookie(auth.SessionCookieName); cookieErr == nil {
		previousToken = cookie.Value
	}
	credentials, err := handler.sessions.Rotate(request.Context(), userID, previousToken, remoteIPAddress(request), request.UserAgent())
	if err != nil {
		handler.internalError(writer, request, err)
		return
	}
	setAuthenticationCookies(writer, credentials, handler.secureCookie)
	writeJSON(writer, http.StatusOK, map[string]string{"userId": userID.String(), "accessStatus": "approved"})
}

// deliver mails the link when the store made one. It returns false after answering the
// request with a failure. Nothing is sent, and nothing is said, for an address that is
// already registered.
func (handler *RegistrationHandler) deliver(writer http.ResponseWriter, request *http.Request, outcome metadata.RegistrationOutcome, to, token string) bool {
	if outcome != metadata.RegistrationSend {
		return true
	}
	link := strings.TrimRight(handler.publicBaseURL.String(), "/") + "/verify-email/" + token
	err := handler.mail.Send(request.Context(), mailer.Message{
		To:      []string{to},
		Subject: "确认你的 OpenRUM 邮箱 / Confirm your OpenRUM email",
		Body: "你（或某个人）用这个邮箱注册了 OpenRUM。打开下面的链接完成注册：\n" + link + "\n\n" +
			"链接 24 小时内有效。如果不是你本人注册，请忽略这封邮件，账号不会被启用。\n\n" +
			"-----\n\n" +
			"You (or someone) signed up for OpenRUM with this address. Open the link below to finish:\n" + link + "\n\n" +
			"The link works for 24 hours. If this was not you, ignore this message and the account stays disabled.\n",
	})
	if err != nil {
		handler.logger.Error().Err(err).Str("request_id", httpx.RequestIDFromContext(request.Context())).Msg("send verification email")
		httpx.WriteError(writer, request, http.StatusBadGateway, "EMAIL_DELIVERY_FAILED", "The verification email could not be sent. Try again later.")
		return false
	}
	return true
}

func (handler *RegistrationHandler) allowed(writer http.ResponseWriter, request *http.Request, action string, limit int64) bool {
	digest := sha256.Sum256([]byte(remoteIPAddress(request)))
	key := "openrum:registration:" + action + ":" + hex.EncodeToString(digest[:])
	count, err := handler.redis.Eval(request.Context(), `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1])) end
return count`, []string{key}, registerWindow).Int64()
	if err != nil {
		handler.logger.Error().Err(err).Msg("registration limiter unavailable")
		httpx.WriteError(writer, request, http.StatusServiceUnavailable, "TEMPORARILY_UNAVAILABLE", "Try again in a moment.")
		return false
	}
	if count > limit {
		writer.Header().Set("Retry-After", "3600")
		httpx.WriteError(writer, request, http.StatusTooManyRequests, "RATE_LIMITED", "Too many attempts from this address. Try again later.")
		return false
	}
	return true
}

// AdminGet shows whether registration is open and whether the email form would work.
func (handler *RegistrationHandler) AdminGet(writer http.ResponseWriter, request *http.Request) {
	if _, ok := handler.authorizeAdmin(writer, request, auth.InstanceActionRead); !ok {
		return
	}
	policy, err := handler.store.Policy(request.Context())
	if err != nil {
		handler.internalError(writer, request, err)
		return
	}
	status, err := handler.status(request.Context())
	if err != nil {
		handler.internalError(writer, request, err)
		return
	}
	configured, _ := handler.mail.Configured(request.Context())
	var updatedAt *string
	if policy.UpdatedAt != nil {
		formatted := policy.UpdatedAt.UTC().Format(timeFormat)
		updatedAt = &formatted
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"open": policy.Open, "emailEnabled": status.Email, "mailConfigured": configured, "updatedAt": updatedAt,
	})
}

type registrationPolicyRequest struct {
	Open bool `json:"open"`
}

// AdminPut opens or closes registration. It asks for the administrator's password again,
// like every change that widens who can reach the instance.
func (handler *RegistrationHandler) AdminPut(writer http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorizeAdmin(writer, request, auth.InstanceActionManageSettings)
	if !ok {
		return
	}
	if !requireAdminElevation(writer, request, principal, handler.sessions, handler.logger) {
		return
	}
	var payload registrationPolicyRequest
	if !decodeJSONBody(writer, request, &payload) {
		return
	}
	if err := handler.store.SetOpen(request.Context(), principal.UserID, payload.Open); err != nil {
		handler.internalError(writer, request, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

func (handler *RegistrationHandler) authorizeAdmin(writer http.ResponseWriter, request *http.Request, action auth.InstanceAction) (auth.Principal, bool) {
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

func (handler *RegistrationHandler) internalError(writer http.ResponseWriter, request *http.Request, err error) {
	handler.logger.Error().Err(err).Str("request_id", httpx.RequestIDFromContext(request.Context())).Msg("registration request failed")
	httpx.WriteError(writer, request, http.StatusInternalServerError, "INTERNAL_ERROR", "An internal error occurred.")
}

// passwordRuleMessage is what every sign-up and password change says when auth.ValidatePassword refuses.
const passwordRuleMessage = "Password must be at least 8 characters and include an upper-case letter, a lower-case letter and a symbol."
