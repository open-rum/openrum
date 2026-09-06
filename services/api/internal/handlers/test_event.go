package handlers

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"openrum/internal/auth"
	"openrum/internal/event"
	"openrum/internal/httpx"
	"openrum/internal/ingest"
	"openrum/internal/metadata"
)

type testEventProjects interface {
	GetForUser(context.Context, uuid.UUID, uuid.UUID) (metadata.ProjectAccess, error)
}

type testEventPublisher interface {
	Publish(context.Context, ingest.QueuedEnvelope) error
}

type TestEventHandler struct {
	projects   testEventProjects
	publisher  testEventPublisher
	connection ingest.ConnectionStatusRecorder
	logger     zerolog.Logger
	now        func() time.Time
}

type testEventResponse struct {
	EventID    string `json:"eventId"`
	Status     string `json:"status"`
	AcceptedAt string `json:"acceptedAt"`
}

func NewTestEventHandler(projects testEventProjects, publisher testEventPublisher, connection ingest.ConnectionStatusRecorder, logger zerolog.Logger) *TestEventHandler {
	return &TestEventHandler{projects: projects, publisher: publisher, connection: connection, logger: logger, now: time.Now}
}

func (handler *TestEventHandler) Create(writer http.ResponseWriter, request *http.Request) {
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
	if err := auth.Authorize(access.Role, auth.ActionSendTestEvent); err != nil {
		writeControlPlaneError(writer, request, handler.logger, errors.Join(metadata.ErrForbidden, err))
		return
	}
	if access.Project.Status != metadata.ProjectStatusActive {
		httpx.WriteError(writer, request, http.StatusConflict, "PROJECT_DISABLED", "Enable the project before sending a test Event.")
		return
	}

	acceptedAt := handler.now().UTC().Truncate(time.Millisecond)
	envelope, err := event.NewSyntheticEnvelope(access.Project.Environment, acceptedAt)
	if err != nil {
		handler.logger.Error().Err(err).Str("project_id", projectID.String()).Msg("create synthetic Event")
		httpx.WriteError(writer, request, http.StatusInternalServerError, "INTERNAL_ERROR", "An internal error occurred.")
		return
	}
	queued := ingest.QueuedEnvelope{
		QueueSchemaVersion: ingest.QueueSchemaVersion,
		ProjectID:          projectID, OrganizationID: access.Project.OrganizationID,
		ReceivedAt: acceptedAt, Origin: "https://openrum.invalid",
		UserAgent: event.SyntheticSDKName, Synthetic: true, Envelope: envelope,
	}
	if err := handler.publisher.Publish(request.Context(), queued); err != nil {
		if handler.connection != nil {
			_ = handler.connection.MarkRejected(context.WithoutCancel(request.Context()), projectID, acceptedAt, ingest.RejectIngestUnavailable)
		}
		handler.logger.Error().Err(err).Str("project_id", projectID.String()).
			Str("request_id", httpx.RequestIDFromContext(request.Context())).Msg("publish synthetic Event")
		writer.Header().Set("Retry-After", "1")
		httpx.WriteError(writer, request, http.StatusServiceUnavailable, "EVENT_QUEUE_UNAVAILABLE", "The test Event could not be durably accepted. Retry later.")
		return
	}
	if handler.connection != nil {
		_ = handler.connection.MarkEventReceived(context.WithoutCancel(request.Context()), projectID, acceptedAt)
	}
	writeJSON(writer, http.StatusAccepted, testEventResponse{
		EventID: envelope.Events[0].EventID, Status: "accepted", AcceptedAt: acceptedAt.Format(timeFormat),
	})
}
