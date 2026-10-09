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

type fixedEmergencySampling struct {
	rate      float64
	expiresAt time.Time
	active    bool
}

func (provider fixedEmergencySampling) EmergencySampling(time.Time) (float64, time.Time, bool) {
	return provider.rate, provider.expiresAt, provider.active
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
	request := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/sdk/config", nil)
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

func TestSDKConfigAppliesStoragePressureCapWithoutReplacingStricterProjectCap(t *testing.T) {
	now := time.Date(2026, 9, 15, 8, 0, 0, 0, time.UTC)
	projectID := uuid.New()
	projectCap, projectExpiry := 0.05, now.Add(time.Hour)
	reader := fakeSDKConfigReader{value: metadata.ProjectSDKConfig{
		ProjectID: projectID, Version: 9, EffectiveAt: now,
		EventSampleRate: 1, APISampleRate: 0.2, ErrorSampleRate: 1,
		EmergencySampleRate: &projectCap, EmergencyExpiresAt: &projectExpiry,
	}}
	handler := NewSDKConfigHandler(
		fakeSDKConfigKeys{access: metadata.ProjectKeyAccess{Project: metadata.Project{ID: projectID}}},
		reader, zerolog.Nop(),
		fixedEmergencySampling{rate: 0.1, expiresAt: now.Add(2 * time.Minute), active: true},
	)
	handler.now = func() time.Time { return now }
	response := httptest.NewRecorder()
	request := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/sdk/config", nil)
	request.Header.Set("X-OpenRUM-Key", "orr_pk_valid")
	handler.Get(response, request)
	var payload sdkConfigResponse
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if !payload.Emergency || payload.EmergencySampleRate == nil || *payload.EmergencySampleRate != 0.05 || payload.EmergencyReason != "project_override" {
		t.Fatalf("payload=%+v", payload)
	}

	reader.value.EmergencySampleRate, reader.value.EmergencyExpiresAt = nil, nil
	handler = NewSDKConfigHandler(
		fakeSDKConfigKeys{access: metadata.ProjectKeyAccess{Project: metadata.Project{ID: projectID}}},
		reader, zerolog.Nop(),
		fixedEmergencySampling{rate: 0.1, expiresAt: now.Add(2 * time.Minute), active: true},
	)
	handler.now = func() time.Time { return now }
	response = httptest.NewRecorder()
	handler.Get(response, request)
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if !payload.Emergency || payload.EmergencySampleRate == nil || *payload.EmergencySampleRate != 0.1 || payload.EmergencyReason != "storage_pressure" {
		t.Fatalf("payload=%+v", payload)
	}
}

func TestSDKConfigRejectsInvalidKeyAndSupportsPreflight(t *testing.T) {
	handler := NewSDKConfigHandler(fakeSDKConfigKeys{err: metadata.ErrInvalidProjectKey}, fakeSDKConfigReader{}, zerolog.Nop())
	response := httptest.NewRecorder()
	handler.Get(response, httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/sdk/config", nil))
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	response = httptest.NewRecorder()
	handler.Options(response, httptest.NewRequestWithContext(context.Background(), http.MethodOptions, "/api/v1/sdk/config", nil))
	if response.Code != http.StatusNoContent || response.Header().Get("Access-Control-Allow-Headers") != "X-OpenRUM-Key" {
		t.Fatalf("status=%d headers=%v", response.Code, response.Header())
	}
}
