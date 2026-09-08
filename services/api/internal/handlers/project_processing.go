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
	"openrum/internal/processing"
)

// ProjectProcessingHandler serves the rules the consumer applies after
// normalization: URL templates and project-added redaction.
type ProjectProcessingHandler struct {
	projects   *metadata.ProjectRepository
	processing *metadata.ProjectProcessingRepository
	logger     zerolog.Logger
}

func NewProjectProcessingHandler(
	projects *metadata.ProjectRepository,
	rules *metadata.ProjectProcessingRepository,
	logger zerolog.Logger,
) *ProjectProcessingHandler {
	return &ProjectProcessingHandler{projects: projects, processing: rules, logger: logger}
}

type urlRuleDTO struct {
	ID      string `json:"id"`
	Target  string `json:"target"`
	Pattern string `json:"pattern"`
	Note    string `json:"note,omitempty"`
}

type urlRulesDTO struct {
	Rules []urlRuleDTO `json:"rules"`
}

type scrubPatternDTO struct {
	ID         string `json:"id"`
	Expression string `json:"expression"`
	Note       string `json:"note,omitempty"`
}

type scrubRulesDTO struct {
	Patterns      []scrubPatternDTO `json:"patterns"`
	SensitiveKeys []string          `json:"sensitiveKeys"`
}

// GetURLRules returns the project's path templates. Any member may read them,
// because knowing why two addresses share a row is part of reading the data.
func (handler *ProjectProcessingHandler) GetURLRules(writer http.ResponseWriter, request *http.Request) {
	projectID, ok := handler.readable(writer, request)
	if !ok {
		return
	}
	rules, err := handler.processing.GetURLRules(request.Context(), projectID)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	writeJSON(writer, http.StatusOK, urlRulesFrom(rules))
}

// PutURLRules replaces the path templates. The whole list is replaced rather
// than patched, because order is precedence: a merge of two concurrent edits
// would produce an order neither author chose.
func (handler *ProjectProcessingHandler) PutURLRules(writer http.ResponseWriter, request *http.Request) {
	var payload urlRulesDTO
	projectID, ok := handler.writable(writer, request, &payload)
	if !ok {
		return
	}
	rules := processing.URLRules{}
	for _, rule := range payload.Rules {
		rules.Rules = append(rules.Rules, processing.Rule{
			ID:      strings.TrimSpace(rule.ID),
			Target:  processing.Target(rule.Target),
			Pattern: strings.TrimSpace(rule.Pattern),
			Note:    strings.TrimSpace(rule.Note),
		})
	}
	if err := rules.Validate(); err != nil {
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
		return
	}
	stored, err := handler.processing.UpdateURLRules(request.Context(), principalID(request), projectID, rules)
	if err != nil {
		handler.writeRuleError(writer, request, err, processing.ErrInvalidURLRules)
		return
	}
	writeJSON(writer, http.StatusOK, urlRulesFrom(stored))
}

// GetScrubRules returns the project's added redaction rules.
func (handler *ProjectProcessingHandler) GetScrubRules(writer http.ResponseWriter, request *http.Request) {
	projectID, ok := handler.readable(writer, request)
	if !ok {
		return
	}
	rules, err := handler.processing.GetScrubRules(request.Context(), projectID)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	writeJSON(writer, http.StatusOK, scrubRulesFrom(rules))
}

// PutScrubRules replaces the added redaction rules.
func (handler *ProjectProcessingHandler) PutScrubRules(writer http.ResponseWriter, request *http.Request) {
	var payload scrubRulesDTO
	projectID, ok := handler.writable(writer, request, &payload)
	if !ok {
		return
	}
	rules := processing.ScrubRules{}
	for _, pattern := range payload.Patterns {
		rules.Patterns = append(rules.Patterns, processing.ScrubPattern{
			ID:         strings.TrimSpace(pattern.ID),
			Expression: strings.TrimSpace(pattern.Expression),
			Note:       strings.TrimSpace(pattern.Note),
		})
	}
	for _, key := range payload.SensitiveKeys {
		rules.SensitiveKeys = append(rules.SensitiveKeys, strings.TrimSpace(key))
	}
	if err := rules.Validate(); err != nil {
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
		return
	}
	stored, err := handler.processing.UpdateScrubRules(request.Context(), principalID(request), projectID, rules)
	if err != nil {
		handler.writeRuleError(writer, request, err, processing.ErrInvalidScrubRules)
		return
	}
	writeJSON(writer, http.StatusOK, scrubRulesFrom(stored))
}

// readable resolves the project and checks that the caller can see it.
func (handler *ProjectProcessingHandler) readable(
	writer http.ResponseWriter,
	request *http.Request,
) (uuid.UUID, bool) {
	principal, ok := httpx.PrincipalFromContext(request.Context())
	if !ok {
		httpx.WriteError(writer, request, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication is required.")
		return uuid.Nil, false
	}
	projectID, ok := parsePathUUID(writer, request, "projectId")
	if !ok {
		return uuid.Nil, false
	}
	if _, err := handler.projects.GetForUser(request.Context(), principal.UserID, projectID); err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return uuid.Nil, false
	}
	return projectID, true
}

// writable additionally decodes the body and checks that the caller may change
// project settings. The body is decoded before the role is checked so a
// malformed request is answered as malformed rather than as forbidden.
func (handler *ProjectProcessingHandler) writable(
	writer http.ResponseWriter,
	request *http.Request,
	payload any,
) (uuid.UUID, bool) {
	principal, ok := httpx.PrincipalFromContext(request.Context())
	if !ok {
		httpx.WriteError(writer, request, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication is required.")
		return uuid.Nil, false
	}
	projectID, ok := parsePathUUID(writer, request, "projectId")
	if !ok {
		return uuid.Nil, false
	}
	if !decodeJSONBody(writer, request, payload) {
		return uuid.Nil, false
	}
	access, err := handler.projects.GetForUser(request.Context(), principal.UserID, projectID)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return uuid.Nil, false
	}
	if err := auth.Authorize(access.Role, auth.ActionManageKeys); err != nil {
		writeControlPlaneError(writer, request, handler.logger, errors.Join(metadata.ErrForbidden, err))
		return uuid.Nil, false
	}
	return projectID, true
}

// writeRuleError keeps a validation failure raised by the repository a 400. It
// is the caller's fault, not a server error, so it must not surface as a 500.
func (handler *ProjectProcessingHandler) writeRuleError(
	writer http.ResponseWriter,
	request *http.Request,
	err, invalid error,
) {
	if errors.Is(err, invalid) {
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
		return
	}
	writeControlPlaneError(writer, request, handler.logger, err)
}

func principalID(request *http.Request) uuid.UUID {
	principal, _ := httpx.PrincipalFromContext(request.Context())
	return principal.UserID
}

func urlRulesFrom(rules processing.URLRules) urlRulesDTO {
	result := urlRulesDTO{Rules: make([]urlRuleDTO, 0, len(rules.Rules))}
	for _, rule := range rules.Rules {
		result.Rules = append(result.Rules, urlRuleDTO{
			ID: rule.ID, Target: string(rule.Target), Pattern: rule.Pattern, Note: rule.Note,
		})
	}
	return result
}

func scrubRulesFrom(rules processing.ScrubRules) scrubRulesDTO {
	result := scrubRulesDTO{
		Patterns:      make([]scrubPatternDTO, 0, len(rules.Patterns)),
		SensitiveKeys: make([]string, 0, len(rules.SensitiveKeys)),
	}
	for _, pattern := range rules.Patterns {
		result.Patterns = append(result.Patterns, scrubPatternDTO{
			ID: pattern.ID, Expression: pattern.Expression, Note: pattern.Note,
		})
	}
	result.SensitiveKeys = append(result.SensitiveKeys, rules.SensitiveKeys...)
	return result
}
