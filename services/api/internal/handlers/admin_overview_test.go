package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
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

type fakeOverviewRedis struct {
	err  error
	gets int
}

func (client *fakeOverviewRedis) Ping(context.Context) *redis.StatusCmd {
	return redis.NewStatusResult("PONG", nil)
}

func (client *fakeOverviewRedis) Get(context.Context, string) *redis.StringCmd {
	client.gets++
	return redis.NewStringResult("alive", client.err)
}

func TestWorkerDependencyReportsHeartbeatWithoutExposingRedisErrors(t *testing.T) {
	for _, test := range []struct {
		name   string
		err    error
		status string
	}{
		{name: "recent heartbeat", status: "healthy"},
		{name: "missing heartbeat", err: redis.Nil, status: "unhealthy"},
		{name: "redis unavailable", err: errors.New("dial redis.internal:6379 failed"), status: "unknown"},
	} {
		t.Run(test.name, func(t *testing.T) {
			client := &fakeOverviewRedis{err: test.err}
			result := workerDependency(context.Background(), client, "instance-key")
			if result.Status != test.status || client.gets != 1 || result.LatencyMS != nil {
				t.Fatalf("worker status=%q gets=%d latency=%v", result.Status, client.gets, result.LatencyMS)
			}
			if strings.Contains(result.Detail, "redis.internal") {
				t.Fatal("worker status exposed the Redis address")
			}
		})
	}
}

func TestAdminOverviewRequiresInstanceRoleAndDoesNotExposeSecrets(t *testing.T) {
	adminID, memberID := uuid.New(), uuid.New()
	members := &fakeInstanceMembers{roles: map[uuid.UUID]metadata.InstanceRole{
		adminID: metadata.InstanceRoleAdmin,
	}}
	source := fixedAdminOverviewSource{response: adminOverviewResponse{
		Version: "v0.1.1", Environment: "test", DeploymentMode: "kubernetes",
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
