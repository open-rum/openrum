package handlers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"openrum/internal/auth"
	"openrum/internal/httpx"
	"openrum/internal/metadata"
)

type recordingInstanceAudit struct{ entries []metadata.InstanceAuditEntry }

func (audit *recordingInstanceAudit) Record(_ context.Context, entry metadata.InstanceAuditEntry) error {
	audit.entries = append(audit.entries, entry)
	return nil
}

func (audit *recordingInstanceAudit) List(context.Context, int) ([]metadata.InstanceAuditEntry, error) {
	return audit.entries, nil
}

func TestAdminMutationAuditRecordsSuccessfulMutationWithoutBodySecrets(t *testing.T) {
	userID := uuid.New()
	audit := &recordingInstanceAudit{}
	next := http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusNoContent)
	})
	handler := httpx.RequireSession(adminAuthenticator{principals: map[string]auth.Principal{
		"session": {UserID: userID},
	}})(AdminMutationAudit(audit, zerolog.Nop())(next))
	request := httptest.NewRequest(
		http.MethodPut,
		"/api/v1/admin/object-storage/managed",
		strings.NewReader(`{"currentPassword":"password-value","secretAccessKey":"secret-value"}`),
	)
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "session"})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusNoContent || len(audit.entries) != 1 {
		t.Fatalf("status=%d entries=%d", response.Code, len(audit.entries))
	}
	entry := audit.entries[0]
	serialized := entry.Action + entry.ResourcePath + string(entry.ChangeSummary)
	if entry.ActorUserID == nil || *entry.ActorUserID != userID || entry.ResourceType != "object-storage" ||
		strings.Contains(serialized, "password-value") || strings.Contains(serialized, "secret-value") ||
		string(entry.ChangeSummary) != `{"method":"PUT"}` {
		t.Fatalf("unsafe or incomplete audit entry: %+v", entry)
	}
}

func TestAdminMutationAuditSkipsRejectedMutation(t *testing.T) {
	audit := &recordingInstanceAudit{}
	handler := AdminMutationAudit(audit, zerolog.Nop())(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		httpx.WriteError(writer, request, http.StatusUnauthorized, "REAUTHENTICATION_REQUIRED", "Re-authenticate.")
	}))
	request := httptest.NewRequest(http.MethodPatch, "/api/v1/admin/configuration", nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized || len(audit.entries) != 0 {
		t.Fatalf("status=%d entries=%d", response.Code, len(audit.entries))
	}
}
