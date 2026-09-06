package handlers

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/rs/zerolog"

	"openrum/internal/auth"
	"openrum/internal/httpx"
)

const bootstrapBodyLimit = 16 << 10

type SetupHandler struct {
	bootstrapper *auth.Bootstrapper
	logger       zerolog.Logger
	secureCookie bool
}

type bootstrapRequest struct {
	Email            string `json:"email"`
	DisplayName      string `json:"displayName"`
	Password         string `json:"password"`
	OrganizationName string `json:"organizationName"`
}

func NewSetupHandler(bootstrapper *auth.Bootstrapper, logger zerolog.Logger, secureCookie bool) *SetupHandler {
	return &SetupHandler{bootstrapper: bootstrapper, logger: logger, secureCookie: secureCookie}
}

func (handler *SetupHandler) Status(writer http.ResponseWriter, request *http.Request) {
	initialized, err := handler.bootstrapper.Status(request.Context())
	if err != nil {
		handler.internalError(writer, request, err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]bool{"initialized": initialized})
}

func (handler *SetupHandler) Bootstrap(writer http.ResponseWriter, request *http.Request) {
	request.Body = http.MaxBytesReader(writer, request.Body, bootstrapBodyLimit)
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()
	var payload bootstrapRequest
	if err := decoder.Decode(&payload); err != nil {
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "Invalid request body.")
		return
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "Invalid request body.")
		return
	}

	result, credentials, err := handler.bootstrapper.BootstrapWithSession(request.Context(), auth.BootstrapInput{
		Email:            payload.Email,
		DisplayName:      payload.DisplayName,
		Password:         payload.Password,
		OrganizationName: payload.OrganizationName,
	}, request.Header.Get("X-OpenRUM-Bootstrap-Token"), remoteIPAddress(request), request.UserAgent())
	if err != nil {
		var validationError *auth.ValidationError
		switch {
		case errors.As(err, &validationError):
			httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "Invalid bootstrap input.")
		case errors.Is(err, auth.ErrInvalidBootstrapToken):
			httpx.WriteError(writer, request, http.StatusForbidden, "BOOTSTRAP_TOKEN_INVALID", "Bootstrap is not authorized.")
		case errors.Is(err, auth.ErrAlreadyInitialized):
			httpx.WriteError(writer, request, http.StatusConflict, "ALREADY_INITIALIZED", "This instance is already initialized.")
		default:
			handler.internalError(writer, request, err)
		}
		return
	}
	setAuthenticationCookies(writer, credentials, handler.secureCookie)
	writeJSON(writer, http.StatusCreated, map[string]string{
		"userId":         result.UserID.String(),
		"organizationId": result.OrganizationID.String(),
	})
}

func (handler *SetupHandler) internalError(writer http.ResponseWriter, request *http.Request, err error) {
	handler.logger.Error().Err(err).Str("request_id", httpx.RequestIDFromContext(request.Context())).Msg("setup request failed")
	httpx.WriteError(writer, request, http.StatusInternalServerError, "INTERNAL_ERROR", "An internal error occurred.")
}

// writeJSON serialises before touching the status line. Encoding straight into
// the writer would commit a success status and then abort mid-body, so a
// payload holding an unencodable value such as NaN would reach the client as a
// truncated 200 instead of an error.
func writeJSON(writer http.ResponseWriter, status int, payload any) {
	body, err := json.Marshal(payload)
	if err != nil {
		writer.Header().Set("Content-Type", "application/json; charset=utf-8")
		writer.Header().Set("Cache-Control", "no-store")
		writer.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(writer).Encode(httpx.ErrorEnvelope{
			Error: httpx.ErrorBody{Code: "INTERNAL_ERROR", Message: "An internal error occurred."},
		})
		return
	}
	writer.Header().Set("Content-Type", "application/json; charset=utf-8")
	writer.Header().Set("Cache-Control", "no-store")
	writer.WriteHeader(status)
	_, _ = writer.Write(append(body, '\n'))
}
