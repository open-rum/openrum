package handlers

import (
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"strings"

	"github.com/rs/zerolog"

	"openrum/internal/auth"
	"openrum/internal/httpx"
)

type AuthHandler struct {
	loginManager *auth.LoginManager
	sessions     *auth.SessionManager
	logger       zerolog.Logger
	secureCookie bool
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type passwordRequest struct {
	CurrentPassword string `json:"currentPassword"`
	NewPassword     string `json:"newPassword"`
}

type reauthenticationRequest struct {
	CurrentPassword string `json:"currentPassword"`
}

func NewAuthHandler(loginManager *auth.LoginManager, sessions *auth.SessionManager, logger zerolog.Logger, secureCookie bool) *AuthHandler {
	return &AuthHandler{loginManager: loginManager, sessions: sessions, logger: logger, secureCookie: secureCookie}
}

func (handler *AuthHandler) Login(writer http.ResponseWriter, request *http.Request) {
	request.Body = http.MaxBytesReader(writer, request.Body, bootstrapBodyLimit)
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()
	var payload loginRequest
	if err := decoder.Decode(&payload); err != nil {
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "Invalid request body.")
		return
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "Invalid request body.")
		return
	}
	user, err := handler.loginManager.Authenticate(request.Context(), payload.Email, payload.Password, remoteIPAddress(request))
	if err != nil {
		switch {
		case errors.Is(err, auth.ErrInvalidCredentials):
			httpx.WriteError(writer, request, http.StatusUnauthorized, "INVALID_CREDENTIALS", "Email or password is incorrect.")
		case errors.Is(err, auth.ErrLoginRateLimited):
			writer.Header().Set("Retry-After", "900")
			httpx.WriteError(writer, request, http.StatusTooManyRequests, "LOGIN_RATE_LIMITED", "Too many login attempts. Try again later.")
		default:
			handler.logger.Error().Err(err).Str("request_id", httpx.RequestIDFromContext(request.Context())).Msg("login failed")
			httpx.WriteError(writer, request, http.StatusInternalServerError, "INTERNAL_ERROR", "An internal error occurred.")
		}
		return
	}
	previousToken := ""
	if cookie, cookieErr := request.Cookie(auth.SessionCookieName); cookieErr == nil {
		previousToken = cookie.Value
	}
	credentials, err := handler.sessions.Rotate(request.Context(), user.ID, previousToken, remoteIPAddress(request), request.UserAgent())
	if err != nil {
		handler.internalError(writer, request, err)
		return
	}
	handler.setCookies(writer, credentials)
	writeJSON(writer, http.StatusOK, map[string]string{
		"userId":      user.ID.String(),
		"email":       user.Email,
		"displayName": user.DisplayName,
	})
}

func (handler *AuthHandler) Me(writer http.ResponseWriter, request *http.Request) {
	principal, ok := httpx.PrincipalFromContext(request.Context())
	if !ok {
		httpx.WriteError(writer, request, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication is required.")
		return
	}
	writeJSON(writer, http.StatusOK, struct {
		UserID       string `json:"userId"`
		Email        string `json:"email"`
		DisplayName  string `json:"displayName"`
		InstanceRole string `json:"instanceRole,omitempty"`
	}{principal.UserID.String(), principal.Email, principal.DisplayName, principal.InstanceRole})
}

func (handler *AuthHandler) Logout(writer http.ResponseWriter, request *http.Request) {
	principal, ok := httpx.PrincipalFromContext(request.Context())
	if !ok {
		httpx.WriteError(writer, request, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication is required.")
		return
	}
	if err := handler.sessions.Revoke(request.Context(), principal.SessionID); err != nil {
		handler.internalError(writer, request, err)
		return
	}
	handler.clearCookies(writer)
	writer.WriteHeader(http.StatusNoContent)
}

func (handler *AuthHandler) ChangePassword(writer http.ResponseWriter, request *http.Request) {
	principal, ok := httpx.PrincipalFromContext(request.Context())
	if !ok {
		httpx.WriteError(writer, request, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication is required.")
		return
	}
	var payload passwordRequest
	if !decodeJSONBody(writer, request, &payload) {
		return
	}
	if err := handler.sessions.ChangePassword(request.Context(), principal, payload.CurrentPassword, payload.NewPassword); err != nil {
		var validationError *auth.ValidationError
		switch {
		case errors.As(err, &validationError):
			httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "New password must contain at least 12 characters.")
		case errors.Is(err, auth.ErrInvalidCredentials):
			httpx.WriteError(writer, request, http.StatusUnauthorized, "INVALID_CREDENTIALS", "Current password is incorrect.")
		default:
			handler.internalError(writer, request, err)
		}
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

func (handler *AuthHandler) Reauthenticate(writer http.ResponseWriter, request *http.Request) {
	principal, ok := httpx.PrincipalFromContext(request.Context())
	if !ok {
		httpx.WriteError(writer, request, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication is required.")
		return
	}
	var payload reauthenticationRequest
	if !decodeJSONBody(writer, request, &payload) {
		return
	}
	if err := handler.sessions.Elevate(request.Context(), principal, payload.CurrentPassword); err != nil {
		if errors.Is(err, auth.ErrInvalidCredentials) {
			httpx.WriteError(writer, request, http.StatusUnauthorized, "REAUTHENTICATION_FAILED", "Current password is incorrect or unavailable for this account.")
			return
		}
		handler.internalError(writer, request, err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"elevated": true, "expiresInSeconds": 300})
}

func (handler *AuthHandler) setCookies(writer http.ResponseWriter, credentials auth.SessionCredentials) {
	setAuthenticationCookies(writer, credentials, handler.secureCookie)
}

func setAuthenticationCookies(writer http.ResponseWriter, credentials auth.SessionCredentials, secure bool) {
	maxAge := int(auth.SessionAbsoluteTTL.Seconds())
	http.SetCookie(writer, &http.Cookie{
		Name: auth.SessionCookieName, Value: credentials.Token, Path: "/", Expires: credentials.ExpiresAt,
		MaxAge: maxAge, HttpOnly: true, Secure: secure, SameSite: http.SameSiteLaxMode,
	})
	http.SetCookie(writer, &http.Cookie{
		Name: auth.CSRFCookieName, Value: credentials.CSRFToken, Path: "/", Expires: credentials.ExpiresAt,
		MaxAge: maxAge, HttpOnly: false, Secure: secure, SameSite: http.SameSiteLaxMode,
	})
}

func (handler *AuthHandler) clearCookies(writer http.ResponseWriter) {
	for _, name := range []string{auth.SessionCookieName, auth.CSRFCookieName} {
		http.SetCookie(writer, &http.Cookie{
			Name: name, Value: "", Path: "/", MaxAge: -1, HttpOnly: name == auth.SessionCookieName,
			Secure: handler.secureCookie, SameSite: http.SameSiteLaxMode,
		})
	}
}

func (handler *AuthHandler) internalError(writer http.ResponseWriter, request *http.Request, err error) {
	handler.logger.Error().Err(err).Str("request_id", httpx.RequestIDFromContext(request.Context())).Msg("authentication request failed")
	httpx.WriteError(writer, request, http.StatusInternalServerError, "INTERNAL_ERROR", "An internal error occurred.")
}

func decodeJSONBody(writer http.ResponseWriter, request *http.Request, destination any) bool {
	request.Body = http.MaxBytesReader(writer, request.Body, bootstrapBodyLimit)
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "Invalid request body.")
		return false
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "Invalid request body.")
		return false
	}
	return true
}

func remoteIPAddress(request *http.Request) string {
	host, _, err := net.SplitHostPort(request.RemoteAddr)
	if err == nil {
		return host
	}
	return strings.TrimSpace(request.RemoteAddr)
}
