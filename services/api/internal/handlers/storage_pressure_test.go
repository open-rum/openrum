package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"openrum/internal/storagepressure"
)

type fixedStoragePressure struct{ snapshot storagepressure.Snapshot }

func (source fixedStoragePressure) Snapshot() storagepressure.Snapshot { return source.snapshot }

func TestStoragePressureHandlerExposesGlobalCircuitBreakerState(t *testing.T) {
	handler := NewStoragePressureHandler(fixedStoragePressure{snapshot: storagepressure.Snapshot{
		Mode: "blocked", Level: "critical", CapacityBytes: 1000, FreeRatio: 0.04,
		AutomaticSamplingActive: true, AutomaticSamplingRate: 0.1, IngestBlocked: true,
		ObservedAt: time.Date(2026, 9, 15, 10, 0, 0, 0, time.UTC),
	}})
	response := httptest.NewRecorder()
	handler.Get(response, httptest.NewRequest(http.MethodGet, "/api/v1/storage-pressure", nil))

	var payload storagePressureResponse
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if response.Code != http.StatusOK || payload.Mode != "blocked" || !payload.IngestBlocked ||
		payload.UsedPercent == nil || *payload.UsedPercent != 96 ||
		payload.AutomaticSamplingRate == nil || *payload.AutomaticSamplingRate != 0 {
		t.Fatalf("status=%d payload=%+v", response.Code, payload)
	}
}
