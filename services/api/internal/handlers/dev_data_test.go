package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

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

type devDataKeyStub struct{ keys []metadata.ProjectKey }

func (stub devDataKeyStub) ListForUser(context.Context, uuid.UUID, uuid.UUID) ([]metadata.ProjectKey, metadata.OrganizationRole, error) {
	return stub.keys, metadata.RoleAdmin, nil
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

func TestDevDataRejectsMissingDefaultKey(t *testing.T) {
	handler, router, _ := devDataFixture(t, nil)
	handler.keys = devDataKeyStub{}

	response := performDevDataRequest(router, devDataProjectID, `{"preset":"storefront","sessions":2}`)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d body = %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "INVALID_PROJECT_KEY") {
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
	handler := NewDevDataHandler("development", projects, target, zerolog.Nop(), devDataKeyStub{keys: []metadata.ProjectKey{{PublicKey: "orr_pk_local", IsDefault: true}}})
	if handler == nil {
		t.Fatal("development produced no handler")
		return nil, nil, uuid.Nil
	}
	handler.now = func() time.Time { return time.Date(2026, 9, 22, 6, 0, 0, 0, time.UTC) }
	router := httpx.NewRouter(zerolog.Nop())
	baseURL, _ := url.Parse("http://openrum.test")
	authenticated := httpx.RequireSession(testEventAuthenticator{principal: auth.Principal{UserID: userID}})
	csrf := httpx.RequireCSRF(baseURL)
	router.Handle("GET /api/v1/projects/{projectId}/dev-data/presets", authenticated(http.HandlerFunc(handler.Presets)))
	router.Handle("POST /api/v1/projects/{projectId}/dev-data", authenticated(csrf(http.HandlerFunc(handler.Create))))
	return handler, router, userID
}

func TestDevDataScopeAndLocalhostSimulation(t *testing.T) {
	var events int
	ingest := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var batch struct {
			Context struct {
				Environment string `json:"environment"`
				Page        struct {
					URL string `json:"url"`
				} `json:"page"`
			} `json:"context"`
			Events []struct {
				Timestamp time.Time `json:"timestamp"`
			} `json:"events"`
		}
		if err := json.NewDecoder(r.Body).Decode(&batch); err != nil {
			t.Error(err)
		}
		if r.Header.Get("Origin") != "http://127.0.0.1:4173" || r.Header.Get("X-OpenRUM-Key") != "orr_pk_local" {
			t.Error("wrong transport identity")
		}
		if batch.Context.Environment != "test" || !strings.HasPrefix(batch.Context.Page.URL, "https://shop.example.com/") {
			t.Errorf("context: %+v", batch.Context)
		}
		from := time.Date(2026, 9, 22, 5, 0, 0, 0, time.UTC)
		for _, ev := range batch.Events {
			if ev.Timestamp.Before(from) || !ev.Timestamp.Before(from.Add(time.Minute)) {
				t.Errorf("out of range: %s", ev.Timestamp)
			}
		}
		events += len(batch.Events)
		writeJSON(w, http.StatusAccepted, map[string]any{"accepted": len(batch.Events), "rejected": []any{}})
	}))
	defer ingest.Close()
	handler, router, _ := devDataFixture(t, &ingest.URL)
	stub := handler.projects.(devDataProjectStub)
	stub.access.Project.AllowedOrigins = []string{"http://127.0.0.1:4173"}
	stub.access.Project.Environments = []string{"production", "test"}
	handler.projects = stub
	response := performDevDataRequest(router, devDataProjectID, `{"sessions":10,"environment":"test","from":"2026-09-22T05:00:00Z","to":"2026-09-22T05:01:00Z"}`)
	var result devDataResponse
	_ = json.Unmarshal(response.Body.Bytes(), &result)
	if response.Code != 202 || result.Accepted != events || events == 0 || result.ProbeEventID == "" || result.Environment != "test" {
		t.Fatalf("response: %s", response.Body.String())
	}
}

func TestDevDataRejectsInvalidScopeAndForeignKeys(t *testing.T) {
	for _, body := range []string{
		`{"writeKey":"orr_pk_other_project"}`, `{"environment":"missing"}`,
		`{"from":"2026-09-22T05:00:00Z"}`, `{"minutes":999999999}`,
		`{"from":"2026-09-22T06:00:00Z","to":"2026-09-22T05:00:00Z"}`,
		`{"from":"2026-09-23T06:00:00Z","to":"2026-09-23T07:00:00Z"}`,
	} {
		_, router, _ := devDataFixture(t, nil)
		response := performDevDataRequest(router, devDataProjectID, body)
		if response.Code != 400 {
			t.Errorf("%s: %d %s", body, response.Code, response.Body.String())
		}
	}
	handler, router, _ := devDataFixture(t, nil)
	stub := handler.projects.(devDataProjectStub)
	stub.access.Project.Status = metadata.ProjectStatusDisabled
	handler.projects = stub
	if response := performDevDataRequest(router, devDataProjectID, `{}`); response.Code != 409 {
		t.Fatalf("disabled project: %d", response.Code)
	}
}

func TestDevDataHardStopIsNotSuccessfulGeneration(t *testing.T) {
	ingest := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-OpenRUM-Storage-Pressure", "hard-stop")
		writeJSON(w, 202, map[string]any{"accepted": 0, "rejected": []any{}})
	}))
	defer ingest.Close()
	_, router, _ := devDataFixture(t, &ingest.URL)
	response := performDevDataRequest(router, devDataProjectID, `{"sessions":2}`)
	var result devDataResponse
	_ = json.Unmarshal(response.Body.Bytes(), &result)
	if result.Accepted != 0 || result.Failed != 1 || result.LastError == "" || result.Unsent == 0 || result.ProbeEventID != "" {
		t.Fatalf("result: %s", response.Body.String())
	}
}

func TestDevDataLocalOriginsDoNotBecomeFilteredPageURLs(t *testing.T) {
	for _, origin := range []string{"http://127.0.0.1:4173", "http://127.0.0.2", "http://[::1]", "http://app.localhost", "http://app.local"} {
		project := metadata.Project{AllowedOrigins: []string{origin}}
		if simulatedBaseURL(project) != "https://shop.example.com" || defaultBaseURL(project) != origin {
			t.Errorf("origin=%s", origin)
		}
	}
	for _, origin := range []string{"https://shop.example.com", "http://192.168.1.1", "https://localhost.example.com"} {
		if simulatedBaseURL(metadata.Project{AllowedOrigins: []string{origin}}) != origin {
			t.Errorf("must preserve non-localhost application %s", origin)
		}
	}
}

func TestDevDataPreservesPartialAcceptanceWithoutReplaying(t *testing.T) {
	calls := 0
	ingest := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if calls == 2 {
			w.WriteHeader(http.StatusTooManyRequests)
			_, _ = w.Write([]byte(`{"error":{"code":"RATE_LIMITED"}}`))
			return
		}
		var payload struct {
			Events []json.RawMessage `json:"events"`
		}
		_ = json.NewDecoder(r.Body).Decode(&payload)
		writeJSON(w, 202, map[string]any{"accepted": len(payload.Events), "rejected": []any{}})
	}))
	defer ingest.Close()
	_, router, _ := devDataFixture(t, &ingest.URL)
	response := performDevDataRequest(router, devDataProjectID, `{"sessions":10}`)
	var result devDataResponse
	_ = json.Unmarshal(response.Body.Bytes(), &result)
	if calls != 2 || result.Accepted == 0 || result.Failed != 1 || result.Unsent == 0 || !strings.Contains(result.LastError, "429") {
		t.Fatalf("result: %s", response.Body.String())
	}
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

func TestDevDataBusinessUserIDsReachTheEnvelopes(t *testing.T) {
	users := map[string]bool{}
	ingest := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var batch struct {
			Context struct {
				UserID string `json:"user_id"`
			} `json:"context"`
			Events []json.RawMessage `json:"events"`
		}
		_ = json.NewDecoder(r.Body).Decode(&batch)
		users[batch.Context.UserID] = true
		writeJSON(w, http.StatusAccepted, map[string]any{"accepted": len(batch.Events), "rejected": []any{}})
	}))
	defer ingest.Close()
	_, router, _ := devDataFixture(t, &ingest.URL)
	response := performDevDataRequest(router, devDataProjectID, `{"sessions":40,"minutes":60,"users":{"ids":["vip-001"," vip-002 "],"signedIn":1}}`)
	if response.Code != 202 {
		t.Fatalf("response: %s", response.Body.String())
	}
	if len(users) != 2 || !users["vip-001"] || !users["vip-002"] {
		t.Fatalf("user ids=%v", users)
	}
}
