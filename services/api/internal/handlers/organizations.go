package handlers

import (
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"openrum/internal/httpx"
	"openrum/internal/metadata"
)

var slugPattern = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

const timeFormat = time.RFC3339Nano

type OrganizationHandler struct {
	organizations *metadata.OrganizationRepository
	logger        zerolog.Logger
}

type organizationRequest struct {
	Name string `json:"name"`
	Slug string `json:"slug"`
}

type organizationResponse struct {
	ID        string                    `json:"id"`
	Name      string                    `json:"name"`
	Slug      string                    `json:"slug"`
	Role      metadata.OrganizationRole `json:"role"`
	CreatedAt string                    `json:"createdAt"`
	UpdatedAt string                    `json:"updatedAt"`
}

func NewOrganizationHandler(organizations *metadata.OrganizationRepository, logger zerolog.Logger) *OrganizationHandler {
	return &OrganizationHandler{organizations: organizations, logger: logger}
}

func (handler *OrganizationHandler) List(writer http.ResponseWriter, request *http.Request) {
	principal, ok := httpx.PrincipalFromContext(request.Context())
	if !ok {
		httpx.WriteError(writer, request, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication is required.")
		return
	}
	accesses, err := handler.organizations.ListForUser(request.Context(), principal.UserID)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	organizations := make([]organizationResponse, 0, len(accesses))
	for _, access := range accesses {
		organizations = append(organizations, organizationDTO(access))
	}
	writeJSON(writer, http.StatusOK, map[string]any{"organizations": organizations})
}

func (handler *OrganizationHandler) Create(writer http.ResponseWriter, request *http.Request) {
	principal, ok := httpx.PrincipalFromContext(request.Context())
	if !ok {
		httpx.WriteError(writer, request, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication is required.")
		return
	}
	var payload organizationRequest
	if !decodeJSONBody(writer, request, &payload) {
		return
	}
	payload.Name = strings.TrimSpace(payload.Name)
	payload.Slug = strings.TrimSpace(payload.Slug)
	if !validName(payload.Name) || !validSlug(payload.Slug) {
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "Name or slug is invalid.")
		return
	}
	access, err := handler.organizations.Create(request.Context(), principal.UserID, payload.Name, payload.Slug)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	writeJSON(writer, http.StatusCreated, organizationDTO(access))
}

func organizationDTO(access metadata.OrganizationAccess) organizationResponse {
	return organizationResponse{
		ID: access.Organization.ID.String(), Name: access.Organization.Name, Slug: access.Organization.Slug,
		Role: access.Role, CreatedAt: access.Organization.CreatedAt.UTC().Format(timeFormat),
		UpdatedAt: access.Organization.UpdatedAt.UTC().Format(timeFormat),
	}
}

func validName(value string) bool {
	count := utf8.RuneCountInString(value)
	return count >= 1 && count <= 120
}

func validSlug(value string) bool {
	return len(value) <= 63 && slugPattern.MatchString(value)
}

func parsePathUUID(writer http.ResponseWriter, request *http.Request, name string) (uuid.UUID, bool) {
	value, err := uuid.Parse(request.PathValue(name))
	if err != nil {
		httpx.WriteError(writer, request, http.StatusNotFound, "NOT_FOUND", "Resource not found.")
		return uuid.Nil, false
	}
	return value, true
}

func writeControlPlaneError(writer http.ResponseWriter, request *http.Request, logger zerolog.Logger, err error) {
	switch {
	case errors.Is(err, metadata.ErrNotFound):
		httpx.WriteError(writer, request, http.StatusNotFound, "NOT_FOUND", "Resource not found.")
	case errors.Is(err, metadata.ErrForbidden):
		httpx.WriteError(writer, request, http.StatusForbidden, "FORBIDDEN", "You do not have permission to perform this action.")
	case errors.Is(err, metadata.ErrConflict):
		httpx.WriteError(writer, request, http.StatusConflict, "CONFLICT", "A resource with these values already exists.")
	case errors.Is(err, metadata.ErrProjectMustBeDisabled):
		httpx.WriteError(writer, request, http.StatusConflict, "PROJECT_MUST_BE_DISABLED", "Disable the project before deleting its data.")
	case errors.Is(err, metadata.ErrProjectDataPurgeInProgress):
		httpx.WriteError(writer, request, http.StatusConflict, "PROJECT_DATA_PURGE_IN_PROGRESS", "Project data deletion is still in progress.")
	case errors.Is(err, metadata.ErrInvalidDataPurgeConfirmation):
		httpx.WriteError(writer, request, http.StatusBadRequest, "INVALID_CONFIRMATION", "The confirmation does not match the project name.")
	case errors.Is(err, metadata.ErrLastOwner):
		httpx.WriteError(writer, request, http.StatusConflict, "LAST_OWNER_REQUIRED", "The organization must retain at least one owner.")
	case errors.Is(err, metadata.ErrLastInstanceOwner):
		httpx.WriteError(writer, request, http.StatusConflict, "LAST_INSTANCE_OWNER_REQUIRED", "The instance must retain at least one owner.")
	case errors.Is(err, metadata.ErrInstancePasswordRequired):
		httpx.WriteError(writer, request, http.StatusConflict, "PASSWORD_REQUIRED", "The account must set an OpenRUM password before receiving an Instance role.")
	case errors.Is(err, metadata.ErrInvalidAlertConfig):
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "Alert settings are invalid.")
	case errors.Is(err, metadata.ErrSecretsUnavailable):
		httpx.WriteError(writer, request, http.StatusServiceUnavailable, "MANAGED_SECRETS_REQUIRED",
			"Notification channels need an Instance master key. Set OPENRUM_ALLOW_MANAGED_SECRETS and OPENRUM_MASTER_KEY.")
	default:
		logger.Error().Err(err).Str("request_id", httpx.RequestIDFromContext(request.Context())).Msg("control-plane request failed")
		httpx.WriteError(writer, request, http.StatusInternalServerError, "INTERNAL_ERROR", "An internal error occurred.")
	}
}
