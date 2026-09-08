package handlers

import (
	"errors"
	"net/http"
	"strings"

	"github.com/rs/zerolog"

	"openrum/internal/auth"
	"openrum/internal/filter"
	"openrum/internal/httpx"
	"openrum/internal/metadata"
)

type ProjectFilterHandler struct {
	projects *metadata.ProjectRepository
	filters  *metadata.ProjectFilterRepository
	logger   zerolog.Logger
}

func NewProjectFilterHandler(
	projects *metadata.ProjectRepository,
	filters *metadata.ProjectFilterRepository,
	logger zerolog.Logger,
) *ProjectFilterHandler {
	return &ProjectFilterHandler{projects: projects, filters: filters, logger: logger}
}

type filterRuleDTO struct {
	ID      string `json:"id"`
	Kind    string `json:"kind"`
	Pattern string `json:"pattern"`
	Mode    string `json:"mode"`
	Note    string `json:"note,omitempty"`
}

type inboundFiltersDTO struct {
	Builtin map[string]string `json:"builtin"`
	Rules   []filterRuleDTO   `json:"rules"`
}

// Get returns the project's inbound filter settings. Any member may read them,
// because knowing why an event is missing is part of reading the data.
func (handler *ProjectFilterHandler) Get(writer http.ResponseWriter, request *http.Request) {
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
	settings, err := handler.filters.Get(request.Context(), projectID)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	writeJSON(writer, http.StatusOK, filtersDTO(settings))
}

// Put replaces the settings. The whole document is replaced rather than
// patched, because a rule list edited by two people at once would otherwise
// merge into something neither of them wrote.
func (handler *ProjectFilterHandler) Put(writer http.ResponseWriter, request *http.Request) {
	principal, ok := httpx.PrincipalFromContext(request.Context())
	if !ok {
		httpx.WriteError(writer, request, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication is required.")
		return
	}
	projectID, ok := parsePathUUID(writer, request, "projectId")
	if !ok {
		return
	}
	var payload inboundFiltersDTO
	if !decodeJSONBody(writer, request, &payload) {
		return
	}
	settings := filterSettingsFrom(payload)
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
	stored, err := handler.filters.Update(request.Context(), principal.UserID, projectID, settings)
	if err != nil {
		// A validation failure raised by the repository is the caller's fault,
		// not a server error, so it must not surface as a 500.
		if errors.Is(err, filter.ErrInvalidSettings) {
			httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
			return
		}
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	writeJSON(writer, http.StatusOK, filtersDTO(stored))
}

func filtersDTO(settings filter.Settings) inboundFiltersDTO {
	// Every category is reported, including the ones left off, so the Console
	// can render the full list without knowing the catalogue itself.
	builtin := make(map[string]string, len(filter.BuiltinReasons()))
	for _, reason := range filter.BuiltinReasons() {
		builtin[string(reason)] = string(settings.ModeOf(reason))
	}
	rules := make([]filterRuleDTO, 0, len(settings.Rules))
	for _, rule := range settings.Rules {
		rules = append(rules, filterRuleDTO{
			ID: rule.ID, Kind: string(rule.Kind), Pattern: rule.Pattern,
			Mode: string(rule.Mode), Note: rule.Note,
		})
	}
	return inboundFiltersDTO{Builtin: builtin, Rules: rules}
}

func filterSettingsFrom(payload inboundFiltersDTO) filter.Settings {
	settings := filter.Settings{}
	for reason, mode := range payload.Builtin {
		// An explicit off is the same as absent, and dropping it here keeps the
		// stored document from accumulating defaults.
		if mode == "" || mode == string(filter.ModeOff) {
			continue
		}
		if settings.Builtin == nil {
			settings.Builtin = map[filter.Reason]filter.Mode{}
		}
		settings.Builtin[filter.Reason(reason)] = filter.Mode(mode)
	}
	for _, rule := range payload.Rules {
		settings.Rules = append(settings.Rules, filter.Rule{
			ID:      strings.TrimSpace(rule.ID),
			Kind:    filter.Kind(rule.Kind),
			Pattern: strings.TrimSpace(rule.Pattern),
			Mode:    filter.Mode(rule.Mode),
			Note:    strings.TrimSpace(rule.Note),
		})
	}
	return settings
}
