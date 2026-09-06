package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"openrum/internal/auth"
	"openrum/internal/devdata"
	"openrum/internal/httpx"
	"openrum/internal/metadata"
)

type devDataProjects interface {
	GetForUser(context.Context, uuid.UUID, uuid.UUID) (metadata.ProjectAccess, error)
}

// DevDataHandler synthesizes traffic for local development by replaying
// generated envelopes through the public ingest endpoint.
//
// It posts to ingest rather than writing ClickHouse directly so the resulting
// rows have been through the same validation, normalization and aggregation as
// production traffic. That costs a write key and some consumer lag, and buys
// data that a query can be trusted against.
type DevDataHandler struct {
	projects   devDataProjects
	ingestURL  string
	httpClient *http.Client
	logger     zerolog.Logger
	now        func() time.Time
}

// NewDevDataHandler returns nil when the deployment is not a development one.
// A nil handler registers no routes, which keeps this surface out of any other
// environment instead of relying on a runtime check at request time.
func NewDevDataHandler(appEnv string, projects devDataProjects, ingestURL string, logger zerolog.Logger) *DevDataHandler {
	if appEnv != "development" {
		return nil
	}
	return &DevDataHandler{
		projects:   projects,
		ingestURL:  ingestURL,
		httpClient: &http.Client{Timeout: 30 * time.Second},
		logger:     logger,
		now:        time.Now,
	}
}

type devDataRequest struct {
	// WriteKey has to be supplied by the caller: project keys are stored only
	// as hashes, so the server cannot recover one to send traffic with.
	WriteKey string `json:"writeKey"`
	Preset   string `json:"preset"`
	Sessions int    `json:"sessions"`
	// Minutes is the width of the window the sessions are spread over, ending
	// now. Backdating is safe because the pipeline only rewrites timestamps
	// that are implausible, and a past timestamp is not.
	Minutes  int               `json:"minutes"`
	Seed     int64             `json:"seed"`
	Scenario *devdata.Scenario `json:"scenario"`
}

type devDataResponse struct {
	Summary   devdata.Summary `json:"summary"`
	Accepted  int             `json:"accepted"`
	Rejected  int             `json:"rejected"`
	Envelopes int             `json:"envelopes"`
	Failed    int             `json:"failed"`
	ElapsedMS int64           `json:"elapsedMs"`
	Message   string          `json:"message"`
}

type devDataPresetsResponse struct {
	Presets  []devdata.Preset `json:"presets"`
	Scenario devdata.Scenario `json:"scenario"`
}

// Presets returns the catalogue plus a ready-to-edit scenario, so the console
// can offer a starting point without embedding a copy of it.
func (handler *DevDataHandler) Presets(writer http.ResponseWriter, request *http.Request) {
	access, ok := handler.authorize(writer, request)
	if !ok {
		return
	}
	preset := request.URL.Query().Get("preset")
	if preset == "" {
		preset = devdata.Presets()[0].ID
	}
	minutes := 24 * 60
	if raw := request.URL.Query().Get("minutes"); raw != "" {
		if parsed, err := time.ParseDuration(raw + "m"); err == nil && parsed > 0 {
			minutes = int(parsed.Minutes())
		}
	}
	to := handler.now().UTC()
	scenario := devdata.PresetScenario(preset, to.Add(-time.Duration(minutes)*time.Minute), to)
	scenario.Environment = access.Project.Environment
	scenario.BaseURL = defaultBaseURL(access.Project)
	writeJSON(writer, http.StatusOK, devDataPresetsResponse{Presets: devdata.Presets(), Scenario: scenario})
}

// Create generates a dataset and sends it to ingest.
func (handler *DevDataHandler) Create(writer http.ResponseWriter, request *http.Request) {
	access, ok := handler.authorize(writer, request)
	if !ok {
		return
	}
	var payload devDataRequest
	if err := json.NewDecoder(io.LimitReader(request.Body, 1<<20)).Decode(&payload); err != nil {
		httpx.WriteError(writer, request, http.StatusBadRequest, "INVALID_BODY", "The request body is not valid JSON.")
		return
	}
	if payload.WriteKey == "" {
		httpx.WriteError(writer, request, http.StatusBadRequest, "WRITE_KEY_REQUIRED",
			"A project write key is required: keys are stored hashed, so the server cannot supply one.")
		return
	}

	scenario := handler.resolveScenario(payload, access.Project)
	batches, summary, err := devdata.Build(scenario)
	if err != nil {
		httpx.WriteError(writer, request, http.StatusBadRequest, "INVALID_SCENARIO", err.Error())
		return
	}

	started := handler.now()
	result, err := handler.send(request.Context(), batches, payload.WriteKey, scenario.BaseURL)
	if err != nil {
		handler.logger.Error().Err(err).Str("project_id", access.Project.ID.String()).Msg("send dev data")
		httpx.WriteError(writer, request, http.StatusBadGateway, "INGEST_UNAVAILABLE", err.Error())
		return
	}
	result.Summary = summary
	result.Envelopes = len(batches)
	result.ElapsedMS = handler.now().Sub(started).Milliseconds()
	result.Message = "Events were accepted by ingest. They become queryable once the consumer has written them, usually within a few seconds."
	writeJSON(writer, http.StatusAccepted, result)
}

func (handler *DevDataHandler) resolveScenario(payload devDataRequest, project metadata.Project) devdata.Scenario {
	minutes := payload.Minutes
	if minutes <= 0 {
		minutes = 24 * 60
	}
	to := handler.now().UTC()
	scenario := devdata.PresetScenario(payload.Preset, to.Add(-time.Duration(minutes)*time.Minute), to)
	if payload.Scenario != nil {
		scenario = *payload.Scenario
	}
	if payload.Sessions > 0 {
		scenario.Sessions = payload.Sessions
	}
	if payload.Seed != 0 {
		scenario.Seed = payload.Seed
	}
	// The environment has to match the project or ingest rejects every
	// envelope, and the origin has to be one the project allows, so neither is
	// left to the caller to get right.
	scenario.Environment = project.Environment
	if scenario.BaseURL == "" {
		scenario.BaseURL = defaultBaseURL(project)
	}
	return scenario
}

func (handler *DevDataHandler) send(ctx context.Context, batches []devdata.Batch, writeKey, origin string) (devDataResponse, error) {
	result := devDataResponse{}
	for index, batch := range batches {
		body, err := json.Marshal(batch.Envelope)
		if err != nil {
			return result, fmt.Errorf("encode envelope %d: %w", index, err)
		}
		accepted, rejected, err := handler.post(ctx, body, writeKey, origin, batch)
		if err != nil {
			// One bad batch should not discard the work already accepted, so
			// the count is reported instead of failing the whole request.
			result.Failed++
			if result.Failed > 5 {
				return result, fmt.Errorf("envelope %d and %d earlier ones were refused: %w", index, result.Failed-1, err)
			}
			continue
		}
		result.Accepted += accepted
		result.Rejected += rejected
	}
	return result, nil
}

func (handler *DevDataHandler) post(ctx context.Context, body []byte, writeKey, origin string, batch devdata.Batch) (int, int, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, handler.ingestURL, bytes.NewReader(body))
	if err != nil {
		return 0, 0, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-OpenRUM-Key", writeKey)
	request.Header.Set("Origin", origin)
	// Browser, OS and device are parsed from the user agent, and country is
	// read from the trusted country header. Neither can travel in the envelope,
	// so the only way to vary them is per request.
	request.Header.Set("User-Agent", batch.UserAgent)
	if batch.Country != "" {
		request.Header.Set("CF-IPCountry", batch.Country)
	}

	response, err := handler.httpClient.Do(request)
	if err != nil {
		return 0, 0, fmt.Errorf("post to %s: %w", handler.ingestURL, err)
	}
	defer func() { _ = response.Body.Close() }()
	payload, _ := io.ReadAll(io.LimitReader(response.Body, 1<<16))
	if response.StatusCode >= 300 {
		return 0, 0, fmt.Errorf("ingest replied %d: %s", response.StatusCode, bytes.TrimSpace(payload))
	}
	var acceptance struct {
		Accepted int               `json:"accepted"`
		Rejected []json.RawMessage `json:"rejected"`
	}
	if err := json.Unmarshal(payload, &acceptance); err != nil {
		return 0, 0, fmt.Errorf("decode acceptance: %w", err)
	}
	return acceptance.Accepted, len(acceptance.Rejected), nil
}

func (handler *DevDataHandler) authorize(writer http.ResponseWriter, request *http.Request) (metadata.ProjectAccess, bool) {
	principal, ok := httpx.PrincipalFromContext(request.Context())
	if !ok {
		httpx.WriteError(writer, request, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication is required.")
		return metadata.ProjectAccess{}, false
	}
	projectID, ok := parsePathUUID(writer, request, "projectId")
	if !ok {
		return metadata.ProjectAccess{}, false
	}
	access, err := handler.projects.GetForUser(request.Context(), principal.UserID, projectID)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return metadata.ProjectAccess{}, false
	}
	if err := auth.Authorize(access.Role, auth.ActionSendTestEvent); err != nil {
		writeControlPlaneError(writer, request, handler.logger, errors.Join(metadata.ErrForbidden, err))
		return metadata.ProjectAccess{}, false
	}
	return access, true
}

// defaultBaseURL picks an origin the project already allows, because ingest
// enforces the project's CORS allowlist on every envelope.
func defaultBaseURL(project metadata.Project) string {
	for _, origin := range project.AllowedOrigins {
		if origin != "" && origin != "*" {
			return origin
		}
	}
	return "https://shop.example.com"
}
