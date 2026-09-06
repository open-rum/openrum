package handlers

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"openrum/internal/auth"
	"openrum/internal/httpx"
	"openrum/internal/metadata"
	"openrum/internal/query"
)

type issueQueries interface {
	List(context.Context, query.IssueFilters) (query.IssuePage, error)
	Trend(context.Context, query.IssueFilters, string) ([]query.IssueTrendPoint, error)
}

type issueEvents interface {
	ListIssueEvents(context.Context, uuid.UUID, string, time.Time, time.Time, int, string) (query.EventPage, error)
}

type issueStates interface {
	MutateIssueState(context.Context, uuid.UUID, metadata.IssueState) (metadata.IssueState, error)
}

type IssueHandler struct {
	projects overviewProjects
	queries  issueQueries
	events   issueEvents
	states   issueStates
	logger   zerolog.Logger
}

func NewIssueHandler(projects overviewProjects, queries issueQueries, events issueEvents, states issueStates, logger zerolog.Logger) *IssueHandler {
	return &IssueHandler{projects: projects, queries: queries, events: events, states: states, logger: logger}
}

func (handler *IssueHandler) List(writer http.ResponseWriter, request *http.Request) {
	_, projectID, _, ok := handler.authorizeProject(writer, request, auth.ActionReadProject)
	if !ok {
		return
	}
	filters, err := parseIssueFilters(request, projectID)
	if err != nil {
		writeIssueValidationError(writer, request)
		return
	}
	result, err := handler.queries.List(request.Context(), filters)
	if err != nil {
		handler.writeQueryError(writer, request, err)
		return
	}
	writeJSON(writer, http.StatusOK, result)
}

func (handler *IssueHandler) Get(writer http.ResponseWriter, request *http.Request) {
	_, projectID, _, ok := handler.authorizeProject(writer, request, auth.ActionReadProject)
	if !ok {
		return
	}
	fingerprint, ok := parseFingerprint(writer, request)
	if !ok {
		return
	}
	filters, err := parseIssueFilters(request, projectID)
	if err != nil {
		writeIssueValidationError(writer, request)
		return
	}
	filters.Fingerprint, filters.Limit, filters.Cursor, filters.Status = fingerprint, 1, "", ""
	page, err := handler.queries.List(request.Context(), filters)
	if err != nil {
		handler.writeQueryError(writer, request, err)
		return
	}
	if len(page.Issues) == 0 {
		httpx.WriteError(writer, request, http.StatusNotFound, "NOT_FOUND", "Issue was not found.")
		return
	}
	trend, err := handler.queries.Trend(request.Context(), filters, fingerprint)
	if err != nil {
		handler.writeQueryError(writer, request, err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"issue": page.Issues[0], "trend": trend, "facets": page.Facets})
}

type patchIssueRequest struct {
	Status              *metadata.IssueStatus `json:"status"`
	AssigneeUserID      *string               `json:"assigneeUserId"`
	ResolvedInReleaseID *string               `json:"resolvedInReleaseId"`
}

func (handler *IssueHandler) Patch(writer http.ResponseWriter, request *http.Request) {
	principal, projectID, _, ok := handler.authorizeProject(writer, request, auth.ActionResolveIssue)
	if !ok {
		return
	}
	fingerprint, ok := parseFingerprint(writer, request)
	if !ok {
		return
	}
	var payload patchIssueRequest
	if !decodeJSONBody(writer, request, &payload) {
		return
	}
	if payload.Status == nil && payload.AssigneeUserID == nil && payload.ResolvedInReleaseID == nil {
		writeIssueValidationError(writer, request)
		return
	}
	filters, err := parseIssueFilters(request, projectID)
	if err != nil {
		writeIssueValidationError(writer, request)
		return
	}
	filters.Fingerprint, filters.Limit, filters.Cursor, filters.Status = fingerprint, 1, "", ""
	page, err := handler.queries.List(request.Context(), filters)
	if err != nil {
		handler.writeQueryError(writer, request, err)
		return
	}
	if len(page.Issues) == 0 {
		httpx.WriteError(writer, request, http.StatusNotFound, "NOT_FOUND", "Issue was not found.")
		return
	}
	current := page.Issues[0]
	state := metadata.IssueState{
		ProjectID: projectID, Fingerprint: fingerprint, FingerprintVersion: int16(current.FingerprintVersion),
		Status: current.Status, AssigneeUserID: current.AssigneeUserID, ResolvedInRelease: current.ResolvedInRelease,
	}
	if payload.Status != nil {
		if !validIssueStatus(*payload.Status) {
			writeIssueValidationError(writer, request)
			return
		}
		state.Status = *payload.Status
	}
	if payload.AssigneeUserID != nil {
		state.AssigneeUserID, ok = optionalUUID(*payload.AssigneeUserID)
		if !ok {
			writeIssueValidationError(writer, request)
			return
		}
	}
	if payload.ResolvedInReleaseID != nil {
		state.ResolvedInRelease, ok = optionalUUID(*payload.ResolvedInReleaseID)
		if !ok {
			writeIssueValidationError(writer, request)
			return
		}
	}
	updated, err := handler.states.MutateIssueState(request.Context(), principal.UserID, state)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	writeJSON(writer, http.StatusOK, updated)
}

func (handler *IssueHandler) Events(writer http.ResponseWriter, request *http.Request) {
	_, projectID, _, ok := handler.authorizeProject(writer, request, auth.ActionReadProject)
	if !ok {
		return
	}
	fingerprint, ok := parseFingerprint(writer, request)
	if !ok {
		return
	}
	filters, err := parseIssueFilters(request, projectID)
	if err != nil {
		writeIssueValidationError(writer, request)
		return
	}
	result, err := handler.events.ListIssueEvents(request.Context(), projectID, fingerprint, filters.From, filters.To, filters.Limit, filters.Cursor)
	if err != nil {
		handler.writeQueryError(writer, request, err)
		return
	}
	writeJSON(writer, http.StatusOK, result)
}

func (handler *IssueHandler) authorizeProject(writer http.ResponseWriter, request *http.Request, action auth.Action) (auth.Principal, uuid.UUID, metadata.ProjectAccess, bool) {
	principal, ok := httpx.PrincipalFromContext(request.Context())
	if !ok {
		httpx.WriteError(writer, request, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication is required.")
		return auth.Principal{}, uuid.Nil, metadata.ProjectAccess{}, false
	}
	projectID, ok := parsePathUUID(writer, request, "projectId")
	if !ok {
		return auth.Principal{}, uuid.Nil, metadata.ProjectAccess{}, false
	}
	access, err := handler.projects.GetForUser(request.Context(), principal.UserID, projectID)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return auth.Principal{}, uuid.Nil, metadata.ProjectAccess{}, false
	}
	if err := auth.Authorize(access.Role, action); err != nil {
		writeControlPlaneError(writer, request, handler.logger, errors.Join(metadata.ErrForbidden, err))
		return auth.Principal{}, uuid.Nil, metadata.ProjectAccess{}, false
	}
	return principal, projectID, access, true
}

func (handler *IssueHandler) writeQueryError(writer http.ResponseWriter, request *http.Request, err error) {
	if errors.Is(err, query.ErrInvalidIssueFilters) {
		writeIssueValidationError(writer, request)
		return
	}
	handler.logger.Error().Err(err).Str("request_id", httpx.RequestIDFromContext(request.Context())).Msg("issue query failed")
	httpx.WriteError(writer, request, http.StatusServiceUnavailable, "QUERY_UNAVAILABLE", "Issue data is temporarily unavailable.")
}

func parseIssueFilters(request *http.Request, projectID uuid.UUID) (query.IssueFilters, error) {
	values := request.URL.Query()
	from, err := time.Parse(time.RFC3339Nano, values.Get("from"))
	if err != nil {
		return query.IssueFilters{}, err
	}
	to, err := time.Parse(time.RFC3339Nano, values.Get("to"))
	if err != nil {
		return query.IssueFilters{}, err
	}
	limit := 25
	if raw := values.Get("limit"); raw != "" {
		limit, err = strconv.Atoi(raw)
		if err != nil {
			return query.IssueFilters{}, err
		}
	}
	filters := query.IssueFilters{
		ProjectID: projectID, From: from, To: to, Environment: values.Get("environment"), Release: values.Get("release"),
		Route: values.Get("route"), Browser: values.Get("browser"), DeviceType: values.Get("deviceType"), Country: values.Get("country"),
		Status: metadata.IssueStatus(values.Get("status")), Limit: limit, Cursor: values.Get("cursor"),
		Sort: values.Get("sort"),
	}
	_, err = query.NormalizeIssueFilters(filters)
	return filters, err
}

func parseFingerprint(writer http.ResponseWriter, request *http.Request) (string, bool) {
	value := strings.TrimSpace(request.PathValue("fingerprint"))
	if value == "" || len(value) > 128 || strings.ContainsAny(value, "\x00\r\n") {
		writeIssueValidationError(writer, request)
		return "", false
	}
	return value, true
}

func writeIssueValidationError(writer http.ResponseWriter, request *http.Request) {
	httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "A valid UTC range and bounded issue filters are required.")
}

func validIssueStatus(status metadata.IssueStatus) bool {
	return status == metadata.IssueStatusUnresolved || status == metadata.IssueStatusResolved || status == metadata.IssueStatusIgnored
}

func optionalUUID(value string) (*uuid.UUID, bool) {
	if value == "" {
		return nil, true
	}
	parsed, err := uuid.Parse(value)
	if err != nil {
		return nil, false
	}
	return &parsed, true
}
