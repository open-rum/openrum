package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"openrum/internal/auth"
	"openrum/internal/httpx"
	"openrum/internal/metadata"
)

type devDataProjectStub struct {
	access metadata.ProjectAccess
	err    error
}

func (stub devDataProjectStub) GetForUser(context.Context, uuid.UUID, uuid.UUID) (metadata.ProjectAccess, error) {
	return stub.access, stub.err
}

// The generator must be absent outside development rather than merely refusing
// requests, so a misconfigured deployment cannot expose it at all.
func TestNewDevDataHandlerOnlyExistsInDevelopment(t *testing.T) {
	for _, appEnv := range []string{"production", "staging", "test", ""} {
		if handler := NewDevDataHandler(appEnv, devDataProjectStub{}, "http://ingest", zerolog.Nop()); handler != nil {
			t.Fatalf("APP_ENV=%q produced a handler", appEnv)
		}
	}
	if handler := NewDevDataHandler("development", devDataProjectStub{}, "http://ingest", zerolog.Nop()); handler == nil {
		t.Fatal("development produced no handler")
	}
}

func TestDevDataRequiresAWriteKeyItCannotRecover(t *testing.T) {
	handler, router, _ := devDataFixture(t, nil)
	_ = handler

	response := performDevDataRequest(router, devDataProjectID, `{"preset":"storefront","sessions":2}`)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d body = %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "WRITE_KEY_REQUIRED") {
		t.Fatalf("body = %s", response.Body.String())
	}
}

func TestDevDataSendsGeneratedTrafficWithPerSessionHeaders(t *testing.T) {
	type received struct {
		key       string
		origin    string
		userAgent string
		country   string
	}
	seen := make([]received, 0, 32)
	ingest := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		var envelope struct {
			Events []json.RawMessage `json:"events"`
		}
		_ = json.NewDecoder(request.Body).Decode(&envelope)
		seen = append(seen, received{
			key: request.Header.Get("X-OpenRUM-Key"), origin: request.Header.Get("Origin"),
			userAgent: request.Header.Get("User-Agent"), country: request.Header.Get("CF-IPCountry"),
		})
		writeJSON(writer, http.StatusAccepted, map[string]any{"accepted": len(envelope.Events), "rejected": []any{}})
	}))
	defer ingest.Close()

	_, router, _ := devDataFixture(t, &ingest.URL)

	response := performDevDataRequest(router, devDataProjectID, `{"writeKey":"orr_pk_local","preset":"storefront","sessions":6,"minutes":60}`)

	if response.Code != http.StatusAccepted {
		t.Fatalf("status = %d body = %s", response.Code, response.Body.String())
	}
	var payload devDataResponse
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if payload.Accepted == 0 || payload.Failed != 0 || payload.Summary.Sessions != 6 {
		t.Fatalf("payload = %+v", payload)
	}
	if len(seen) != payload.Envelopes {
		t.Fatalf("ingest saw %d envelopes, response reported %d", len(seen), payload.Envelopes)
	}
	agents, countries := map[string]bool{}, map[string]bool{}
	for _, current := range seen {
		if current.key != "orr_pk_local" {
			t.Fatalf("write key = %q", current.key)
		}
		// The origin has to be one the project allows or ingest would reject it.
		if current.origin != "https://shop.example.com" {
			t.Fatalf("origin = %q", current.origin)
		}
		agents[current.userAgent] = true
		countries[current.country] = true
	}
	// Browser and country reach the pipeline only through these headers, so a
	// single value across every request would flatten both breakdowns.
	if len(agents) < 2 || len(countries) < 2 {
		t.Fatalf("agents=%d countries=%d, want variety across sessions", len(agents), len(countries))
	}
}

func TestDevDataRejectsAScenarioTheProtocolWouldRefuse(t *testing.T) {
	_, router, _ := devDataFixture(t, nil)

	body := `{"writeKey":"orr_pk_local","scenario":{"sessions":1,"baseUrl":"https://shop.example.com",
		"from":"2026-09-01T00:00:00Z","to":"2026-09-02T00:00:00Z",
		"clients":[{"name":"c","userAgent":"UA","country":"CN","weight":1}],
		"journeys":[{"name":"j","weight":1,"pages":[{"route":"/","path":"/","apis":[{"method":"FETCH","path":"/api/x"}]}]}]}}`

	response := performDevDataRequest(router, devDataProjectID, body)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d body = %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "FETCH") {
		t.Fatalf("the error should name the offending method: %s", response.Body.String())
	}
}

func TestDevDataPresetsReturnAnEditableScenarioBoundToTheProject(t *testing.T) {
	_, router, _ := devDataFixture(t, nil)

	request := httptest.NewRequestWithContext(context.Background(), http.MethodGet,
		"/api/v1/projects/"+devDataProjectID.String()+"/dev-data/presets", nil)
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "valid"})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d body = %s", response.Code, response.Body.String())
	}
	var payload devDataPresetsResponse
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(payload.Presets) == 0 {
		t.Fatal("no presets offered")
	}
	// Getting either of these wrong makes ingest reject every envelope, so the
	// server fills them instead of trusting the caller.
	if payload.Scenario.Environment != "production" {
		t.Fatalf("environment = %q", payload.Scenario.Environment)
	}
	if payload.Scenario.BaseURL != "https://shop.example.com" {
		t.Fatalf("baseUrl = %q", payload.Scenario.BaseURL)
	}
	if err := payload.Scenario.Validate(); err != nil {
		t.Fatalf("the offered scenario does not validate: %v", err)
	}
}

var devDataProjectID = uuid.MustParse("00000000-0000-4000-8000-0000000000d1")

func devDataFixture(t *testing.T, ingestURL *string) (*DevDataHandler, http.Handler, uuid.UUID) {
	t.Helper()
	userID := uuid.New()
	projects := devDataProjectStub{access: metadata.ProjectAccess{
		Role: metadata.RoleAdmin,
		Project: metadata.Project{
			ID: devDataProjectID, Environment: "production", Status: metadata.ProjectStatusActive,
			AllowedOrigins: []string{"https://shop.example.com"},
		},
	}}
	target := "http://127.0.0.1:1/ingest/v1/envelope"
	if ingestURL != nil {
		target = *ingestURL
	}
	handler := NewDevDataHandler("development", projects, target, zerolog.Nop())
	if handler == nil {
		t.Fatal("development produced no handler")
	}
	router := httpx.NewRouter(zerolog.Nop())
	baseURL, _ := url.Parse("http://openrum.test")
	authenticated := httpx.RequireSession(testEventAuthenticator{principal: auth.Principal{UserID: userID}})
	csrf := httpx.RequireCSRF(baseURL)
	router.Handle("GET /api/v1/projects/{projectId}/dev-data/presets", authenticated(http.HandlerFunc(handler.Presets)))
	router.Handle("POST /api/v1/projects/{projectId}/dev-data", authenticated(csrf(http.HandlerFunc(handler.Create))))
	return handler, router, userID
}

func performDevDataRequest(router http.Handler, projectID uuid.UUID, body string) *httptest.ResponseRecorder {
	request := httptest.NewRequestWithContext(context.Background(), http.MethodPost,
		"/api/v1/projects/"+projectID.String()+"/dev-data", strings.NewReader(body))
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "valid"})
	request.AddCookie(&http.Cookie{Name: auth.CSRFCookieName, Value: "csrf-token"})
	request.Header.Set("Origin", "http://openrum.test")
	request.Header.Set(httpx.CSRFHeader, "csrf-token")
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	return response
}
