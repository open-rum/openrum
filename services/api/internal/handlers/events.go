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

	"openrum/internal/httpx"
	"openrum/internal/metadata"
	"openrum/internal/query"
)

type eventQueries interface {
	Get(context.Context, uuid.UUID) (query.EventDetail, error)
}

type sessionQueries interface {
	List(context.Context, query.SessionFilters) (query.SessionPage, error)
	ListSession(context.Context, query.SessionTimelineFilters) (query.SessionTimeline, error)
}

type SessionHandler struct {
	projects overviewProjects
	events   sessionQueries
	logger   zerolog.Logger
}

func NewSessionHandler(projects overviewProjects, events sessionQueries, logger zerolog.Logger) *SessionHandler {
	return &SessionHandler{projects: projects, events: events, logger: logger}
}

func (handler *SessionHandler) List(writer http.ResponseWriter, request *http.Request) {
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
	filters, err := parseSessionFilters(request, projectID)
	if err != nil {
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "A valid UTC range and bounded session filters are required.")
		return
	}
	ctx, cancel := context.WithTimeout(request.Context(), 10*time.Second)
	defer cancel()
	result, err := handler.events.List(ctx, filters)
	if err != nil {
		if errors.Is(err, query.ErrInvalidSessionFilters) {
			httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "Session filters are invalid.")
			return
		}
		handler.logger.Error().Err(err).Str("project_id", projectID.String()).Msg("session list query failed")
		httpx.WriteError(writer, request, http.StatusServiceUnavailable, "QUERY_UNAVAILABLE", "Sessions are temporarily unavailable.")
		return
	}
	writeJSON(writer, http.StatusOK, result)
}

func (handler *SessionHandler) Get(writer http.ResponseWriter, request *http.Request) {
	principal, ok := httpx.PrincipalFromContext(request.Context())
	if !ok {
		httpx.WriteError(writer, request, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication is required.")
		return
	}
	projectID, ok := parsePathUUID(writer, request, "projectId")
	if !ok {
		return
	}
	sessionID, ok := parsePathUUID(writer, request, "sessionId")
	if !ok {
		return
	}
	if _, err := handler.projects.GetForUser(request.Context(), principal.UserID, projectID); err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	from, err := time.Parse(time.RFC3339Nano, request.URL.Query().Get("from"))
	if err != nil {
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "A valid session timeline range is required.")
		return
	}
	to, err := time.Parse(time.RFC3339Nano, request.URL.Query().Get("to"))
	if err != nil || !from.Before(to) || to.Sub(from) > 24*time.Hour {
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "A valid session timeline range is required.")
		return
	}
	limit := 100
	if value := request.URL.Query().Get("limit"); value != "" {
		limit, err = strconv.Atoi(value)
		if err != nil {
			httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "The session timeline limit is invalid.")
			return
		}
	}
	kinds := make([]string, 0)
	for _, value := range request.URL.Query()["type"] {
		for _, kind := range strings.Split(value, ",") {
			if kind = strings.TrimSpace(kind); kind != "" {
				kinds = append(kinds, kind)
			}
		}
	}
	ctx, cancel := context.WithTimeout(request.Context(), 10*time.Second)
	defer cancel()
	result, err := handler.events.ListSession(ctx, query.SessionTimelineFilters{
		ProjectID: projectID, SessionID: sessionID, From: from, To: to,
		Cursor: request.URL.Query().Get("cursor"), Kinds: kinds, Limit: limit,
	})
	if err != nil {
		if errors.Is(err, query.ErrInvalidSessionTimeline) {
			httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "The session timeline range is invalid.")
			return
		}
		if errors.Is(err, query.ErrSessionNotFound) {
			httpx.WriteError(writer, request, http.StatusNotFound, "SESSION_NOT_FOUND", "Session was not found or its data has expired.")
			return
		}
		handler.logger.Error().Err(err).Str("project_id", projectID.String()).Str("session_id", sessionID.String()).Msg("session timeline query failed")
		httpx.WriteError(writer, request, http.StatusServiceUnavailable, "QUERY_UNAVAILABLE", "Session activity is temporarily unavailable.")
		return
	}
	writeJSON(writer, http.StatusOK, result)
}

func parseSessionFilters(request *http.Request, projectID uuid.UUID) (query.SessionFilters, error) {
	values := request.URL.Query()
	from, err := time.Parse(time.RFC3339Nano, values.Get("from"))
	if err != nil {
		return query.SessionFilters{}, err
	}
	to, err := time.Parse(time.RFC3339Nano, values.Get("to"))
	if err != nil {
		return query.SessionFilters{}, err
	}
	parseInteger := func(name string, fallback int) (int, error) {
		if values.Get(name) == "" {
			return fallback, nil
		}
		return strconv.Atoi(values.Get(name))
	}
	limit, err := parseInteger("limit", 50)
	if err != nil {
		return query.SessionFilters{}, err
	}
	page, err := parseInteger("page", 1)
	if err != nil {
		return query.SessionFilters{}, err
	}
	minimumEvents, err := parseInteger("minimumEvents", 0)
	if err != nil {
		return query.SessionFilters{}, err
	}
	minimumDuration, err := parseInteger("minimumDuration", 0)
	if err != nil {
		return query.SessionFilters{}, err
	}
	return query.NormalizeSessionFilters(query.SessionFilters{
		ProjectID: projectID, From: from, To: to, Environment: values.Get("environment"), Release: values.Get("release"),
		Browser: values.Get("browser"), DeviceType: values.Get("deviceType"), Country: values.Get("country"),
		Route: values.Get("route"), Search: values.Get("search"), Signal: values.Get("signal"), Sort: values.Get("sort"),
		MinimumEvents: minimumEvents, MinimumDuration: minimumDuration, Limit: limit, Page: page,
	})
}

type EventHandler struct {
	projects overviewProjects
	events   eventQueries
	logger   zerolog.Logger
}

func NewEventHandler(projects overviewProjects, events eventQueries, logger zerolog.Logger) *EventHandler {
	return &EventHandler{projects: projects, events: events, logger: logger}
}

func (handler *EventHandler) Get(writer http.ResponseWriter, request *http.Request) {
	principal, ok := httpx.PrincipalFromContext(request.Context())
	if !ok {
		httpx.WriteError(writer, request, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication is required.")
		return
	}
	eventID, ok := parsePathUUID(writer, request, "eventId")
	if !ok {
		return
	}
	event, err := handler.events.Get(request.Context(), eventID)
	if errors.Is(err, query.ErrEventNotFound) {
		httpx.WriteError(writer, request, http.StatusNotFound, "NOT_FOUND", "Event was not found.")
		return
	}
	if err != nil {
		handler.logger.Error().Err(err).Str("event_id", eventID.String()).Msg("event query failed")
		httpx.WriteError(writer, request, http.StatusServiceUnavailable, "QUERY_UNAVAILABLE", "Event data is temporarily unavailable.")
		return
	}
	if _, err := handler.projects.GetForUser(request.Context(), principal.UserID, event.ProjectID); err != nil {
		if errors.Is(err, metadata.ErrForbidden) || errors.Is(err, metadata.ErrNotFound) {
			httpx.WriteError(writer, request, http.StatusNotFound, "NOT_FOUND", "Event was not found.")
			return
		}
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	writeJSON(writer, http.StatusOK, event)
}
