package handlers

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"openrum/internal/auth"
	"openrum/internal/httpx"
	"openrum/internal/metadata"
)

type uploadTokenStore interface {
	List(context.Context, uuid.UUID) ([]metadata.UploadToken, error)
	Create(context.Context, uuid.UUID, uuid.UUID, string) (metadata.UploadTokenCredential, error)
	Revoke(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) error
}

// UploadTokenHandler manages project upload tokens. Any project member may see
// that tokens exist (so the Releases page can point at them); only Owners and
// Admins, who also manage DSN keys, may create or revoke them.
type UploadTokenHandler struct {
	projects overviewProjects
	tokens   uploadTokenStore
	logger   zerolog.Logger
}

func NewUploadTokenHandler(projects overviewProjects, tokens uploadTokenStore, logger zerolog.Logger) *UploadTokenHandler {
	return &UploadTokenHandler{projects: projects, tokens: tokens, logger: logger}
}

func (handler *UploadTokenHandler) List(writer http.ResponseWriter, request *http.Request) {
	_, projectID, role, ok := handler.access(writer, request, auth.ActionReadProject)
	if !ok {
		return
	}
	tokens, err := handler.tokens.List(request.Context(), projectID)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"tokens": tokens, "canManage": auth.Can(role, auth.ActionManageKeys)})
}

type uploadTokenRequest struct {
	Name string `json:"name"`
}

func (handler *UploadTokenHandler) Create(writer http.ResponseWriter, request *http.Request) {
	principal, projectID, _, ok := handler.access(writer, request, auth.ActionManageKeys)
	if !ok {
		return
	}
	var payload uploadTokenRequest
	if !decodeJSONBody(writer, request, &payload) {
		return
	}
	payload.Name = strings.TrimSpace(payload.Name)
	if !validName(payload.Name) || hasControl(payload.Name) {
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "Token name must be 1 to 120 characters.")
		return
	}
	credential, err := handler.tokens.Create(request.Context(), principal.UserID, projectID, payload.Name)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	writeJSON(writer, http.StatusCreated, map[string]any{"token": credential.Token, "secret": credential.Secret})
}

func (handler *UploadTokenHandler) Revoke(writer http.ResponseWriter, request *http.Request) {
	principal, projectID, _, ok := handler.access(writer, request, auth.ActionManageKeys)
	if !ok {
		return
	}
	tokenID, ok := parsePathUUID(writer, request, "tokenId")
	if !ok {
		return
	}
	if err := handler.tokens.Revoke(request.Context(), principal.UserID, projectID, tokenID); err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

func (handler *UploadTokenHandler) access(writer http.ResponseWriter, request *http.Request, action auth.Action) (auth.Principal, uuid.UUID, metadata.OrganizationRole, bool) {
	principal, projectID, ok := principalAndProject(writer, request)
	if !ok {
		return auth.Principal{}, uuid.Nil, "", false
	}
	access, err := handler.projects.GetForUser(request.Context(), principal.UserID, projectID)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return auth.Principal{}, uuid.Nil, "", false
	}
	if err := auth.Authorize(access.Role, action); err != nil {
		writeControlPlaneError(writer, request, handler.logger, errors.Join(metadata.ErrForbidden, err))
		return auth.Principal{}, uuid.Nil, "", false
	}
	return principal, projectID, access.Role, true
}
