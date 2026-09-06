package handlers

import (
	"context"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"openrum/internal/httpx"
	"openrum/internal/ingest"
	"openrum/internal/metadata"
)

type connectionProjectKeys interface {
	ListForUser(context.Context, uuid.UUID, uuid.UUID) ([]metadata.ProjectKey, metadata.OrganizationRole, error)
}

type ConnectionStatusHandler struct {
	keys   connectionProjectKeys
	status ingest.ConnectionStatusReader
	logger zerolog.Logger
}

type connectionStatusResponse struct {
	KeyConfigured        bool    `json:"keyConfigured"`
	LastSDKSeenAt        *string `json:"lastSdkSeenAt"`
	LastEventReceivedAt  *string `json:"lastEventReceivedAt"`
	LastEventQueryableAt *string `json:"lastEventQueryableAt"`
	LastRejectReason     *string `json:"lastRejectReason"`
	LastRejectAt         *string `json:"lastRejectAt"`
}

func NewConnectionStatusHandler(keys connectionProjectKeys, status ingest.ConnectionStatusReader, logger zerolog.Logger) *ConnectionStatusHandler {
	return &ConnectionStatusHandler{keys: keys, status: status, logger: logger}
}

func (handler *ConnectionStatusHandler) Get(writer http.ResponseWriter, request *http.Request) {
	principal, ok := httpx.PrincipalFromContext(request.Context())
	if !ok {
		httpx.WriteError(writer, request, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication is required.")
		return
	}
	projectID, ok := parsePathUUID(writer, request, "projectId")
	if !ok {
		return
	}
	keys, _, err := handler.keys.ListForUser(request.Context(), principal.UserID, projectID)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	status, err := handler.status.GetConnectionStatus(request.Context(), projectID)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	keyConfigured := false
	for _, key := range keys {
		if key.RevokedAt == nil {
			keyConfigured = true
			break
		}
	}
	response := connectionStatusResponse{
		KeyConfigured:        keyConfigured,
		LastSDKSeenAt:        formatConnectionTime(status.LastSDKSeenAt),
		LastEventReceivedAt:  formatConnectionTime(status.LastEventReceivedAt),
		LastEventQueryableAt: formatConnectionTime(status.LastEventQueryableAt),
		LastRejectAt:         formatConnectionTime(status.LastRejectAt),
	}
	if status.LastRejectReason != nil {
		value := string(*status.LastRejectReason)
		response.LastRejectReason = &value
	}
	writeJSON(writer, http.StatusOK, response)
}

func formatConnectionTime(value *time.Time) *string {
	if value == nil {
		return nil
	}
	formatted := value.UTC().Format(timeFormat)
	return &formatted
}
