package handlers

import (
	"errors"
	"net/http"

	"github.com/rs/zerolog"

	"openrum/internal/auth"
	"openrum/internal/capture"
	"openrum/internal/httpx"
	"openrum/internal/metadata"
	"openrum/internal/privacy"
)

// ProjectCaptureHandler serves the rules that opt an API in to header capture.
type ProjectCaptureHandler struct {
	projects *metadata.ProjectRepository
	rules    *metadata.ProjectCaptureRepository
	logger   zerolog.Logger
}

func NewProjectCaptureHandler(
	projects *metadata.ProjectRepository,
	rules *metadata.ProjectCaptureRepository,
	logger zerolog.Logger,
) *ProjectCaptureHandler {
	return &ProjectCaptureHandler{projects: projects, rules: rules, logger: logger}
}

type captureRuleDTO struct {
	ID              string   `json:"id"`
	Method          string   `json:"method"`
	Pattern         string   `json:"pattern"`
	RequestHeaders  []string `json:"requestHeaders"`
	ResponseHeaders []string `json:"responseHeaders"`
	RequestBody     bool     `json:"requestBody"`
	ResponseBody    bool     `json:"responseBody"`
	Note            string   `json:"note,omitempty"`
}

type apiCaptureDTO struct {
	Rules []captureRuleDTO `json:"rules"`
	// Limits are served rather than hard-coded in the Console, so the form and
	// the server cannot disagree about what is allowed.
	RetentionDays int `json:"retentionDays"`
	MaxRules      int `json:"maxRules"`
	MaxHeaders    int `json:"maxHeaders"`
}

// Get returns the rules. Any member may read them: whether a header exists in
// the data is part of reading the data, and the rules name no value.
func (handler *ProjectCaptureHandler) Get(writer http.ResponseWriter, request *http.Request) {
	principal, ok := httpx.PrincipalFromContext(request.Context())
	if !ok {
		httpx.WriteError(writer, request, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication is required.")
		return
	}
	projectID, ok := parsePathUUID(writer, request, "projectId")
	if !ok {
		return
	}
	if _, err := handler.projects.GetForUser(request.Context(), principal.UserID, projectID); err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	settings, err := handler.rules.Get(request.Context(), projectID)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	writeJSON(writer, http.StatusOK, captureDTO(settings))
}

// Put replaces the whole rule list, for the reason the filter settings do: a
// list edited by two people at once would otherwise merge into something
// neither wrote. Owners and Admins only.
func (handler *ProjectCaptureHandler) Put(writer http.ResponseWriter, request *http.Request) {
	principal, ok := httpx.PrincipalFromContext(request.Context())
	if !ok {
		httpx.WriteError(writer, request, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication is required.")
		return
	}
	projectID, ok := parsePathUUID(writer, request, "projectId")
	if !ok {
		return
	}
	var payload apiCaptureDTO
	if !decodeJSONBody(writer, request, &payload) {
		return
	}
	settings := captureSettingsFrom(payload).Normalize()
	if err := settings.Validate(); err != nil {
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
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
	stored, err := handler.rules.Update(request.Context(), principal.UserID, projectID, settings)
	if err != nil {
		if errors.Is(err, capture.ErrInvalidSettings) {
			httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
			return
		}
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	writeJSON(writer, http.StatusOK, captureDTO(stored))
}

func captureDTO(settings capture.Settings) apiCaptureDTO {
	rules := make([]captureRuleDTO, 0, len(settings.Rules))
	for _, rule := range settings.Rules {
		rules = append(rules, captureRuleDTO{
			ID: rule.ID, Method: rule.Method, Pattern: rule.Pattern, Note: rule.Note,
			RequestHeaders:  nonNil(rule.RequestHeaders),
			ResponseHeaders: nonNil(rule.ResponseHeaders),
			RequestBody:     rule.RequestBody, ResponseBody: rule.ResponseBody,
		})
	}
	return apiCaptureDTO{
		Rules: rules, RetentionDays: capture.RetentionDays, MaxRules: capture.MaxRules, MaxHeaders: privacy.MaxHeaders,
	}
}

func captureSettingsFrom(payload apiCaptureDTO) capture.Settings {
	settings := capture.Settings{}
	for _, rule := range payload.Rules {
		settings.Rules = append(settings.Rules, capture.Rule{
			ID: rule.ID, Method: rule.Method, Pattern: rule.Pattern, Note: rule.Note,
			RequestHeaders: rule.RequestHeaders, ResponseHeaders: rule.ResponseHeaders,
			RequestBody: rule.RequestBody, ResponseBody: rule.ResponseBody,
		})
	}
	return settings
}

func nonNil(values []string) []string {
	if values == nil {
		return []string{}
	}
	return values
}
