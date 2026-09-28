package handlers

import (
	"context"
	"errors"
	"net/http"
	"net/mail"
	"strings"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"openrum/internal/auth"
	"openrum/internal/httpx"
	"openrum/internal/metadata"
)

type instanceMembers interface {
	RoleForUser(ctx context.Context, userID uuid.UUID) (metadata.InstanceRole, error)
	List(ctx context.Context) ([]metadata.InstanceMemberView, error)
	Get(ctx context.Context, userID uuid.UUID) (metadata.InstanceMemberView, error)
	FindActiveUserByEmail(ctx context.Context, email string) (metadata.User, error)
	Add(ctx context.Context, actorID, userID uuid.UUID, role metadata.InstanceRole) error
	UpdateRole(ctx context.Context, actorID, userID uuid.UUID, role metadata.InstanceRole) error
	Remove(ctx context.Context, actorID, userID uuid.UUID) error
}

type AdminMemberHandler struct {
	members instanceMembers
	reauth  recentElevationChecker
	logger  zerolog.Logger
}

type adminMemberRequest struct {
	Email string                `json:"email"`
	Role  metadata.InstanceRole `json:"role"`
}

type adminMemberRoleRequest struct {
	Role metadata.InstanceRole `json:"role"`
}

type adminMemberResponse struct {
	UserID      string                `json:"userId"`
	Email       string                `json:"email"`
	DisplayName string                `json:"displayName"`
	Role        metadata.InstanceRole `json:"role"`
	CreatedBy   *string               `json:"createdBy"`
	CreatedAt   string                `json:"createdAt"`
	UpdatedAt   string                `json:"updatedAt"`
}

func NewAdminMemberHandler(members instanceMembers, reauth recentElevationChecker, logger zerolog.Logger) *AdminMemberHandler {
	return &AdminMemberHandler{members: members, reauth: reauth, logger: logger}
}

func (handler *AdminMemberHandler) List(writer http.ResponseWriter, request *http.Request) {
	if _, ok := handler.authorize(writer, request, auth.InstanceActionRead); !ok {
		return
	}
	members, err := handler.members.List(request.Context())
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	response := make([]adminMemberResponse, 0, len(members))
	for _, member := range members {
		response = append(response, adminMemberDTO(member))
	}
	writeJSON(writer, http.StatusOK, map[string]any{"members": response})
}

func (handler *AdminMemberHandler) Add(writer http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorize(writer, request, auth.InstanceActionManageMembers)
	if !ok {
		return
	}
	if !requireAdminElevation(writer, request, principal, handler.reauth, handler.logger) {
		return
	}
	var payload adminMemberRequest
	if !decodeJSONBody(writer, request, &payload) {
		return
	}
	payload.Email = strings.ToLower(strings.TrimSpace(payload.Email))
	if !validAdminEmail(payload.Email) || !validInstanceRole(payload.Role) {
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "Email or role is invalid.")
		return
	}
	user, err := handler.members.FindActiveUserByEmail(request.Context(), payload.Email)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	if user.PasswordHash == nil {
		httpx.WriteError(writer, request, http.StatusConflict, "PASSWORD_REQUIRED", "The account must set an OpenRUM password before receiving an Instance role.")
		return
	}
	if err := handler.members.Add(request.Context(), principal.UserID, user.ID, payload.Role); err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	member, err := handler.members.Get(request.Context(), user.ID)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	writeJSON(writer, http.StatusCreated, adminMemberDTO(member))
}

func (handler *AdminMemberHandler) Update(writer http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorize(writer, request, auth.InstanceActionManageMembers)
	if !ok {
		return
	}
	if !requireAdminElevation(writer, request, principal, handler.reauth, handler.logger) {
		return
	}
	userID, ok := parsePathUUID(writer, request, "userId")
	if !ok {
		return
	}
	var payload adminMemberRoleRequest
	if !decodeJSONBody(writer, request, &payload) {
		return
	}
	if !validInstanceRole(payload.Role) {
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "Role is invalid.")
		return
	}
	if err := handler.members.UpdateRole(request.Context(), principal.UserID, userID, payload.Role); err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	member, err := handler.members.Get(request.Context(), userID)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	writeJSON(writer, http.StatusOK, adminMemberDTO(member))
}

func (handler *AdminMemberHandler) Remove(writer http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorize(writer, request, auth.InstanceActionManageMembers)
	if !ok {
		return
	}
	if !requireAdminElevation(writer, request, principal, handler.reauth, handler.logger) {
		return
	}
	userID, ok := parsePathUUID(writer, request, "userId")
	if !ok {
		return
	}
	if err := handler.members.Remove(request.Context(), principal.UserID, userID); err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

func (handler *AdminMemberHandler) authorize(writer http.ResponseWriter, request *http.Request, action auth.InstanceAction) (auth.Principal, bool) {
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

func adminMemberDTO(member metadata.InstanceMemberView) adminMemberResponse {
	var createdBy *string
	if member.CreatedBy != nil {
		value := member.CreatedBy.String()
		createdBy = &value
	}
	return adminMemberResponse{
		UserID: member.UserID.String(), Email: member.Email, DisplayName: member.DisplayName,
		Role: member.Role, CreatedBy: createdBy, CreatedAt: member.CreatedAt.UTC().Format(timeFormat),
		UpdatedAt: member.UpdatedAt.UTC().Format(timeFormat),
	}
}

func validAdminEmail(value string) bool {
	parsed, err := mail.ParseAddress(value)
	return err == nil && parsed.Address == value && len(value) <= 320
}

func validInstanceRole(role metadata.InstanceRole) bool {
	return role == metadata.InstanceRoleOwner || role == metadata.InstanceRoleAdmin
}
