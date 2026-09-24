package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"openrum/internal/httpx"
	"openrum/internal/metadata"
)

const sdkConfigRefreshSeconds = 300

type sdkConfigKeys interface {
	Validate(context.Context, string) (metadata.ProjectKeyAccess, error)
}

type sdkConfigReader interface {
	Get(context.Context, uuid.UUID, time.Time) (metadata.ProjectSDKConfig, error)
}

type emergencySamplingProvider interface {
	EmergencySampling(time.Time) (float64, time.Time, bool)
}

type SDKConfigHandler struct {
	keys      sdkConfigKeys
	config    sdkConfigReader
	logger    zerolog.Logger
	now       func() time.Time
	emergency emergencySamplingProvider
}

type sdkConfigResponse struct {
	Version             int64    `json:"version"`
	EffectiveAt         string   `json:"effectiveAt"`
	ExpiresAt           string   `json:"expiresAt"`
	RefreshAfterSeconds int      `json:"refreshAfterSeconds"`
	EventSampleRate     float64  `json:"eventSampleRate"`
	APISampleRate       float64  `json:"apiSampleRate"`
	ErrorSampleRate     float64  `json:"errorSampleRate"`
	Emergency           bool     `json:"emergency"`
	EmergencySampleRate *float64 `json:"emergencySampleRate,omitempty"`
	EmergencyExpiresAt  *string  `json:"emergencyExpiresAt,omitempty"`
	EmergencyReason     string   `json:"emergencyReason,omitempty"`
}

func NewSDKConfigHandler(keys sdkConfigKeys, config sdkConfigReader, logger zerolog.Logger, emergency ...emergencySamplingProvider) *SDKConfigHandler {
	handler := &SDKConfigHandler{keys: keys, config: config, logger: logger, now: time.Now}
	if len(emergency) > 0 {
		handler.emergency = emergency[0]
	}
	return handler
}

func (handler *SDKConfigHandler) Get(writer http.ResponseWriter, request *http.Request) {
	setSDKConfigCORS(writer)
	key := request.Header.Get("X-OpenRUM-Key")
	access, err := handler.keys.Validate(request.Context(), key)
	if err != nil {
		if errors.Is(err, metadata.ErrInvalidProjectKey) || errors.Is(err, metadata.ErrProjectKeyRevoked) {
			httpx.WriteError(writer, request, http.StatusUnauthorized, "INVALID_KEY", "The project key is invalid.")
			return
		}
		handler.internalError(writer, request, err)
		return
	}
	now := handler.now().UTC()
	config, err := handler.config.Get(request.Context(), access.Project.ID, now)
	if err != nil {
		handler.internalError(writer, request, err)
		return
	}
	response := sdkConfigResponse{
		Version:             config.Version,
		EffectiveAt:         config.EffectiveAt.UTC().Format(time.RFC3339Nano),
		ExpiresAt:           now.Add(15 * time.Minute).Format(time.RFC3339Nano),
		RefreshAfterSeconds: sdkConfigRefreshSeconds,
		EventSampleRate:     config.EventSampleRate,
		APISampleRate:       config.APISampleRate,
		ErrorSampleRate:     config.ErrorSampleRate,
	}
	if config.EmergencySampleRate != nil && config.EmergencyExpiresAt != nil {
		response.Emergency = true
		capRate := math.Min(1, math.Max(0, *config.EmergencySampleRate))
		response.EmergencySampleRate = &capRate
		expires := config.EmergencyExpiresAt.UTC().Format(time.RFC3339Nano)
		response.EmergencyExpiresAt = &expires
		response.EmergencyReason = "project_override"
	}
	if handler.emergency != nil {
		if rate, expiresAt, active := handler.emergency.EmergencySampling(now); active {
			capRate := math.Min(1, math.Max(0, rate))
			if response.EmergencySampleRate == nil || capRate < *response.EmergencySampleRate {
				response.EmergencySampleRate = &capRate
				expires := expiresAt.UTC().Format(time.RFC3339Nano)
				response.EmergencyExpiresAt = &expires
				response.EmergencyReason = "storage_pressure"
			}
			response.Emergency = true
		}
	}
	writer.Header().Set("Content-Type", "application/json; charset=utf-8")
	writer.Header().Set("Cache-Control", "private, max-age=300")
	writer.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(writer).Encode(response)
}

func (handler *SDKConfigHandler) Options(writer http.ResponseWriter, _ *http.Request) {
	setSDKConfigCORS(writer)
	writer.Header().Set("Access-Control-Max-Age", "600")
	writer.WriteHeader(http.StatusNoContent)
}

func (handler *SDKConfigHandler) internalError(writer http.ResponseWriter, request *http.Request, err error) {
	handler.logger.Error().Err(err).Str("request_id", httpx.RequestIDFromContext(request.Context())).Msg("SDK config request failed")
	httpx.WriteError(writer, request, http.StatusServiceUnavailable, "CONFIG_UNAVAILABLE", "SDK configuration is temporarily unavailable.")
}

func setSDKConfigCORS(writer http.ResponseWriter) {
	writer.Header().Set("Access-Control-Allow-Origin", "*")
	writer.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
	writer.Header().Set("Access-Control-Allow-Headers", "X-OpenRUM-Key")
	writer.Header().Set("Vary", "Origin")
}
