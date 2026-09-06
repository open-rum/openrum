package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"openrum/internal/auth"
	"openrum/internal/httpx"
	"openrum/internal/metadata"
)

type fixedAdminOverviewSource struct {
	response adminOverviewResponse
}

func (source fixedAdminOverviewSource) Snapshot(context.Context) adminOverviewResponse {
	return source.response
}

func TestAdminOverviewRequiresInstanceRoleAndDoesNotExposeSecrets(t *testing.T) {
	adminID, memberID := uuid.New(), uuid.New()
	members := &fakeInstanceMembers{roles: map[uuid.UUID]metadata.InstanceRole{
		adminID: metadata.InstanceRoleAdmin,
	}}
	source := fixedAdminOverviewSource{response: adminOverviewResponse{
		Version: "v0.1.0", Environment: "test", DeploymentMode: "kubernetes",
		StartedAt:    time.Now().UTC().Format(timeFormat),
		Dependencies: []adminDependencyResponse{{ID: "postgres", Label: "PostgreSQL", Status: "healthy", Detail: "available"}},
		Pipeline:     adminPipelineResponse{Capacity: adminCapacityResponse{Status: "unknown", Detail: "unknown"}},
	}}
	router := httpx.NewRouter(zerolog.Nop())
	handler := NewAdminOverviewHandler(members, source, zerolog.Nop())
	router.Handle("GET /api/v1/admin/overview", httpx.RequireSession(adminAuthenticator{principals: map[string]auth.Principal{
		"admin": {UserID: adminID}, "member": {UserID: memberID},
	}})(http.HandlerFunc(handler.Get)))

	for token, expected := range map[string]int{"admin": http.StatusOK, "member": http.StatusForbidden, "missing": http.StatusUnauthorized} {
		request := httptest.NewRequest(http.MethodGet, "/api/v1/admin/overview", nil)
		if token != "missing" {
			request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: token})
		}
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Code != expected {
			t.Fatalf("token=%s status=%d want=%d body=%s", token, response.Code, expected, response.Body.String())
		}
		if token == "admin" {
			var payload map[string]any
			if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
				t.Fatal(err)
			}
			if _, exists := payload["postgresDsn"]; exists {
				t.Fatal("overview exposed a connection string")
			}
		}
	}
}
