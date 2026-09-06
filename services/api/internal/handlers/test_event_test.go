package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"openrum/internal/auth"
	"openrum/internal/httpx"
	"openrum/internal/ingest"
	"openrum/internal/metadata"
)

type fakeTestEventProjects struct {
	access metadata.ProjectAccess
	err    error
}

func (projects fakeTestEventProjects) GetForUser(context.Context, uuid.UUID, uuid.UUID) (metadata.ProjectAccess, error) {
	return projects.access, projects.err
}

type fakeTestEventPublisher struct {
	queued *ingest.QueuedEnvelope
	err    error
}

func (publisher *fakeTestEventPublisher) Publish(_ context.Context, queued ingest.QueuedEnvelope) error {
	publisher.queued = &queued
	return publisher.err
}

type fakeTestEventConnection struct {
	received   []time.Time
	rejections []ingest.RejectReason
}

func (*fakeTestEventConnection) MarkSDKSeen(context.Context, uuid.UUID, time.Time) error { return nil }
func (connection *fakeTestEventConnection) MarkEventReceived(_ context.Context, _ uuid.UUID, at time.Time) error {
	connection.received = append(connection.received, at)
	return nil
}
func (*fakeTestEventConnection) MarkEventQueryable(context.Context, uuid.UUID, time.Time) error {
	return nil
}

func (connection *fakeTestEventConnection) MarkRejected(_ context.Context, _ uuid.UUID, _ time.Time, reason ingest.RejectReason) error {
	connection.rejections = append(connection.rejections, reason)
	return nil
}

type testEventAuthenticator struct{ principal auth.Principal }

func (authenticator testEventAuthenticator) Authenticate(context.Context, string) (auth.Principal, error) {
	return authenticator.principal, nil
}

func TestTestEventHandlerPublishesTrustedSyntheticEnvelope(t *testing.T) {
	userID, projectID, organizationID := uuid.New(), uuid.New(), uuid.New()
	acceptedAt := time.Date(2026, 9, 2, 6, 30, 0, 123_000_000, time.UTC)
	publisher := &fakeTestEventPublisher{}
	connection := &fakeTestEventConnection{}
	handler := NewTestEventHandler(fakeTestEventProjects{access: metadata.ProjectAccess{
		Project: metadata.Project{ID: projectID, OrganizationID: organizationID, Environment: "production", Status: metadata.ProjectStatusActive},
		Role:    metadata.RoleMember,
	}}, publisher, connection, zerolog.Nop())
	handler.now = func() time.Time { return acceptedAt }
	response := performTestEventRequest(testEventRouter(handler, userID), projectID, true)
	if response.Code != http.StatusAccepted {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	if publisher.queued == nil || !publisher.queued.Synthetic || publisher.queued.ProjectID != projectID ||
		publisher.queued.OrganizationID != organizationID || publisher.queued.QueueSchemaVersion != ingest.QueueSchemaVersion ||
		len(publisher.queued.Envelope.Events) != 1 || publisher.queued.Envelope.Events[0].SampleRate == nil ||
		*publisher.queued.Envelope.Events[0].SampleRate != 1 {
		t.Fatalf("queued=%+v", publisher.queued)
	}
	if len(connection.received) != 1 || !connection.received[0].Equal(acceptedAt) {
		t.Fatalf("received marks=%v", connection.received)
	}
	var payload testEventResponse
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Status != "accepted" || payload.EventID != publisher.queued.Envelope.Events[0].EventID || payload.AcceptedAt != acceptedAt.Format(timeFormat) {
		t.Fatalf("payload=%+v", payload)
	}
}

func TestTestEventHandlerEnforcesCSRFRoleProjectStateAndKafkaAck(t *testing.T) {
	userID, projectID := uuid.New(), uuid.New()
	tests := []struct {
		name       string
		role       metadata.OrganizationRole
		status     metadata.ProjectStatus
		projectErr error
		publishErr error
		csrf       bool
		wantStatus int
		wantCode   string
	}{
		{name: "csrf", role: metadata.RoleMember, status: metadata.ProjectStatusActive, csrf: false, wantStatus: 403, wantCode: "CSRF_FAILED"},
		{name: "viewer", role: metadata.RoleViewer, status: metadata.ProjectStatusActive, csrf: true, wantStatus: 403, wantCode: "FORBIDDEN"},
		{name: "cross project", projectErr: metadata.ErrNotFound, csrf: true, wantStatus: 404, wantCode: "NOT_FOUND"},
		{name: "disabled", role: metadata.RoleAdmin, status: metadata.ProjectStatusDisabled, csrf: true, wantStatus: 409, wantCode: "PROJECT_DISABLED"},
		{name: "Kafka unavailable", role: metadata.RoleAdmin, status: metadata.ProjectStatusActive, publishErr: errors.New("broker unavailable"), csrf: true, wantStatus: 503, wantCode: "EVENT_QUEUE_UNAVAILABLE"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			publisher := &fakeTestEventPublisher{err: test.publishErr}
			connection := &fakeTestEventConnection{}
			handler := NewTestEventHandler(fakeTestEventProjects{
				access: metadata.ProjectAccess{Project: metadata.Project{
					ID: projectID, OrganizationID: uuid.New(), Environment: "production", Status: test.status,
				}, Role: test.role}, err: test.projectErr,
			}, publisher, connection, zerolog.Nop())
			response := performTestEventRequest(testEventRouter(handler, userID), projectID, test.csrf)
			assertHandlerError(t, response, test.wantStatus, test.wantCode)
			if len(connection.received) != 0 {
				t.Fatalf("non-durable request advanced received status: %v", connection.received)
			}
			if test.publishErr != nil && response.Header().Get("Retry-After") != "1" {
				t.Fatalf("Retry-After=%q", response.Header().Get("Retry-After"))
			}
			if test.publishErr != nil && (len(connection.rejections) != 1 || connection.rejections[0] != ingest.RejectIngestUnavailable) {
				t.Fatalf("queue failure rejections=%v", connection.rejections)
			}
		})
	}
}

func testEventRouter(handler *TestEventHandler, userID uuid.UUID) http.Handler {
	router := httpx.NewRouter(zerolog.Nop())
	baseURL, _ := url.Parse("http://openrum.test")
	authenticated := httpx.RequireSession(testEventAuthenticator{principal: auth.Principal{UserID: userID}})
	csrf := httpx.RequireCSRF(baseURL)
	router.Handle("POST /api/v1/projects/{projectId}/test-event", authenticated(csrf(http.HandlerFunc(handler.Create))))
	return router
}

func performTestEventRequest(handler http.Handler, projectID uuid.UUID, withCSRF bool) *httptest.ResponseRecorder {
	request := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/v1/projects/"+projectID.String()+"/test-event", nil)
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "valid"})
	request.AddCookie(&http.Cookie{Name: auth.CSRFCookieName, Value: "csrf-token"})
	if withCSRF {
		request.Header.Set("Origin", "http://openrum.test")
		request.Header.Set(httpx.CSRFHeader, "csrf-token")
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func assertHandlerError(t *testing.T, response *httptest.ResponseRecorder, status int, code string) {
	t.Helper()
	if response.Code != status {
		t.Fatalf("status=%d want=%d body=%s", response.Code, status, response.Body.String())
	}
	var payload struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Error.Code != code {
		t.Fatalf("code=%q want=%q body=%s", payload.Error.Code, code, response.Body.String())
	}
}
