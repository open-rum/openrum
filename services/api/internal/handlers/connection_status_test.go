package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"openrum/internal/auth"
	"openrum/internal/httpx"
	"openrum/internal/ingest"
	"openrum/internal/metadata"
)

type fakeConnectionKeys struct {
	keys []metadata.ProjectKey
	err  error
}

func (repository fakeConnectionKeys) ListForUser(context.Context, uuid.UUID, uuid.UUID) ([]metadata.ProjectKey, metadata.OrganizationRole, error) {
	return repository.keys, metadata.RoleViewer, repository.err
}

type fakeConnectionReader struct {
	status ingest.ConnectionStatus
	err    error
}

type connectionFixtureAuthenticator struct {
	principal auth.Principal
}

func (authenticator connectionFixtureAuthenticator) Authenticate(context.Context, string) (auth.Principal, error) {
	return authenticator.principal, nil
}

func (reader fakeConnectionReader) GetConnectionStatus(context.Context, uuid.UUID) (ingest.ConnectionStatus, error) {
	return reader.status, reader.err
}

func TestConnectionStatusHandlerReturnsAuthorizedPipelineState(t *testing.T) {
	userID, projectID := uuid.New(), uuid.New()
	seen := time.Date(2026, 9, 2, 10, 0, 0, 123_000_000, time.UTC)
	received, queryable, rejected := seen.Add(time.Second), seen.Add(2*time.Second), seen.Add(3*time.Second)
	reason := ingest.RejectOriginRejected
	revokedAt := seen.Add(-time.Hour)
	handler := NewConnectionStatusHandler(fakeConnectionKeys{keys: []metadata.ProjectKey{
		{ID: uuid.New(), ProjectID: projectID, RevokedAt: &revokedAt},
		{ID: uuid.New(), ProjectID: projectID},
	}}, fakeConnectionReader{status: ingest.ConnectionStatus{
		LastSDKSeenAt: &seen, LastEventReceivedAt: &received, LastEventQueryableAt: &queryable,
		LastRejectReason: &reason, LastRejectAt: &rejected,
	}}, zerolog.Nop())
	router := connectionStatusTestRouter(handler, userID)
	request := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/projects/"+projectID.String()+"/connection-status", nil)
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "valid"})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	var payload connectionStatusResponse
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if !payload.KeyConfigured || payload.LastSDKSeenAt == nil || *payload.LastSDKSeenAt != seen.Format(timeFormat) ||
		payload.LastEventReceivedAt == nil || *payload.LastEventReceivedAt != received.Format(timeFormat) ||
		payload.LastEventQueryableAt == nil || *payload.LastEventQueryableAt != queryable.Format(timeFormat) ||
		payload.LastRejectReason == nil || *payload.LastRejectReason != string(reason) ||
		payload.LastRejectAt == nil || *payload.LastRejectAt != rejected.Format(timeFormat) {
		t.Fatalf("payload=%+v", payload)
	}
}

func TestConnectionStatusHandlerHidesStateWithoutMembership(t *testing.T) {
	userID, projectID := uuid.New(), uuid.New()
	handler := NewConnectionStatusHandler(fakeConnectionKeys{err: metadata.ErrNotFound}, fakeConnectionReader{
		err: errors.New("status reader must not be called"),
	}, zerolog.Nop())
	router := connectionStatusTestRouter(handler, userID)
	request := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/projects/"+projectID.String()+"/connection-status", nil)
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "valid"})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusNotFound {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}

func connectionStatusTestRouter(handler *ConnectionStatusHandler, userID uuid.UUID) http.Handler {
	router := httpx.NewRouter(zerolog.Nop())
	authenticator := connectionFixtureAuthenticator{principal: auth.Principal{UserID: userID}}
	router.Handle("GET /api/v1/projects/{projectId}/connection-status", httpx.RequireSession(authenticator)(http.HandlerFunc(handler.Get)))
	return router
}
