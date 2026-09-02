package handlers

import (
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

type MemberHandler struct {
	organizations *metadata.OrganizationRepository
	logger        zerolog.Logger
}

type addMemberRequest struct {
	Email string                    `json:"email"`
	Role  metadata.OrganizationRole `json:"role"`
}

type updateMemberRequest struct {
	Role metadata.OrganizationRole `json:"role"`
}

type memberResponse struct {
	UserID      string                    `json:"userId"`
	Email       string                    `json:"email"`
	DisplayName string                    `json:"displayName"`
	Role        metadata.OrganizationRole `json:"role"`
	CreatedAt   string                    `json:"createdAt"`
	UpdatedAt   string                    `json:"updatedAt"`
}

func NewMemberHandler(organizations *metadata.OrganizationRepository, logger zerolog.Logger) *MemberHandler {
	return &MemberHandler{organizations: organizations, logger: logger}
}

func (handler *MemberHandler) List(writer http.ResponseWriter, request *http.Request) {
	principal, organizationID, ok := principalAndOrganization(writer, request)
	if !ok {
		return
	}
	members, err := handler.organizations.ListMembers(request.Context(), principal.UserID, organizationID)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	response := make([]memberResponse, 0, len(members))
	for _, member := range members {
		response = append(response, memberDTO(member))
	}
	writeJSON(writer, http.StatusOK, map[string]any{"members": response})
}

func (handler *MemberHandler) Add(writer http.ResponseWriter, request *http.Request) {
	principal, organizationID, ok := principalAndOrganization(writer, request)
	if !ok {
		return
	}
	var payload addMemberRequest
	if !decodeJSONBody(writer, request, &payload) {
		return
	}
	payload.Email = strings.ToLower(strings.TrimSpace(payload.Email))
	if !validEmail(payload.Email) || !validRole(payload.Role) {
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "Email or role is invalid.")
		return
	}
	if !handler.canManage(writer, request, principal.UserID, organizationID) {
		return
	}
	user, err := handler.organizations.FindActiveUserByEmail(request.Context(), payload.Email)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	if err := handler.organizations.AddMember(request.Context(), principal.UserID, organizationID, user.ID, payload.Role); err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	member, err := handler.organizations.GetMember(request.Context(), principal.UserID, organizationID, user.ID)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	writeJSON(writer, http.StatusCreated, memberDTO(member))
}

func (handler *MemberHandler) Update(writer http.ResponseWriter, request *http.Request) {
	principal, organizationID, ok := principalAndOrganization(writer, request)
	if !ok {
		return
	}
	userID, ok := parsePathUUID(writer, request, "userId")
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
	if !handler.canManage(writer, request, principal.UserID, organizationID) {
		return
	}
	if err := handler.organizations.UpdateMemberRole(request.Context(), principal.UserID, organizationID, userID, payload.Role); err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	member, err := handler.organizations.GetMember(request.Context(), principal.UserID, organizationID, userID)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	writeJSON(writer, http.StatusOK, memberDTO(member))
}

func (handler *MemberHandler) Remove(writer http.ResponseWriter, request *http.Request) {
	principal, organizationID, ok := principalAndOrganization(writer, request)
	if !ok {
		return
	}
	userID, ok := parsePathUUID(writer, request, "userId")
	if !ok {
		return
	}
	if !handler.canManage(writer, request, principal.UserID, organizationID) {
		return
	}
	if err := handler.organizations.RemoveMember(request.Context(), principal.UserID, organizationID, userID); err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

func (handler *MemberHandler) canManage(writer http.ResponseWriter, request *http.Request, userID, organizationID uuid.UUID) bool {
	access, err := handler.organizations.GetForUser(request.Context(), userID, organizationID)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return false
	}
	if err := auth.Authorize(access.Role, auth.ActionManageMembers); err != nil {
		writeControlPlaneError(writer, request, handler.logger, errors.Join(metadata.ErrForbidden, err))
		return false
	}
	return true
}

func principalAndOrganization(writer http.ResponseWriter, request *http.Request) (auth.Principal, uuid.UUID, bool) {
	principal, ok := httpx.PrincipalFromContext(request.Context())
	if !ok {
		httpx.WriteError(writer, request, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication is required.")
		return auth.Principal{}, uuid.Nil, false
	}
	organizationID, ok := parsePathUUID(writer, request, "orgId")
	return principal, organizationID, ok
}

func memberDTO(member metadata.OrganizationMemberView) memberResponse {
	return memberResponse{
		UserID: member.UserID.String(), Email: member.Email, DisplayName: member.DisplayName, Role: member.Role,
		CreatedAt: member.CreatedAt.UTC().Format(timeFormat), UpdatedAt: member.UpdatedAt.UTC().Format(timeFormat),
	}
}

func validEmail(value string) bool {
	parsed, err := mail.ParseAddress(value)
	return err == nil && parsed.Address == value && len(value) <= 320
}

func validRole(role metadata.OrganizationRole) bool {
	return role == metadata.RoleOwner || role == metadata.RoleAdmin || role == metadata.RoleMember || role == metadata.RoleViewer
}
