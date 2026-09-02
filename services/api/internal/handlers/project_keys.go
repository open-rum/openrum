package handlers

import (
	"errors"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"openrum/internal/auth"
	"openrum/internal/httpx"
	"openrum/internal/metadata"
)

type ProjectKeyHandler struct {
	keys   *metadata.ProjectKeyRepository
	logger zerolog.Logger
}

type projectKeyRequest struct {
	Name string `json:"name"`
}

type projectKeyResponse struct {
	ID         string  `json:"id"`
	ProjectID  string  `json:"projectId"`
	Name       string  `json:"name"`
	Prefix     string  `json:"prefix"`
	LastUsedAt *string `json:"lastUsedAt"`
	RevokedAt  *string `json:"revokedAt"`
	CreatedAt  string  `json:"createdAt"`
	WriteKey   string  `json:"writeKey,omitempty"`
}

func NewProjectKeyHandler(keys *metadata.ProjectKeyRepository, logger zerolog.Logger) *ProjectKeyHandler {
	return &ProjectKeyHandler{keys: keys, logger: logger}
}

func (handler *ProjectKeyHandler) List(writer http.ResponseWriter, request *http.Request) {
	principal, ok := httpx.PrincipalFromContext(request.Context())
	if !ok {
		httpx.WriteError(writer, request, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication is required.")
		return
	}
	projectID, ok := parsePathUUID(writer, request, "projectId")
	if !ok {
		return
	}
	keys, role, err := handler.keys.ListForUser(request.Context(), principal.UserID, projectID)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	if err := auth.Authorize(role, auth.ActionManageKeys); err != nil {
		writeControlPlaneError(writer, request, handler.logger, errors.Join(metadata.ErrForbidden, err))
		return
	}
	response := make([]projectKeyResponse, 0, len(keys))
	for _, key := range keys {
		response = append(response, projectKeyDTO(key, ""))
	}
	writeJSON(writer, http.StatusOK, map[string]any{"keys": response})
}

func (handler *ProjectKeyHandler) Create(writer http.ResponseWriter, request *http.Request) {
	principal, projectID, ok := principalAndProject(writer, request)
	if !ok {
		return
	}
	var payload projectKeyRequest
	if !decodeJSONBody(writer, request, &payload) {
		return
	}
	payload.Name = strings.TrimSpace(payload.Name)
	if !validName(payload.Name) {
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "Key name is invalid.")
		return
	}
	credential, err := handler.keys.Create(request.Context(), principal.UserID, projectID, payload.Name)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	writeJSON(writer, http.StatusCreated, projectKeyDTO(credential.Key, credential.Raw))
}

func (handler *ProjectKeyHandler) Rotate(writer http.ResponseWriter, request *http.Request) {
	principal, projectID, ok := principalAndProject(writer, request)
	if !ok {
		return
	}
	keyID, ok := parsePathUUID(writer, request, "keyId")
	if !ok {
		return
	}
	var payload projectKeyRequest
	if !decodeJSONBody(writer, request, &payload) {
		return
	}
	payload.Name = strings.TrimSpace(payload.Name)
	if payload.Name != "" && !validName(payload.Name) {
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "Key name is invalid.")
		return
	}
	credential, err := handler.keys.Rotate(request.Context(), principal.UserID, projectID, keyID, payload.Name)
	if err != nil {
		if errors.Is(err, metadata.ErrProjectKeyRevoked) {
			httpx.WriteError(writer, request, http.StatusConflict, "KEY_REVOKED", "A revoked key cannot be rotated.")
			return
		}
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	writeJSON(writer, http.StatusCreated, projectKeyDTO(credential.Key, credential.Raw))
}

func (handler *ProjectKeyHandler) Revoke(writer http.ResponseWriter, request *http.Request) {
	principal, projectID, ok := principalAndProject(writer, request)
	if !ok {
		return
	}
	keyID, ok := parsePathUUID(writer, request, "keyId")
	if !ok {
		return
	}
	if err := handler.keys.Revoke(request.Context(), principal.UserID, projectID, keyID); err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

func principalAndProject(writer http.ResponseWriter, request *http.Request) (auth.Principal, uuid.UUID, bool) {
	principal, ok := httpx.PrincipalFromContext(request.Context())
	if !ok {
		httpx.WriteError(writer, request, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication is required.")
		return auth.Principal{}, uuid.Nil, false
	}
	projectID, ok := parsePathUUID(writer, request, "projectId")
	return principal, projectID, ok
}

func projectKeyDTO(key metadata.ProjectKey, raw string) projectKeyResponse {
	response := projectKeyResponse{
		ID: key.ID.String(), ProjectID: key.ProjectID.String(), Name: key.Name, Prefix: key.KeyPrefix,
		CreatedAt: key.CreatedAt.UTC().Format(timeFormat), WriteKey: raw,
	}
	if key.LastUsedAt != nil {
		value := key.LastUsedAt.UTC().Format(timeFormat)
		response.LastUsedAt = &value
	}
	if key.RevokedAt != nil {
		value := key.RevokedAt.UTC().Format(timeFormat)
		response.RevokedAt = &value
	}
	return response
}
