package handlers

import (
	"errors"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"strings"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"openrum/internal/auth"
	"openrum/internal/httpx"
	"openrum/internal/metadata"
)

var environmentPattern = regexp.MustCompile(`^[a-z][a-z0-9_-]{0,63}$`)

type ProjectHandler struct {
	organizations *metadata.OrganizationRepository
	projects      *metadata.ProjectRepository
	logger        zerolog.Logger
}

type createProjectRequest struct {
	Name            string   `json:"name"`
	Slug            string   `json:"slug"`
	AllowedOrigins  []string `json:"allowedOrigins"`
	Environment     string   `json:"environment"`
	RetentionDays   *int16   `json:"retentionDays"`
	EventSampleRate *float64 `json:"eventSampleRate"`
	APISampleRate   *float64 `json:"apiSampleRate"`
}

type updateProjectRequest struct {
	Name            *string                 `json:"name"`
	Slug            *string                 `json:"slug"`
	AllowedOrigins  *[]string               `json:"allowedOrigins"`
	Environment     *string                 `json:"environment"`
	RetentionDays   *int16                  `json:"retentionDays"`
	EventSampleRate *float64                `json:"eventSampleRate"`
	APISampleRate   *float64                `json:"apiSampleRate"`
	Status          *metadata.ProjectStatus `json:"status"`
}

type projectResponse struct {
	ID              string                    `json:"id"`
	OrganizationID  string                    `json:"organizationId"`
	Name            string                    `json:"name"`
	Slug            string                    `json:"slug"`
	AllowedOrigins  []string                  `json:"allowedOrigins"`
	Environment     string                    `json:"environment"`
	RetentionDays   int16                     `json:"retentionDays"`
	EventSampleRate float64                   `json:"eventSampleRate"`
	APISampleRate   float64                   `json:"apiSampleRate"`
	Status          metadata.ProjectStatus    `json:"status"`
	Role            metadata.OrganizationRole `json:"role,omitempty"`
	CreatedAt       string                    `json:"createdAt"`
	UpdatedAt       string                    `json:"updatedAt"`
	WriteKey        string                    `json:"writeKey,omitempty"`
}

func NewProjectHandler(organizations *metadata.OrganizationRepository, projects *metadata.ProjectRepository, logger zerolog.Logger) *ProjectHandler {
	return &ProjectHandler{organizations: organizations, projects: projects, logger: logger}
}

func (handler *ProjectHandler) List(writer http.ResponseWriter, request *http.Request) {
	principal, organizationID, ok := principalAndOrganization(writer, request)
	if !ok {
		return
	}
	access, err := handler.organizations.GetForUser(request.Context(), principal.UserID, organizationID)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	projects, err := handler.projects.ListForOrganization(request.Context(), principal.UserID, organizationID)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	response := make([]projectResponse, 0, len(projects))
	for _, project := range projects {
		response = append(response, projectDTO(project, access.Role))
	}
	writeJSON(writer, http.StatusOK, map[string]any{"projects": response})
}

func (handler *ProjectHandler) Create(writer http.ResponseWriter, request *http.Request) {
	principal, organizationID, ok := principalAndOrganization(writer, request)
	if !ok {
		return
	}
	var payload createProjectRequest
	if !decodeJSONBody(writer, request, &payload) {
		return
	}
	input, valid := validateCreateProject(payload, organizationID)
	if !valid {
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "Project settings are invalid.")
		return
	}
	access, err := handler.organizations.GetForUser(request.Context(), principal.UserID, organizationID)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	if err := auth.Authorize(access.Role, auth.ActionManageKeys); err != nil {
		writeControlPlaneError(writer, request, handler.logger, errors.Join(metadata.ErrForbidden, err))
		return
	}
	project, credential, err := handler.projects.CreateWithKey(request.Context(), principal.UserID, input, "Default")
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	response := projectDTO(project, access.Role)
	response.WriteKey = credential.Raw
	writeJSON(writer, http.StatusCreated, response)
}

func (handler *ProjectHandler) Get(writer http.ResponseWriter, request *http.Request) {
	principal, ok := httpx.PrincipalFromContext(request.Context())
	if !ok {
		httpx.WriteError(writer, request, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication is required.")
		return
	}
	projectID, ok := parsePathUUID(writer, request, "projectId")
	if !ok {
		return
	}
	access, err := handler.projects.GetForUser(request.Context(), principal.UserID, projectID)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	writeJSON(writer, http.StatusOK, projectDTO(access.Project, access.Role))
}

func (handler *ProjectHandler) Update(writer http.ResponseWriter, request *http.Request) {
	principal, ok := httpx.PrincipalFromContext(request.Context())
	if !ok {
		httpx.WriteError(writer, request, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication is required.")
		return
	}
	projectID, ok := parsePathUUID(writer, request, "projectId")
	if !ok {
		return
	}
	var payload updateProjectRequest
	if !decodeJSONBody(writer, request, &payload) {
		return
	}
	input, valid := validateUpdateProject(payload)
	if !valid {
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "Project settings are invalid.")
		return
	}
	access, err := handler.projects.GetForUser(request.Context(), principal.UserID, projectID)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	if err := auth.Authorize(access.Role, auth.ActionManageKeys); err != nil {
		writeControlPlaneError(writer, request, handler.logger, errors.Join(metadata.ErrForbidden, err))
		return
	}
	project, err := handler.projects.Update(request.Context(), principal.UserID, projectID, input)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	writeJSON(writer, http.StatusOK, projectDTO(project, access.Role))
}

func (handler *ProjectHandler) Delete(writer http.ResponseWriter, request *http.Request) {
	principal, ok := httpx.PrincipalFromContext(request.Context())
	if !ok {
		httpx.WriteError(writer, request, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication is required.")
		return
	}
	projectID, ok := parsePathUUID(writer, request, "projectId")
	if !ok {
		return
	}
	access, err := handler.projects.GetForUser(request.Context(), principal.UserID, projectID)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	if err := auth.Authorize(access.Role, auth.ActionDeleteProject); err != nil {
		writeControlPlaneError(writer, request, handler.logger, errors.Join(metadata.ErrForbidden, err))
		return
	}
	if err := handler.projects.RequestDeletion(request.Context(), principal.UserID, projectID); err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	writeJSON(writer, http.StatusAccepted, map[string]any{"status": "deleting", "deadlineHours": 24})
}

func validateCreateProject(payload createProjectRequest, organizationID uuid.UUID) (metadata.CreateProjectInput, bool) {
	payload.Name = strings.TrimSpace(payload.Name)
	payload.Slug = strings.TrimSpace(payload.Slug)
	payload.Environment = strings.TrimSpace(payload.Environment)
	if payload.Environment == "" {
		payload.Environment = "production"
	}
	origins, ok := normalizeOrigins(payload.AllowedOrigins)
	if !validName(payload.Name) || !validSlug(payload.Slug) || !environmentPattern.MatchString(payload.Environment) || !ok {
		return metadata.CreateProjectInput{}, false
	}
	retentionDays, eventSampleRate, apiSampleRate := int16(14), 1.0, 0.2
	if payload.RetentionDays != nil {
		retentionDays = *payload.RetentionDays
	}
	if payload.EventSampleRate != nil {
		eventSampleRate = *payload.EventSampleRate
	}
	if payload.APISampleRate != nil {
		apiSampleRate = *payload.APISampleRate
	}
	if !validRetention(retentionDays) || !validSampleRate(eventSampleRate) || !validSampleRate(apiSampleRate) {
		return metadata.CreateProjectInput{}, false
	}
	return metadata.CreateProjectInput{
		OrganizationID: organizationID, Name: payload.Name, Slug: payload.Slug, AllowedOrigins: origins,
		Environment: payload.Environment, RetentionDays: retentionDays, EventSampleRate: eventSampleRate,
		APISampleRate: apiSampleRate,
	}, true
}

func validateUpdateProject(payload updateProjectRequest) (metadata.UpdateProjectInput, bool) {
	if payload.Name == nil && payload.Slug == nil && payload.AllowedOrigins == nil && payload.Environment == nil &&
		payload.RetentionDays == nil && payload.EventSampleRate == nil && payload.APISampleRate == nil && payload.Status == nil {
		return metadata.UpdateProjectInput{}, false
	}
	if payload.Name != nil {
		trimmed := strings.TrimSpace(*payload.Name)
		payload.Name = &trimmed
		if !validName(trimmed) {
			return metadata.UpdateProjectInput{}, false
		}
	}
	if payload.Slug != nil {
		trimmed := strings.TrimSpace(*payload.Slug)
		payload.Slug = &trimmed
		if !validSlug(trimmed) {
			return metadata.UpdateProjectInput{}, false
		}
	}
	if payload.AllowedOrigins != nil {
		origins, ok := normalizeOrigins(*payload.AllowedOrigins)
		if !ok {
			return metadata.UpdateProjectInput{}, false
		}
		payload.AllowedOrigins = &origins
	}
	if payload.Environment != nil {
		trimmed := strings.TrimSpace(*payload.Environment)
		payload.Environment = &trimmed
		if !environmentPattern.MatchString(trimmed) {
			return metadata.UpdateProjectInput{}, false
		}
	}
	if payload.RetentionDays != nil && !validRetention(*payload.RetentionDays) {
		return metadata.UpdateProjectInput{}, false
	}
	if payload.EventSampleRate != nil && !validSampleRate(*payload.EventSampleRate) {
		return metadata.UpdateProjectInput{}, false
	}
	if payload.APISampleRate != nil && !validSampleRate(*payload.APISampleRate) {
		return metadata.UpdateProjectInput{}, false
	}
	if payload.Status != nil && *payload.Status != metadata.ProjectStatusActive && *payload.Status != metadata.ProjectStatusDisabled {
		return metadata.UpdateProjectInput{}, false
	}
	return metadata.UpdateProjectInput(payload), true
}

func normalizeOrigins(values []string) ([]string, bool) {
	if len(values) > 64 {
		return nil, false
	}
	result := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if len(value) == 0 || len(value) > 2048 || value == "*" {
			return nil, false
		}
		parsed, err := url.Parse(value)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" ||
			parsed.User != nil || parsed.Path != "" || parsed.RawPath != "" || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.Opaque != "" {
			return nil, false
		}
		canonical := strings.ToLower(parsed.Scheme) + "://" + strings.ToLower(parsed.Host)
		if _, exists := seen[canonical]; exists {
			continue
		}
		seen[canonical] = struct{}{}
		result = append(result, canonical)
	}
	return result, true
}

func validRetention(value int16) bool {
	return value >= 1 && value <= 90
}

func validSampleRate(value float64) bool {
	return value >= 0 && value <= 1 && !math.IsNaN(value) && !math.IsInf(value, 0)
}

func projectDTO(project metadata.Project, role metadata.OrganizationRole) projectResponse {
	return projectResponse{
		ID: project.ID.String(), OrganizationID: project.OrganizationID.String(), Name: project.Name, Slug: project.Slug,
		AllowedOrigins: project.AllowedOrigins, Environment: project.Environment, RetentionDays: project.RetentionDays,
		EventSampleRate: project.EventSampleRate, APISampleRate: project.APISampleRate, Status: project.Status,
		Role: role, CreatedAt: project.CreatedAt.UTC().Format(timeFormat), UpdatedAt: project.UpdatedAt.UTC().Format(timeFormat),
	}
}
