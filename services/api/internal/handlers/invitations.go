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

	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"

	"openrum/internal/auth"
	"openrum/internal/httpx"
	"openrum/internal/mailer"
	"openrum/internal/mailservice"
	"openrum/internal/metadata"
)

// invitationRegisterLimit is how many accounts one address may create through invitation
// links in an hour. Registration is the only unauthenticated way to make an account, so it
// is bounded even though a new account reaches nothing until an administrator approves it.
const (
	invitationRegisterLimit  = 20
	invitationRegisterWindow = 3600
)

type invitationMailer interface {
	Configured(context.Context) (bool, error)
	Send(context.Context, mailer.Message) error
}

// InvitationHandler offers organization invitation links, lets people who hold one register
// or ask to join, and lets administrators decide those requests.
type InvitationHandler struct {
	invitations   *metadata.InvitationRepository
	organizations *metadata.OrganizationRepository
	sessions      *auth.SessionManager
	mail          invitationMailer
	redis         redis.UniversalClient
	publicBaseURL *url.URL
	secureCookie  bool
	logger        zerolog.Logger
}

func NewInvitationHandler(
	invitations *metadata.InvitationRepository,
	organizations *metadata.OrganizationRepository,
	sessions *auth.SessionManager,
	mail invitationMailer,
	redisClient redis.UniversalClient,
	publicBaseURL *url.URL,
	secureCookie bool,
	logger zerolog.Logger,
) *InvitationHandler {
	return &InvitationHandler{
		invitations: invitations, organizations: organizations, sessions: sessions, mail: mail,
		redis: redisClient, publicBaseURL: publicBaseURL, secureCookie: secureCookie, logger: logger,
	}
}

type invitationResponse struct {
	ID            string                    `json:"id"`
	Role          metadata.OrganizationRole `json:"role"`
	Email         *string                   `json:"email"`
	CreatedByName *string                   `json:"createdByName"`
	CreatedAt     string                    `json:"createdAt"`
	ExpiresAt     string                    `json:"expiresAt"`
}

type joinRequestResponse struct {
	ID          string                    `json:"id"`
	UserID      string                    `json:"userId"`
	Email       string                    `json:"email"`
	DisplayName string                    `json:"displayName"`
	Avatar      string                    `json:"avatar,omitempty"`
	Role        metadata.OrganizationRole `json:"role"`
	CreatedAt   string                    `json:"createdAt"`
}

func invitationDTO(invitation metadata.Invitation) invitationResponse {
	return invitationResponse{
		ID: invitation.ID.String(), Role: invitation.Role, Email: invitation.Email, CreatedByName: invitation.CreatedByName,
		CreatedAt: invitation.CreatedAt.UTC().Format(timeFormat), ExpiresAt: invitation.ExpiresAt.UTC().Format(timeFormat),
	}
}

// List returns the links that still work and whether this instance can mail them.
func (handler *InvitationHandler) List(writer http.ResponseWriter, request *http.Request) {
	principal, organizationID, ok := principalAndOrganization(writer, request)
	if !ok {
		return
	}
	invitations, err := handler.invitations.List(request.Context(), principal.UserID, organizationID)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	emailEnabled, err := handler.mail.Configured(request.Context())
	if err != nil {
		handler.logger.Error().Err(err).Msg("read mail configuration for invitations")
		emailEnabled = false
	}
	response := make([]invitationResponse, 0, len(invitations))
	for _, invitation := range invitations {
		response = append(response, invitationDTO(invitation))
	}
	writeJSON(writer, http.StatusOK, map[string]any{"invitations": response, "emailEnabled": emailEnabled})
}

type createInvitationRequest struct {
	Role  metadata.OrganizationRole `json:"role"`
	Email string                    `json:"email"`
}

// Create makes a link and, when an address is given, mails it. A failed delivery does not
// lose the link: it is returned with the reason, so the administrator can copy it instead.
func (handler *InvitationHandler) Create(writer http.ResponseWriter, request *http.Request) {
	principal, organizationID, ok := principalAndOrganization(writer, request)
	if !ok {
		return
	}
	var payload createInvitationRequest
	if !decodeJSONBody(writer, request, &payload) {
		return
	}
	payload.Email = strings.ToLower(strings.TrimSpace(payload.Email))
	if !metadata.InvitationRole(payload.Role) || (payload.Email != "" && !validEmail(payload.Email)) {
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "Role or email is invalid.")
		return
	}
	access, err := handler.organizations.GetForUser(request.Context(), principal.UserID, organizationID)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	if err := auth.Authorize(access.Role, auth.ActionManageMembers); err != nil {
		writeControlPlaneError(writer, request, handler.logger, errors.Join(metadata.ErrForbidden, err))
		return
	}
	if payload.Email != "" {
		configured, err := handler.mail.Configured(request.Context())
		if err != nil {
			writeControlPlaneError(writer, request, handler.logger, err)
			return
		}
		if !configured {
			httpx.WriteError(writer, request, http.StatusConflict, "EMAIL_NOT_CONFIGURED", "No mail server is configured.")
			return
		}
	}
	var recipient *string
	if payload.Email != "" {
		recipient = &payload.Email
	}
	credential, err := handler.invitations.Create(request.Context(), principal.UserID, organizationID, payload.Role, recipient)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	link := handler.link(credential.Secret)
	response := map[string]any{"invitation": invitationDTO(credential.Invitation), "link": link}
	if recipient != nil {
		response["delivery"] = handler.deliver(request.Context(), *recipient, principal.DisplayName, access.Organization.Name, credential.Invitation, link)
	}
	writeJSON(writer, http.StatusCreated, response)
}

func (handler *InvitationHandler) deliver(ctx context.Context, to, inviter, organization string, invitation metadata.Invitation, link string) map[string]any {
	err := handler.mail.Send(ctx, mailer.Message{
		To:      []string{to},
		Subject: inviter + " 邀请你加入 OpenRUM 组织「" + organization + "」",
		Body: inviter + " 邀请你加入 OpenRUM 组织「" + organization + "」。\n\n" +
			"打开下面的链接注册或登录，并提交加入申请。管理员通过后你就能进入该组织：\n" + link + "\n\n" +
			"链接在 " + invitation.ExpiresAt.UTC().Format("2006-01-02") + " 前有效。如果你不认识这位邀请人，请忽略这封邮件。\n\n" +
			"-----\n\n" +
			inviter + " invited you to join the OpenRUM organization \"" + organization + "\".\n\n" +
			"Open the link below to sign up or sign in and send a request to join. You can enter the organization once an administrator approves it:\n" + link + "\n\n" +
			"The link works until " + invitation.ExpiresAt.UTC().Format("2006-01-02") + ". If you do not know the person who invited you, ignore this message.\n",
	})
	if err != nil {
		result := emailFailure(err, handler.logger)
		result["recipient"] = to
		return result
	}
	return map[string]any{"success": true, "recipient": to}
}

func (handler *InvitationHandler) link(secret string) string {
	base := strings.TrimRight(handler.publicBaseURL.String(), "/")
	return base + "/invite/" + secret
}

func (handler *InvitationHandler) Revoke(writer http.ResponseWriter, request *http.Request) {
	principal, organizationID, ok := principalAndOrganization(writer, request)
	if !ok {
		return
	}
	invitationID, ok := parsePathUUID(writer, request, "invitationId")
	if !ok {
		return
	}
	if err := handler.invitations.Revoke(request.Context(), principal.UserID, organizationID, invitationID); err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

func (handler *InvitationHandler) ListRequests(writer http.ResponseWriter, request *http.Request) {
	principal, organizationID, ok := principalAndOrganization(writer, request)
	if !ok {
		return
	}
	requests, err := handler.invitations.ListJoinRequests(request.Context(), principal.UserID, organizationID)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	response := make([]joinRequestResponse, 0, len(requests))
	for _, item := range requests {
		response = append(response, joinRequestResponse{
			ID: item.ID.String(), UserID: item.UserID.String(), Email: item.Email, DisplayName: item.DisplayName,
			Avatar: item.Avatar, Role: item.Role, CreatedAt: item.CreatedAt.UTC().Format(timeFormat),
		})
	}
	writeJSON(writer, http.StatusOK, map[string]any{"requests": response})
}

func (handler *InvitationHandler) Approve(writer http.ResponseWriter, request *http.Request) {
	principal, organizationID, ok := principalAndOrganization(writer, request)
	if !ok {
		return
	}
	requestID, ok := parsePathUUID(writer, request, "requestId")
	if !ok {
		return
	}
	var payload updateMemberRequest
	if !decodeJSONBody(writer, request, &payload) {
		return
	}
	if !validRole(payload.Role) {
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "Role is invalid.")
		return
	}
	if err := handler.invitations.Approve(request.Context(), principal.UserID, organizationID, requestID, payload.Role); err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

func (handler *InvitationHandler) Reject(writer http.ResponseWriter, request *http.Request) {
	principal, organizationID, ok := principalAndOrganization(writer, request)
	if !ok {
		return
	}
	requestID, ok := parsePathUUID(writer, request, "requestId")
	if !ok {
		return
	}
	if err := handler.invitations.Reject(request.Context(), principal.UserID, organizationID, requestID); err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

// Preview tells a visitor who holds a link what it is for. It is public, and reveals only
// the organization's name, who invited them and the role on offer.
func (handler *InvitationHandler) Preview(writer http.ResponseWriter, request *http.Request) {
	preview, err := handler.invitations.Inspect(request.Context(), request.PathValue("token"))
	if err != nil {
		if errors.Is(err, metadata.ErrNotFound) {
			httpx.WriteError(writer, request, http.StatusNotFound, "NOT_FOUND", "Resource not found.")
			return
		}
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	writeJSON(writer, http.StatusOK, previewDTO(preview))
}

func previewDTO(preview metadata.InvitationPreview) map[string]any {
	return map[string]any{
		"organizationName": preview.OrganizationName, "inviterName": preview.InviterName,
		"role": preview.Role, "state": preview.State,
	}
}

type registerInvitationRequest struct {
	Email       string `json:"email"`
	DisplayName string `json:"displayName"`
	Password    string `json:"password"`
}

// Register creates an account for someone holding a link and files their request. The
// account is signed in but pending: it reaches nothing until an administrator approves.
func (handler *InvitationHandler) Register(writer http.ResponseWriter, request *http.Request) {
	var payload registerInvitationRequest
	if !decodeJSONBody(writer, request, &payload) {
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
	allowed, err := handler.registrationAllowed(request)
	if err != nil {
		handler.logger.Error().Err(err).Msg("invitation registration limiter unavailable")
		httpx.WriteError(writer, request, http.StatusServiceUnavailable, "TEMPORARILY_UNAVAILABLE", "Try again in a moment.")
		return
	}
	if !allowed {
		writer.Header().Set("Retry-After", "3600")
		httpx.WriteError(writer, request, http.StatusTooManyRequests, "RATE_LIMITED", "Too many sign-ups from this address. Try again later.")
		return
	}
	hash, err := auth.HashPassword(payload.Password)
	if err != nil {
		handler.internalError(writer, request, err)
		return
	}
	result, err := handler.invitations.Register(request.Context(), request.PathValue("token"), metadata.InvitationRegistration{
		Email: payload.Email, DisplayName: payload.DisplayName, PasswordHash: hash,
	})
	if err != nil {
		switch {
		case errors.Is(err, metadata.ErrInvitationInvalid):
			httpx.WriteError(writer, request, http.StatusGone, "INVITATION_INVALID", "This invitation is no longer valid.")
		case errors.Is(err, metadata.ErrInvitationLimit):
			httpx.WriteError(writer, request, http.StatusConflict, "INVITATION_LIMIT", "This organization has too many pending requests.")
		case errors.Is(err, metadata.ErrConflict):
			httpx.WriteError(writer, request, http.StatusConflict, "EMAIL_TAKEN", "This email is already registered. Sign in to ask to join.")
		default:
			handler.internalError(writer, request, err)
		}
		return
	}
	previousToken := ""
	if cookie, cookieErr := request.Cookie(auth.SessionCookieName); cookieErr == nil {
		previousToken = cookie.Value
	}
	credentials, err := handler.sessions.Rotate(request.Context(), result.UserID, previousToken, remoteIPAddress(request), request.UserAgent())
	if err != nil {
		handler.internalError(writer, request, err)
		return
	}
	setAuthenticationCookies(writer, credentials, handler.secureCookie)
	writeJSON(writer, http.StatusCreated, map[string]any{
		"userId": result.UserID.String(), "organizationName": result.OrganizationName, "accessStatus": "pending",
	})
}

// Join files the signed-in user's request to join through a link. It grants nothing.
func (handler *InvitationHandler) Join(writer http.ResponseWriter, request *http.Request) {
	principal, ok := httpx.PrincipalFromContext(request.Context())
	if !ok {
		httpx.WriteError(writer, request, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication is required.")
		return
	}
	outcome, preview, err := handler.invitations.Join(request.Context(), principal.UserID, request.PathValue("token"))
	if err != nil {
		switch {
		case errors.Is(err, metadata.ErrInvitationInvalid):
			httpx.WriteError(writer, request, http.StatusGone, "INVITATION_INVALID", "This invitation is no longer valid.")
		case errors.Is(err, metadata.ErrInvitationLimit):
			httpx.WriteError(writer, request, http.StatusConflict, "INVITATION_LIMIT", "This organization has too many pending requests.")
		default:
			writeControlPlaneError(writer, request, handler.logger, err)
		}
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"outcome": outcome, "organizationName": preview.OrganizationName})
}

func (handler *InvitationHandler) registrationAllowed(request *http.Request) (bool, error) {
	digest := sha256.Sum256([]byte(remoteIPAddress(request)))
	key := "openrum:invite:register:" + hex.EncodeToString(digest[:])
	count, err := handler.redis.Eval(request.Context(), `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1])) end
return count`, []string{key}, invitationRegisterWindow).Int64()
	return count <= invitationRegisterLimit, err
}

func (handler *InvitationHandler) internalError(writer http.ResponseWriter, request *http.Request, err error) {
	handler.logger.Error().Err(err).Str("request_id", httpx.RequestIDFromContext(request.Context())).Msg("invitation request failed")
	httpx.WriteError(writer, request, http.StatusInternalServerError, "INTERNAL_ERROR", "An internal error occurred.")
}

var _ invitationMailer = (*mailservice.Service)(nil)
