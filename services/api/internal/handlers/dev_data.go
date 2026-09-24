package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
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

type devDataKeys interface {
	ListForUser(context.Context, uuid.UUID, uuid.UUID) ([]metadata.ProjectKey, metadata.OrganizationRole, error)
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
	keys       devDataKeys
	ingestURL  string
	httpClient *http.Client
	logger     zerolog.Logger
	now        func() time.Time
}

// NewDevDataHandler returns nil when the deployment is not a development one.
// A nil handler registers no routes, which keeps this surface out of any other
// environment instead of relying on a runtime check at request time.
func NewDevDataHandler(appEnv string, projects devDataProjects, ingestURL string, logger zerolog.Logger, keys ...devDataKeys) *DevDataHandler {
	if appEnv != "development" {
		return nil
	}
	handler := &DevDataHandler{
		projects:   projects,
		ingestURL:  ingestURL,
		httpClient: &http.Client{Timeout: 30 * time.Second},
		logger:     logger,
		now:        time.Now,
	}
	if len(keys) > 0 {
		handler.keys = keys[0]
	}
	return handler
}

type devDataRequest struct {
	// Optional override; normally the project's current default public key is used.
	WriteKey string `json:"writeKey"`
	Preset   string `json:"preset"`
	Sessions int    `json:"sessions"`
	// Minutes is the width of the window the sessions are spread over, ending
	// now. Backdating is safe because the pipeline only rewrites timestamps
	// that are implausible, and a past timestamp is not.
	Minutes     int               `json:"minutes"`
	Seed        int64             `json:"seed"`
	Scenario    *devdata.Scenario `json:"scenario"`
	From        time.Time         `json:"from"`
	To          time.Time         `json:"to"`
	Environment string            `json:"environment"`
}

type devDataResponse struct {
	Summary        devdata.Summary `json:"summary"`
	Accepted       int             `json:"accepted"`
	Rejected       int             `json:"rejected"`
	Envelopes      int             `json:"envelopes"`
	Failed         int             `json:"failed"`
	ElapsedMS      int64           `json:"elapsedMs"`
	Message        string          `json:"message"`
	From           time.Time       `json:"from"`
	To             time.Time       `json:"to"`
	Environment    string          `json:"environment"`
	BaseURL        string          `json:"baseUrl"`
	ProbeEventID   string          `json:"probeEventId,omitempty"`
	ProbeSessionID string          `json:"probeSessionId,omitempty"`
	ProbeAt        string          `json:"probeAt,omitempty"`
	LastError      string          `json:"lastError,omitempty"`
	Unsent         int             `json:"unsent"`
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
	scenario.BaseURL = simulatedBaseURL(access.Project)
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
	if payload.Minutes < 0 || payload.Minutes > 30*24*60 || payload.Sessions < 0 || payload.Sessions > devdata.MaxSessions {
		httpx.WriteError(writer, request, http.StatusBadRequest, "INVALID_SCENARIO", "会话数上限为 5000，时间范围不能超过 30 天。")
		return
	}
	if access.Project.Status != metadata.ProjectStatusActive {
		httpx.WriteError(writer, request, http.StatusConflict, "PROJECT_DISABLED", "项目已停止。请先启用项目，再生成测试数据。")
		return
	}
	principal, _ := httpx.PrincipalFromContext(request.Context())
	if handler.keys == nil {
		httpx.WriteError(writer, request, http.StatusServiceUnavailable, "KEY_STORE_UNAVAILABLE", "项目凭据服务不可用。")
		return
	}
	keys, _, err := handler.keys.ListForUser(request.Context(), principal.UserID, access.Project.ID)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	writeKey := ""
	for _, key := range keys {
		if key.RevokedAt == nil && key.PublicKey != "" && ((payload.WriteKey == "" && key.IsDefault) || payload.WriteKey == key.PublicKey) {
			writeKey = key.PublicKey
			break
		}
	}
	if writeKey == "" {
		httpx.WriteError(writer, request, http.StatusBadRequest, "INVALID_PROJECT_KEY", "未找到当前项目的有效 DSN。请在接入页检查默认 DSN；不能使用其他项目或已撤销的凭据。")
		return
	}

	scenario := handler.resolveScenario(payload, access.Project)
	if !access.Project.AcceptsEnvironment(scenario.Environment) {
		httpx.WriteError(writer, request, http.StatusBadRequest, "INVALID_ENVIRONMENT", "请选择当前项目已配置的环境。")
		return
	}
	if payload.From.IsZero() != payload.To.IsZero() || scenario.To.After(handler.now().Add(time.Minute)) || scenario.From.Before(handler.now().Add(-30*24*time.Hour)) || scenario.To.Sub(scenario.From) < time.Second {
		httpx.WriteError(writer, request, http.StatusBadRequest, "INVALID_TIME_RANGE", "造数据范围应在最近 30 天内，结束时间不能晚于当前时间，且至少为 1 秒。")
		return
	}
	batches, summary, err := devdata.Build(scenario)
	if err != nil {
		httpx.WriteError(writer, request, http.StatusBadRequest, "INVALID_SCENARIO", err.Error())
		return
	}

	started := handler.now()
	result, err := handler.send(request.Context(), batches, writeKey, defaultBaseURL(access.Project))
	if err != nil {
		handler.logger.Error().Err(err).Str("project_id", access.Project.ID.String()).Msg("send dev data")
		httpx.WriteError(writer, request, http.StatusBadGateway, "INGEST_UNAVAILABLE", err.Error())
		return
	}
	result.Summary = summary
	result.Envelopes = len(batches)
	result.ElapsedMS = handler.now().Sub(started).Milliseconds()
	result.From, result.To, result.Environment, result.BaseURL = scenario.From, scenario.To, scenario.Environment, scenario.BaseURL
	result.Message = "已投递到 Ingest，仍需等待 Consumer 入库。项目过滤规则仍然生效；已接收不代表全部可查询。"
	if result.Failed > 0 || result.Rejected > 0 || result.Accepted == 0 {
		result.Message = "投递未全部成功，请查看拒收、失败与未发送数量。已接收部分不会自动重试，避免重复造数据。"
	}
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
		if payload.Minutes > 0 {
			scenario.From, scenario.To = to.Add(-time.Duration(minutes)*time.Minute), to
		}
	}
	if payload.Sessions > 0 {
		scenario.Sessions = payload.Sessions
	}
	if payload.Seed != 0 {
		scenario.Seed = payload.Seed
	}
	scenario.Environment = project.Environment
	if payload.Environment != "" {
		scenario.Environment = payload.Environment
	}
	if !payload.From.IsZero() {
		scenario.From, scenario.To = payload.From, payload.To
	}
	if scenario.BaseURL == "" {
		scenario.BaseURL = simulatedBaseURL(project)
	}
	if payload.Scenario == nil {
		scenario.BaseURL = simulatedBaseURL(project)
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
			result.LastError = err.Error()
			result.Unsent = len(batches) - index - 1
			break
		}
		result.Accepted += accepted
		result.Rejected += rejected
		if accepted == len(batch.Envelope.Events) && accepted > 0 {
			result.ProbeEventID = batch.Envelope.Events[0].EventID
			result.ProbeSessionID = batch.Envelope.Context.SessionID
			result.ProbeAt = batch.Envelope.Events[0].Timestamp
		}
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
	if response.Header.Get("X-OpenRUM-Storage-Pressure") == "hard-stop" {
		return 0, 0, errors.New("存储硬熔断：Ingest 未写入数据。请先在系统设置检查存储容量")
	}
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

// Keep the authenticated transport Origin separate from the simulated page URL.
// Localhost pages are intentionally filtered by the normal pipeline; development
// fixtures model a deployed site without weakening that production filter.
func simulatedBaseURL(project metadata.Project) string {
	origin := defaultBaseURL(project)
	parsed, _ := url.Parse(origin)
	if parsed != nil {
		host := strings.ToLower(parsed.Hostname())
		address, _ := netip.ParseAddr(host)
		address = address.Unmap()
		if host == "localhost" || strings.HasSuffix(host, ".localhost") || strings.HasSuffix(host, ".local") || address.IsLoopback() || address.IsLinkLocalUnicast() {
			return "https://shop.example.com"
		}
	}
	return origin
}
