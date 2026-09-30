package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"openrum/internal/auth"
	"openrum/internal/httpx"
	"openrum/internal/metadata"
	"openrum/internal/notify"
)

type ChannelHandler struct {
	alerts        *metadata.AlertRepository
	organizations *metadata.OrganizationRepository
	logger        zerolog.Logger
	// resolver checks webhook hosts against private addresses; nil uses the system resolver.
	resolver notify.IPResolver
	now      func() time.Time
}

// channelRequest carries kind-specific settings as a flat map. Secret fields are
// write-only: they are never returned, and a blank value on update keeps the stored one.
type channelRequest struct {
	Name     *string           `json:"name"`
	Kind     string            `json:"kind"`
	Enabled  *bool             `json:"enabled"`
	Settings map[string]string `json:"settings"`
}

type channelResponse struct {
	ID             string               `json:"id"`
	OrganizationID string               `json:"organizationId"`
	Name           string               `json:"name"`
	Kind           metadata.ChannelKind `json:"kind"`
	Enabled        bool                 `json:"enabled"`
	RuleCount      int                  `json:"ruleCount"`
	CreatedAt      string               `json:"createdAt"`
}

type channelTestResponse struct {
	Delivered bool   `json:"delivered"`
	ErrorCode string `json:"errorCode,omitempty"`
}

func NewChannelHandler(
	alerts *metadata.AlertRepository,
	organizations *metadata.OrganizationRepository,
	logger zerolog.Logger,
) *ChannelHandler {
	return &ChannelHandler{alerts: alerts, organizations: organizations, logger: logger, now: time.Now}
}

func (handler *ChannelHandler) List(writer http.ResponseWriter, request *http.Request) {
	principal, organizationID, ok := principalAndOrganization(writer, request)
	if !ok {
		return
	}
	access, err := handler.organizations.GetForUser(request.Context(), principal.UserID, organizationID)
	if err != nil {
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
	writeJSON(writer, http.StatusOK, map[string]any{
		"channels": response, "canManage": auth.Can(access.Role, auth.ActionManageChannels),
	})
}

func (handler *ChannelHandler) authorize(writer http.ResponseWriter, request *http.Request) (auth.Principal, uuid.UUID, bool) {
	principal, organizationID, ok := principalAndOrganization(writer, request)
	if !ok {
		return principal, organizationID, false
	}
	access, err := handler.organizations.GetForUser(request.Context(), principal.UserID, organizationID)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return principal, organizationID, false
	}
	if err := auth.Authorize(access.Role, auth.ActionManageChannels); err != nil {
		writeControlPlaneError(writer, request, handler.logger, errors.Join(metadata.ErrForbidden, err))
		return principal, organizationID, false
	}
	return principal, organizationID, true
}

func (handler *ChannelHandler) Create(writer http.ResponseWriter, request *http.Request) {
	principal, organizationID, ok := handler.authorize(writer, request)
	if !ok {
		return
	}
	var payload channelRequest
	if !decodeJSONBody(writer, request, &payload) {
		return
	}
	spec, known := notify.LookupKind(payload.Kind)
	if !known || payload.Name == nil {
		writeChannelValidationError(writer, request)
		return
	}
	config, err := normalizeChannel(request.Context(), spec, payload.Settings, nil, handler.resolver)
	if err != nil {
		writeChannelValidationError(writer, request)
		return
	}
	channel, err := handler.alerts.CreateChannel(request.Context(), principal.UserID, organizationID,
		strings.TrimSpace(*payload.Name), metadata.ChannelKind(payload.Kind), config)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	if payload.Enabled != nil && !*payload.Enabled {
		disabled := false
		if channel, err = handler.alerts.UpdateChannel(request.Context(), principal.UserID, organizationID, channel.ID,
			metadata.UpdateChannelInput{Enabled: &disabled}); err != nil {
			writeControlPlaneError(writer, request, handler.logger, err)
			return
		}
	}
	writeJSON(writer, http.StatusCreated, channelDTO(channel))
}

func (handler *ChannelHandler) Update(writer http.ResponseWriter, request *http.Request) {
	principal, organizationID, ok := handler.authorize(writer, request)
	if !ok {
		return
	}
	channelID, ok := parsePathUUID(writer, request, "channelId")
	if !ok {
		return
	}
	var payload channelRequest
	if !decodeJSONBody(writer, request, &payload) {
		return
	}
	input := metadata.UpdateChannelInput{Name: payload.Name, Enabled: payload.Enabled}
	if len(payload.Settings) > 0 {
		current, previous, err := handler.alerts.OpenManagedChannel(request.Context(), principal.UserID, organizationID, channelID)
		if err != nil {
			writeControlPlaneError(writer, request, handler.logger, err)
			return
		}
		spec, known := notify.LookupKind(string(current.Kind))
		if !known {
			writeChannelValidationError(writer, request)
			return
		}
		config, err := normalizeChannel(request.Context(), spec, payload.Settings, previous, handler.resolver)
		if err != nil {
			writeChannelValidationError(writer, request)
			return
		}
		input.Config = config
	}
	channel, err := handler.alerts.UpdateChannel(request.Context(), principal.UserID, organizationID, channelID, input)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	writeJSON(writer, http.StatusOK, channelDTO(channel))
}

func (handler *ChannelHandler) Delete(writer http.ResponseWriter, request *http.Request) {
	principal, organizationID, ok := handler.authorize(writer, request)
	if !ok {
		return
	}
	channelID, ok := parsePathUUID(writer, request, "channelId")
	if !ok {
		return
	}
	if err := handler.alerts.DeleteChannel(request.Context(), principal.UserID, organizationID, channelID); err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

// Test sends a test message through the stored config and logs the outcome. A failed
// delivery is a normal 200 answer with its code, so the Console can explain it.
func (handler *ChannelHandler) Test(writer http.ResponseWriter, request *http.Request) {
	principal, organizationID, ok := handler.authorize(writer, request)
	if !ok {
		return
	}
	channelID, ok := parsePathUUID(writer, request, "channelId")
	if !ok {
		return
	}
	channel, config, err := handler.alerts.OpenManagedChannel(request.Context(), principal.UserID, organizationID, channelID)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	sendErr := errors.New("channel kind has no delivery")
	if spec, known := notify.LookupKind(string(channel.Kind)); known {
		var notifier notify.Notifier
		if notifier, sendErr = spec.Build(config, handler.resolver); sendErr == nil {
			ctx, cancel := context.WithTimeout(request.Context(), 20*time.Second)
			sendErr = notifier.Send(ctx, notify.Notification{
				ID: uuid.NewString(), Kind: notify.NotificationTest, Title: "测试消息",
				Message:    "这是一条来自 OpenRUM 的测试消息。收到它说明渠道「" + channel.Name + "」配置正确。",
				Severity:   "info",
				OccurredAt: handler.now().UTC(),
			})
			cancel()
		}
	}
	code := ""
	if sendErr != nil {
		code = notify.ErrorCode(sendErr)
	}
	if err := handler.alerts.RecordTestDelivery(request.Context(), principal.UserID, organizationID, channelID, sendErr, code); err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	writeJSON(writer, http.StatusOK, channelTestResponse{Delivered: sendErr == nil, ErrorCode: code})
}

func normalizeChannel(ctx context.Context, spec notify.KindSpec, settings, previous map[string]string, resolver notify.IPResolver) (json.RawMessage, error) {
	if settings == nil {
		settings = map[string]string{}
	}
	for key, value := range settings {
		if len(key) > 64 || len(value) > 4096 {
			return nil, notify.ErrInvalidChannelConfig
		}
	}
	config, err := spec.Normalize(ctx, settings, previous, resolver)
	if err != nil {
		return nil, err
	}
	return json.Marshal(config)
}

func writeChannelValidationError(writer http.ResponseWriter, request *http.Request) {
	httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR",
		"Channel settings are invalid. Use a public HTTPS address of the right kind.")
}

func channelDTO(channel metadata.NotificationChannel) channelResponse {
	return channelResponse{
		ID: channel.ID.String(), OrganizationID: channel.OrganizationID.String(), Name: channel.Name,
		Kind: channel.Kind, Enabled: channel.Enabled, RuleCount: channel.RuleCount,
		CreatedAt: channel.CreatedAt.UTC().Format(timeFormat),
	}
}
