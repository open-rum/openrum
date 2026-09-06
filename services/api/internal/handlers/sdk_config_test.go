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

	"openrum/internal/metadata"
)

type fakeSDKConfigKeys struct {
	access metadata.ProjectKeyAccess
	err    error
}

func (fake fakeSDKConfigKeys) Validate(context.Context, string) (metadata.ProjectKeyAccess, error) {
	return fake.access, fake.err
}

type fakeSDKConfigReader struct{ value metadata.ProjectSDKConfig }

func (fake fakeSDKConfigReader) Get(context.Context, uuid.UUID, time.Time) (metadata.ProjectSDKConfig, error) {
	return fake.value, nil
}

func TestSDKConfigAppliesTemporaryEmergencyCap(t *testing.T) {
	now := time.Date(2026, 9, 3, 8, 0, 0, 0, time.UTC)
	projectID := uuid.New()
	capRate, emergencyExpiry := 0.05, now.Add(time.Hour)
	handler := NewSDKConfigHandler(
		fakeSDKConfigKeys{access: metadata.ProjectKeyAccess{Project: metadata.Project{ID: projectID}}},
		fakeSDKConfigReader{value: metadata.ProjectSDKConfig{
			ProjectID: projectID, Version: 7, EffectiveAt: now.Add(-time.Minute),
			EventSampleRate: 0.5, APISampleRate: 0.2, ErrorSampleRate: 1,
			EmergencySampleRate: &capRate, EmergencyExpiresAt: &emergencyExpiry,
		}}, zerolog.Nop())
	handler.now = func() time.Time { return now }
	request := httptest.NewRequest(http.MethodGet, "/api/v1/sdk/config", nil)
	request.Header.Set("X-OpenRUM-Key", "orr_pk_valid")
	response := httptest.NewRecorder()
	handler.Get(response, request)
	var payload sdkConfigResponse
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if response.Code != http.StatusOK || payload.Version != 7 || !payload.Emergency || payload.EventSampleRate != 0.5 || payload.APISampleRate != 0.2 || payload.ErrorSampleRate != 1 || payload.EmergencySampleRate == nil || *payload.EmergencySampleRate != capRate {
		t.Fatalf("status=%d payload=%+v", response.Code, payload)
	}
	if response.Header().Get("Cache-Control") != "private, max-age=300" || response.Header().Get("Access-Control-Allow-Origin") != "*" {
		t.Fatalf("headers=%v", response.Header())
	}
}

func TestSDKConfigRejectsInvalidKeyAndSupportsPreflight(t *testing.T) {
	handler := NewSDKConfigHandler(fakeSDKConfigKeys{err: metadata.ErrInvalidProjectKey}, fakeSDKConfigReader{}, zerolog.Nop())
	response := httptest.NewRecorder()
	handler.Get(response, httptest.NewRequest(http.MethodGet, "/api/v1/sdk/config", nil))
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	response = httptest.NewRecorder()
	handler.Options(response, httptest.NewRequest(http.MethodOptions, "/api/v1/sdk/config", nil))
	if response.Code != http.StatusNoContent || response.Header().Get("Access-Control-Allow-Headers") != "X-OpenRUM-Key" {
		t.Fatalf("status=%d headers=%v", response.Code, response.Header())
	}
}
