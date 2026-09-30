package handlers

import (
	"errors"
	"math"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"openrum/internal/auth"
	"openrum/internal/httpx"
	"openrum/internal/ingest"
	"openrum/internal/metadata"
)

const maxProjectEnvironments = 4

// validProjectEnvironment accepts only the fixed set: development, test, staging and
// production.
func validProjectEnvironment(value string) bool {
	return metadata.IsFixedEnvironment(value)
}

var validSDKPlatforms = map[metadata.SDKPlatform]struct{}{
	metadata.SDKPlatformJavaScript: {}, metadata.SDKPlatformReact: {}, metadata.SDKPlatformVue: {},
	metadata.SDKPlatformNextJS: {}, metadata.SDKPlatformNuxt: {}, metadata.SDKPlatformAngular: {}, metadata.SDKPlatformSvelte: {},
}

type ProjectHandler struct {
	organizations  *metadata.OrganizationRepository
	projects       *metadata.ProjectRepository
	ingestEndpoint string
	logger         zerolog.Logger
}

type createProjectRequest struct {
	Name            string               `json:"name"`
	Slug            string               `json:"slug"`
	SDKPlatform     metadata.SDKPlatform `json:"sdkPlatform"`
	AllowedOrigins  []string             `json:"allowedOrigins"`
	Environment     string               `json:"environment"`
	Environments    []string             `json:"environments"`
	RetentionDays   *int16               `json:"retentionDays"`
	EventSampleRate *float64             `json:"eventSampleRate"`
	APISampleRate   *float64             `json:"apiSampleRate"`
	ErrorSampleRate *float64             `json:"errorSampleRate"`
}

type updateProjectRequest struct {
	Name            *string               `json:"name"`
	Slug            *string               `json:"slug"`
	SDKPlatform     *metadata.SDKPlatform `json:"sdkPlatform"`
	AllowedOrigins  *[]string             `json:"allowedOrigins"`
	Environment     *string               `json:"environment"`
	Environments    *[]string             `json:"environments"`
	RetentionDays   *int16                `json:"retentionDays"`
	EventSampleRate *float64              `json:"eventSampleRate"`
	APISampleRate   *float64              `json:"apiSampleRate"`
	ErrorSampleRate *float64              `json:"errorSampleRate"`
	// IngestRateLimit is decoded as a pointer to a pointer so that omitting the
	// field and sending an explicit null stay distinguishable: omitted leaves
	// the override as it is, null clears it back to the instance default.
	IngestRateLimit   **int32                     `json:"ingestRateLimit"`
	OverLimitBehavior *metadata.OverLimitBehavior `json:"overLimitBehavior"`
	Status            *metadata.ProjectStatus     `json:"status"`
}

type projectDataPurgeRequest struct {
	Confirmation string `json:"confirmation"`
}

type projectDataPurgeResponse struct {
	ProjectID   string  `json:"projectId"`
	Status      string  `json:"status"`
	Attempts    int     `json:"attempts"`
	LastError   string  `json:"lastError"`
	DeadlineAt  string  `json:"deadlineAt,omitempty"`
	CreatedAt   string  `json:"createdAt,omitempty"`
	UpdatedAt   string  `json:"updatedAt,omitempty"`
	CompletedAt *string `json:"completedAt,omitempty"`
}

type projectResponse struct {
	ID              string               `json:"id"`
	OrganizationID  string               `json:"organizationId"`
	Name            string               `json:"name"`
	Slug            string               `json:"slug"`
	SDKPlatform     metadata.SDKPlatform `json:"sdkPlatform"`
	AllowedOrigins  []string             `json:"allowedOrigins"`
	Environment     string               `json:"environment"`
	Environments    []string             `json:"environments"`
	RetentionDays   int16                `json:"retentionDays"`
	EventSampleRate float64              `json:"eventSampleRate"`
	APISampleRate   float64              `json:"apiSampleRate"`
	ErrorSampleRate float64              `json:"errorSampleRate"`
	// Null means the project has no override and the instance default applies.
	IngestRateLimit   *int32                     `json:"ingestRateLimit"`
	OverLimitBehavior metadata.OverLimitBehavior `json:"overLimitBehavior"`
	// DefaultIngestRateLimit is the ceiling that applies when there is no
	// override. Reported alongside so the Console can show what "default"
	// currently means without hard-coding a number that lives in the ingest.
	DefaultIngestRateLimit int                       `json:"defaultIngestRateLimit"`
	Status                 metadata.ProjectStatus    `json:"status"`
	Role                   metadata.OrganizationRole `json:"role,omitempty"`
	CreatedAt              string                    `json:"createdAt"`
	UpdatedAt              string                    `json:"updatedAt"`
	DSN                    string                    `json:"dsn,omitempty"`
}

func NewProjectHandler(organizations *metadata.OrganizationRepository, projects *metadata.ProjectRepository, ingestEndpoint string, logger zerolog.Logger) *ProjectHandler {
	return &ProjectHandler{organizations: organizations, projects: projects, ingestEndpoint: ingestEndpoint, logger: logger}
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
	response.DSN = clientDSN(handler.ingestEndpoint, credential.Raw)
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

func (handler *ProjectHandler) GetDataPurge(writer http.ResponseWriter, request *http.Request) {
	principal, ok := httpx.PrincipalFromContext(request.Context())
	if !ok {
		httpx.WriteError(writer, request, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication is required.")
		return
	}
	projectID, ok := parsePathUUID(writer, request, "projectId")
	if !ok {
		return
	}
	purge, err := handler.projects.GetDataPurge(request.Context(), principal.UserID, projectID)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	writeJSON(writer, http.StatusOK, projectDataPurgeDTO(purge))
}

func (handler *ProjectHandler) CreateDataPurge(writer http.ResponseWriter, request *http.Request) {
	principal, ok := httpx.PrincipalFromContext(request.Context())
	if !ok {
		httpx.WriteError(writer, request, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication is required.")
		return
	}
	projectID, ok := parsePathUUID(writer, request, "projectId")
	if !ok {
		return
	}
	var payload projectDataPurgeRequest
	if !decodeJSONBody(writer, request, &payload) {
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
	purge, err := handler.projects.RequestDataPurge(request.Context(), principal.UserID, projectID, payload.Confirmation)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	writeJSON(writer, http.StatusAccepted, projectDataPurgeDTO(purge))
}

func projectDataPurgeDTO(purge metadata.ProjectDataPurge) projectDataPurgeResponse {
	response := projectDataPurgeResponse{
		ProjectID: purge.ProjectID.String(), Status: purge.Status, Attempts: purge.Attempts, LastError: purge.LastError,
	}
	if !purge.DeadlineAt.IsZero() {
		response.DeadlineAt = purge.DeadlineAt.Format(time.RFC3339Nano)
	}
	if !purge.CreatedAt.IsZero() {
		response.CreatedAt = purge.CreatedAt.Format(time.RFC3339Nano)
	}
	if !purge.UpdatedAt.IsZero() {
		response.UpdatedAt = purge.UpdatedAt.Format(time.RFC3339Nano)
	}
	if purge.CompletedAt != nil {
		value := purge.CompletedAt.Format(time.RFC3339Nano)
		response.CompletedAt = &value
	}
	return response
}

func validateCreateProject(payload createProjectRequest, organizationID uuid.UUID) (metadata.CreateProjectInput, bool) {
	payload.Name = strings.TrimSpace(payload.Name)
	payload.Slug = strings.TrimSpace(payload.Slug)
	if payload.Slug == "" && validName(payload.Name) {
		payload.Slug = generatedProjectSlug(payload.Name)
	}
	payload.Environment = strings.TrimSpace(payload.Environment)
	if payload.SDKPlatform == "" {
		payload.SDKPlatform = metadata.SDKPlatformJavaScript
	}
	if payload.Environment == "" {
		payload.Environment = "production"
	}
	// Projects accept every fixed environment unless a caller narrows the list.
	environments := payload.Environments
	if len(environments) == 0 {
		environments = append([]string(nil), metadata.FixedEnvironments...)
	}
	environments, environmentsOK := normalizeEnvironments(environments)
	environments = ensureEnvironment(environments, payload.Environment)
	origins, ok := normalizeOrigins(payload.AllowedOrigins)
	if !validName(payload.Name) || !validSlug(payload.Slug) || !validSDKPlatform(payload.SDKPlatform) || !validProjectEnvironment(payload.Environment) ||
		!environmentsOK || len(environments) > maxProjectEnvironments || !ok {
		return metadata.CreateProjectInput{}, false
	}
	retentionDays, eventSampleRate, apiSampleRate, errorSampleRate := int16(14), 1.0, 0.2, 1.0
	if payload.RetentionDays != nil {
		retentionDays = *payload.RetentionDays
	}
	if payload.EventSampleRate != nil {
		eventSampleRate = *payload.EventSampleRate
	}
	if payload.APISampleRate != nil {
		apiSampleRate = *payload.APISampleRate
	}
	if payload.ErrorSampleRate != nil {
		errorSampleRate = *payload.ErrorSampleRate
	}
	if !validRetention(retentionDays) || !validSampleRate(eventSampleRate) || !validSampleRate(apiSampleRate) ||
		!validSampleRate(errorSampleRate) {
		return metadata.CreateProjectInput{}, false
	}
	return metadata.CreateProjectInput{
		OrganizationID: organizationID, Name: payload.Name, Slug: payload.Slug, SDKPlatform: payload.SDKPlatform, AllowedOrigins: origins,
		Environment: payload.Environment, Environments: environments, RetentionDays: retentionDays, EventSampleRate: eventSampleRate,
		APISampleRate: apiSampleRate, ErrorSampleRate: errorSampleRate,
	}, true
}

func validateUpdateProject(payload updateProjectRequest) (metadata.UpdateProjectInput, bool) {
	if payload.Name == nil && payload.Slug == nil && payload.SDKPlatform == nil && payload.AllowedOrigins == nil && payload.Environment == nil && payload.Environments == nil &&
		payload.RetentionDays == nil && payload.EventSampleRate == nil && payload.APISampleRate == nil &&
		payload.ErrorSampleRate == nil && payload.Status == nil {
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
	if payload.SDKPlatform != nil && !validSDKPlatform(*payload.SDKPlatform) {
		return metadata.UpdateProjectInput{}, false
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
		if !validProjectEnvironment(trimmed) {
			return metadata.UpdateProjectInput{}, false
		}
	}
	if payload.Environments != nil {
		environments, ok := normalizeEnvironments(*payload.Environments)
		if !ok {
			return metadata.UpdateProjectInput{}, false
		}
		if payload.Environment != nil {
			environments = ensureEnvironment(environments, *payload.Environment)
		}
		if len(environments) > maxProjectEnvironments {
			return metadata.UpdateProjectInput{}, false
		}
		payload.Environments = &environments
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
	if payload.ErrorSampleRate != nil && !validSampleRate(*payload.ErrorSampleRate) {
		return metadata.UpdateProjectInput{}, false
	}
	if payload.IngestRateLimit != nil && *payload.IngestRateLimit != nil &&
		!validIngestRateLimit(**payload.IngestRateLimit) {
		return metadata.UpdateProjectInput{}, false
	}
	if payload.OverLimitBehavior != nil && *payload.OverLimitBehavior != metadata.OverLimitReject &&
		*payload.OverLimitBehavior != metadata.OverLimitSample {
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

func normalizeEnvironments(values []string) ([]string, bool) {
	if len(values) == 0 || len(values) > maxProjectEnvironments {
		return nil, false
	}
	result := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if !validProjectEnvironment(value) {
			return nil, false
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result, true
}

func ensureEnvironment(values []string, environment string) []string {
	result := make([]string, 0, len(values)+1)
	result = append(result, environment)
	for _, value := range values {
		if value != environment {
			result = append(result, value)
		}
	}
	return result
}

func validRetention(value int16) bool {
	return value >= 1 && value <= 90
}

// validIngestRateLimit bounds the override to what the column accepts. The
// floor is 1 rather than 0 because a project that wants no traffic disables
// itself; a limit of zero would look like a quota and behave like an outage.
func validIngestRateLimit(value int32) bool {
	return value >= 1 && value <= 1_000_000
}

func validSampleRate(value float64) bool {
	return value >= 0 && value <= 1 && !math.IsNaN(value) && !math.IsInf(value, 0)
}

func validSDKPlatform(value metadata.SDKPlatform) bool {
	_, ok := validSDKPlatforms[value]
	return ok
}

func projectDTO(project metadata.Project, role metadata.OrganizationRole) projectResponse {
	return projectResponse{
		ID: project.ID.String(), OrganizationID: project.OrganizationID.String(), Name: project.Name, Slug: project.Slug, SDKPlatform: project.SDKPlatform,
		AllowedOrigins: project.AllowedOrigins, Environment: project.Environment, Environments: project.Environments, RetentionDays: project.RetentionDays,
		EventSampleRate: project.EventSampleRate, APISampleRate: project.APISampleRate,
		ErrorSampleRate: project.ErrorSampleRate, IngestRateLimit: project.IngestRateLimit,
		OverLimitBehavior: project.OverLimitBehavior, DefaultIngestRateLimit: ingest.DefaultProjectRequestsPerSecond,
		Status: project.Status,
		Role:   role, CreatedAt: project.CreatedAt.UTC().Format(timeFormat), UpdatedAt: project.UpdatedAt.UTC().Format(timeFormat),
	}
}

// generatedProjectSlug derives the internal identifier the Console no longer asks for:
// the ASCII letters and digits of the name, then a random suffix so two projects with the
// same (or a non-Latin) name never collide on the per-organization unique constraint.
func generatedProjectSlug(name string) string {
	var builder strings.Builder
	dash := false
	for _, character := range strings.ToLower(name) {
		switch {
		case character >= 'a' && character <= 'z', character >= '0' && character <= '9':
			builder.WriteRune(character)
			dash = false
		case builder.Len() > 0 && !dash:
			builder.WriteByte('-')
			dash = true
		}
	}
	base := strings.Trim(builder.String(), "-")
	if len(base) > 48 {
		base = strings.Trim(base[:48], "-")
	}
	if base == "" {
		base = "project"
	}
	return base + "-" + strings.ReplaceAll(uuid.NewString(), "-", "")[:8]
}
