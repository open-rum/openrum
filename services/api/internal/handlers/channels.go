package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"

	"github.com/rs/zerolog"

	"openrum/internal/auth"
	"openrum/internal/httpx"
	"openrum/internal/metadata"
)

type ChannelHandler struct {
	alerts        *metadata.AlertRepository
	organizations *metadata.OrganizationRepository
	logger        zerolog.Logger
}

type createChannelRequest struct {
	Name   string               `json:"name"`
	Kind   metadata.ChannelKind `json:"kind"`
	URL    string               `json:"url"`
	Secret string               `json:"secret"`
}

type channelResponse struct {
	ID             string               `json:"id"`
	OrganizationID string               `json:"organizationId"`
	Name           string               `json:"name"`
	Kind           metadata.ChannelKind `json:"kind"`
	Enabled        bool                 `json:"enabled"`
	CreatedAt      string               `json:"createdAt"`
}

func NewChannelHandler(
	alerts *metadata.AlertRepository,
	organizations *metadata.OrganizationRepository,
	logger zerolog.Logger,
) *ChannelHandler {
	return &ChannelHandler{alerts: alerts, organizations: organizations, logger: logger}
}

func (handler *ChannelHandler) List(writer http.ResponseWriter, request *http.Request) {
	principal, organizationID, ok := principalAndOrganization(writer, request)
	if !ok {
		return
	}
	if _, err := handler.organizations.GetForUser(request.Context(), principal.UserID, organizationID); err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	channels, err := handler.alerts.ListChannels(request.Context(), principal.UserID, organizationID)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	response := make([]channelResponse, 0, len(channels))
	for _, channel := range channels {
		response = append(response, channelDTO(channel))
	}
	writeJSON(writer, http.StatusOK, map[string]any{"channels": response})
}

func (handler *ChannelHandler) Create(writer http.ResponseWriter, request *http.Request) {
	principal, organizationID, ok := principalAndOrganization(writer, request)
	if !ok {
		return
	}
	var payload createChannelRequest
	if !decodeJSONBody(writer, request, &payload) {
		return
	}
	access, err := handler.organizations.GetForUser(request.Context(), principal.UserID, organizationID)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	if err := auth.Authorize(access.Role, auth.ActionManageAlerts); err != nil {
		writeControlPlaneError(writer, request, handler.logger, errors.Join(metadata.ErrForbidden, err))
		return
	}
	config, valid := webhookChannelConfig(payload)
	if !valid {
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "Channel settings are invalid.")
		return
	}
	channel, err := handler.alerts.CreateChannel(request.Context(), principal.UserID, organizationID,
		strings.TrimSpace(payload.Name), payload.Kind, config)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	writeJSON(writer, http.StatusCreated, channelDTO(channel))
}

// webhookChannelConfig builds the plaintext config the repository will encrypt.
// Only webhooks are accepted for now: SMTP has no delivery implementation, so
// storing SMTP credentials would create a secret with nothing to use it.
func webhookChannelConfig(payload createChannelRequest) (json.RawMessage, bool) {
	if payload.Kind != metadata.ChannelWebhook {
		return nil, false
	}
	name := strings.TrimSpace(payload.Name)
	endpoint := strings.TrimSpace(payload.URL)
	secret := strings.TrimSpace(payload.Secret)
	if name == "" || len(name) > 120 || len(secret) < 16 || len(secret) > 256 {
		return nil, false
	}
	parsed, err := url.Parse(endpoint)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil {
		return nil, false
	}
	config, err := json.Marshal(map[string]string{"url": parsed.String(), "secret": secret})
	if err != nil {
		return nil, false
	}
	return config, true
}

func channelDTO(channel metadata.NotificationChannel) channelResponse {
	return channelResponse{
		ID: channel.ID.String(), OrganizationID: channel.OrganizationID.String(), Name: channel.Name,
		Kind: channel.Kind, Enabled: channel.Enabled, CreatedAt: channel.CreatedAt.UTC().Format(timeFormat),
	}
}
