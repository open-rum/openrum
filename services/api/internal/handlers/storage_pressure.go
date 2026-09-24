package handlers

import (
	"net/http"
	"time"

	"openrum/internal/storagepressure"
)

type storagePressureSnapshotter interface {
	Snapshot() storagepressure.Snapshot
}

type StoragePressureHandler struct {
	pressure storagePressureSnapshotter
}

type storagePressureResponse struct {
	Mode                    string   `json:"mode"`
	Level                   string   `json:"level"`
	UsedPercent             *float64 `json:"usedPercent"`
	AutomaticSamplingActive bool     `json:"automaticSamplingActive"`
	AutomaticSamplingRate   *float64 `json:"automaticSamplingRate"`
	IngestBlocked           bool     `json:"ingestBlocked"`
	ObservedAt              *string  `json:"observedAt"`
}

func NewStoragePressureHandler(pressure storagePressureSnapshotter) *StoragePressureHandler {
	return &StoragePressureHandler{pressure: pressure}
}

func (handler *StoragePressureHandler) Get(writer http.ResponseWriter, _ *http.Request) {
	snapshot := handler.pressure.Snapshot()
	response := storagePressureResponse{
		Mode: snapshot.Mode, Level: snapshot.Level,
		AutomaticSamplingActive: snapshot.AutomaticSamplingActive,
		IngestBlocked:           snapshot.IngestBlocked,
	}
	if snapshot.CapacityBytes > 0 {
		usedPercent := (1 - snapshot.FreeRatio) * 100
		response.UsedPercent = &usedPercent
	}
	if snapshot.AutomaticSamplingActive {
		rate := snapshot.AutomaticSamplingRate
		if snapshot.IngestBlocked {
			rate = 0
		}
		response.AutomaticSamplingRate = &rate
	}
	if !snapshot.ObservedAt.IsZero() {
		observedAt := snapshot.ObservedAt.UTC().Format(time.RFC3339Nano)
		response.ObservedAt = &observedAt
	}
	writeJSON(writer, http.StatusOK, response)
}
