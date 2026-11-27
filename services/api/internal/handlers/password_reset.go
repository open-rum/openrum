package handlers

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"net/url"
	"strings"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"

	"openrum/internal/auth"
	"openrum/internal/httpx"
	"openrum/internal/mailer"
	"openrum/internal/metadata"
)

const (
	passwordResetRequestLimit = 10
	passwordResetConfirmLimit = 30
	passwordResetWindow       = 3600
)

type passwordResetStore interface {
	Request(ctx context.Context, email string, tokenHash []byte) (metadata.PasswordResetOutcome, error)
	Confirm(ctx context.Context, token, newPasswordHash string) (uuid.UUID, error)
}

type passwordResetMailer interface {
	Configured(context.Context) (bool, error)
	Send(context.Context, mailer.Message) error
}

// PasswordResetHandler exposes email-based self-service password recovery.
// Responses for unknown addresses match known ones so attackers cannot enumerate accounts.
type PasswordResetHandler struct {
	store         passwordResetStore
	mail          passwordResetMailer
	redis         redis.UniversalClient
	publicBaseURL *url.URL
	logger        zerolog.Logger
}

func NewPasswordResetHandler(
	store passwordResetStore,
	mail passwordResetMailer,
	redisClient redis.UniversalClient,
	publicBaseURL *url.URL,
	logger zerolog.Logger,
) *PasswordResetHandler {
	return &PasswordResetHandler{
		store:         store,
		mail:          mail,
		redis:         redisClient,
		publicBaseURL: publicBaseURL,
		logger:        logger,
	}
}

// Status reports whether email-based password reset is available on this instance.
func (handler *PasswordResetHandler) Status(writer http.ResponseWriter, request *http.Request) {
	configured, err := handler.mail.Configured(request.Context())
	if err != nil {
		handler.logger.Error().Err(err).Msg("read mail configuration for password reset")
		configured = false
	}
	writeJSON(writer, http.StatusOK, map[string]bool{"enabled": configured})
}

type passwordResetRequestBody struct {
	Email string `json:"email"`
}

// Request issues a one-time reset link and mails it when the email belongs to an active
// verified account. Every valid email receives 202 Accepted regardless of whether an account exists.
func (handler *PasswordResetHandler) Request(writer http.ResponseWriter, request *http.Request) {
	var payload passwordResetRequestBody
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
		httpx.WriteError(writer, request, http.StatusServiceUnavailable, "EMAIL_UNAVAILABLE", "Password reset by email needs a configured mail server.")
		return
	}
	if !handler.allowed(writer, request, "request", passwordResetRequestLimit) {
		return
	}
	token, tokenHash, err := metadata.NewPasswordResetToken()
	if err != nil {
		handler.internalError(writer, request, err)
		return
	}
	outcome, err := handler.store.Request(request.Context(), payload.Email, tokenHash)
	if err != nil {
		handler.internalError(writer, request, err)
		return
	}
	if outcome == metadata.PasswordResetSend {
		link := strings.TrimRight(handler.publicBaseURL.String(), "/") + "/reset-password/" + token
		err := handler.mail.Send(request.Context(), mailer.Message{
			To:      []string{payload.Email},
			Subject: "重置你的 OpenRUM 密码 / Reset your OpenRUM password",
			Body: "你（或某个人）请求重置该邮箱对应的 OpenRUM 密码。打开下面的链接设置新密码：\n" + link + "\n\n" +
				"链接 1 小时内有效。重置后，该账号的其他登录会话将自动退出。如果不是你本人操作，请忽略这封邮件。\n\n" +
				"-----\n\n" +
				"You (or someone) requested a password reset for your OpenRUM account. Open the link below to set a new password:\n" + link + "\n\n" +
				"The link works for 1 hour. Existing sessions will be signed out after the password changes. If this was not you, ignore this message.\n",
		})
		if err != nil {
			handler.logger.Error().Err(err).Str("request_id", httpx.RequestIDFromContext(request.Context())).Msg("send password reset email")
			httpx.WriteError(writer, request, http.StatusBadGateway, "EMAIL_DELIVERY_FAILED", "The password reset email could not be sent. Try again later.")
			return
		}
	}
	writeJSON(writer, http.StatusAccepted, map[string]string{"status": "reset_sent"})
}

type passwordResetConfirmBody struct {
	Token    string `json:"token"`
	Password string `json:"password"`
}

// Confirm consumes a reset link via POST so email security scanners cannot exhaust it, sets
// the new password and revokes existing sessions.
func (handler *PasswordResetHandler) Confirm(writer http.ResponseWriter, request *http.Request) {
	var payload passwordResetConfirmBody
	if !decodeJSONBody(writer, request, &payload) {
		return
	}
	if strings.TrimSpace(payload.Token) == "" {
		httpx.WriteError(writer, request, http.StatusGone, "PASSWORD_RESET_INVALID", "This password reset link is no longer valid.")
		return
	}
	if err := auth.ValidatePassword(payload.Password); err != nil {
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", passwordRuleMessage)
		return
	}
	if !handler.allowed(writer, request, "confirm", passwordResetConfirmLimit) {
		return
	}
	hash, err := auth.HashPassword(payload.Password)
	if err != nil {
		handler.internalError(writer, request, err)
		return
	}
	if _, err := handler.store.Confirm(request.Context(), payload.Token, hash); err != nil {
		if errors.Is(err, metadata.ErrPasswordResetInvalid) {
			httpx.WriteError(writer, request, http.StatusGone, "PASSWORD_RESET_INVALID", "This password reset link is no longer valid.")
			return
		}
		handler.internalError(writer, request, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

func (handler *PasswordResetHandler) allowed(writer http.ResponseWriter, request *http.Request, action string, limit int64) bool {
	if handler.redis == nil {
		return true
	}
	digest := sha256.Sum256([]byte(remoteIPAddress(request)))
	key := "openrum:password_reset:" + action + ":" + hex.EncodeToString(digest[:])
	count, err := handler.redis.Eval(request.Context(), `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1])) end
return count`, []string{key}, passwordResetWindow).Int64()
	if err != nil {
		handler.logger.Error().Err(err).Msg("password reset limiter unavailable")
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

func (handler *PasswordResetHandler) internalError(writer http.ResponseWriter, request *http.Request, err error) {
	handler.logger.Error().Err(err).Str("request_id", httpx.RequestIDFromContext(request.Context())).Msg("password reset request failed")
	httpx.WriteError(writer, request, http.StatusInternalServerError, "INTERNAL_ERROR", "An internal error occurred.")
}
