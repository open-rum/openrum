package handlers

import (
	"errors"
	"net/http"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"openrum/internal/auth"
	"openrum/internal/metadata"
)

type AlertHandler struct {
	alerts *metadata.AlertRepository
	logger zerolog.Logger
}

type createAlertRuleRequest struct {
	Name            string               `json:"name"`
	Metric          metadata.AlertMetric `json:"metric"`
	Comparator      string               `json:"comparator"`
	Threshold       float64              `json:"threshold"`
	WindowMinutes   int16                `json:"windowMinutes"`
	CooldownMinutes int16                `json:"cooldownMinutes"`
	Environment     string               `json:"environment"`
	Enabled         *bool                `json:"enabled"`
	ChannelIDs      []string             `json:"channelIds"`
}

type updateAlertRuleRequest struct {
	Name            *string               `json:"name"`
	Metric          *metadata.AlertMetric `json:"metric"`
	Comparator      *string               `json:"comparator"`
	Threshold       *float64              `json:"threshold"`
	WindowMinutes   *int16                `json:"windowMinutes"`
	CooldownMinutes *int16                `json:"cooldownMinutes"`
	Environment     *string               `json:"environment"`
	Enabled         *bool                 `json:"enabled"`
	ChannelIDs      *[]string             `json:"channelIds"`
}

type alertRuleResponse struct {
	ID              string               `json:"id"`
	ProjectID       string               `json:"projectId"`
	Name            string               `json:"name"`
	Metric          metadata.AlertMetric `json:"metric"`
	Comparator      string               `json:"comparator"`
	Threshold       float64              `json:"threshold"`
	WindowMinutes   int16                `json:"windowMinutes"`
	CooldownMinutes int16                `json:"cooldownMinutes"`
	Environment     string               `json:"environment"`
	Enabled         bool                 `json:"enabled"`
	ChannelIDs      []string             `json:"channelIds"`
	LastStatus      string               `json:"lastStatus"`
	LastEvaluatedAt *string              `json:"lastEvaluatedAt,omitempty"`
}

type alertNotificationResponse struct {
	ID          string                   `json:"id"`
	RuleID      string                   `json:"ruleId"`
	Title       string                   `json:"title"`
	Metric      metadata.AlertMetric     `json:"metric"`
	Comparator  string                   `json:"comparator"`
	Environment string                   `json:"environment"`
	Value       float64                  `json:"value"`
	Threshold   float64                  `json:"threshold"`
	OccurredAt  string                   `json:"occurredAt"`
	DeepLink    string                   `json:"deepLink"`
	Status      string                   `json:"status"`
	Delivery    string                   `json:"delivery"`
	Deliveries  []metadata.AlertDelivery `json:"deliveries"`
}

func NewAlertHandler(alerts *metadata.AlertRepository, logger zerolog.Logger) *AlertHandler {
	return &AlertHandler{alerts: alerts, logger: logger}
}

func (handler *AlertHandler) List(writer http.ResponseWriter, request *http.Request) {
	principal, projectID, ok := principalAndProject(writer, request)
	if !ok {
		return
	}
	rules, role, err := handler.alerts.ListRules(request.Context(), principal.UserID, projectID)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	if err := auth.Authorize(role, auth.ActionReadProject); err != nil {
		writeControlPlaneError(writer, request, handler.logger, errors.Join(metadata.ErrForbidden, err))
		return
	}
	notifications, err := handler.alerts.ListNotifications(request.Context(), principal.UserID, projectID, 100)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	ruleDTOs := make([]alertRuleResponse, 0, len(rules))
	for _, rule := range rules {
		ruleDTOs = append(ruleDTOs, alertRuleDTO(rule))
	}
	notificationDTOs := make([]alertNotificationResponse, 0, len(notifications))
	for _, notification := range notifications {
		notificationDTOs = append(notificationDTOs, alertNotificationDTO(notification))
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"rules": ruleDTOs, "notifications": notificationDTOs, "canManage": auth.Can(role, auth.ActionManageAlerts),
	})
}

func (handler *AlertHandler) Create(writer http.ResponseWriter, request *http.Request) {
	principal, projectID, ok := principalAndProject(writer, request)
	if !ok {
		return
	}
	var payload createAlertRuleRequest
	if !decodeJSONBody(writer, request, &payload) {
		return
	}
	channels, valid := parseChannelIDs(payload.ChannelIDs)
	if !valid {
		writeControlPlaneError(writer, request, handler.logger, metadata.ErrInvalidAlertConfig)
		return
	}
	enabled := true
	if payload.Enabled != nil {
		enabled = *payload.Enabled
	}
	rule, err := handler.alerts.CreateRule(request.Context(), principal.UserID, projectID, metadata.CreateAlertRuleInput{
		Name: payload.Name, Metric: payload.Metric, Comparator: payload.Comparator, Threshold: payload.Threshold,
		WindowMinutes: payload.WindowMinutes, CooldownMinutes: payload.CooldownMinutes,
		Environment: payload.Environment, Enabled: enabled, ChannelIDs: channels,
	})
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	writeJSON(writer, http.StatusCreated, alertRuleDTO(rule))
}

func (handler *AlertHandler) Update(writer http.ResponseWriter, request *http.Request) {
	principal, projectID, ok := principalAndProject(writer, request)
	if !ok {
		return
	}
	ruleID, ok := parsePathUUID(writer, request, "ruleId")
	if !ok {
		return
	}
	var payload updateAlertRuleRequest
	if !decodeJSONBody(writer, request, &payload) {
		return
	}
	input := metadata.UpdateAlertRuleInput{
		Name: payload.Name, Metric: payload.Metric, Comparator: payload.Comparator, Threshold: payload.Threshold,
		WindowMinutes: payload.WindowMinutes, CooldownMinutes: payload.CooldownMinutes,
		Environment: payload.Environment, Enabled: payload.Enabled,
	}
	if payload.ChannelIDs != nil {
		channels, valid := parseChannelIDs(*payload.ChannelIDs)
		if !valid {
			writeControlPlaneError(writer, request, handler.logger, metadata.ErrInvalidAlertConfig)
			return
		}
		input.ChannelIDs = &channels
	}
	rule, err := handler.alerts.UpdateRule(request.Context(), principal.UserID, projectID, ruleID, input)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	writeJSON(writer, http.StatusOK, alertRuleDTO(rule))
}

func (handler *AlertHandler) Delete(writer http.ResponseWriter, request *http.Request) {
	principal, projectID, ok := principalAndProject(writer, request)
	if !ok {
		return
	}
	ruleID, ok := parsePathUUID(writer, request, "ruleId")
	if !ok {
		return
	}
	if err := handler.alerts.DeleteRule(request.Context(), principal.UserID, projectID, ruleID); err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

func parseChannelIDs(values []string) ([]uuid.UUID, bool) {
	result := make([]uuid.UUID, 0, len(values))
	for _, value := range values {
		id, err := uuid.Parse(value)
		if err != nil {
			return nil, false
		}
		result = append(result, id)
	}
	return result, true
}

func alertRuleDTO(rule metadata.AlertRule) alertRuleResponse {
	channels := make([]string, 0, len(rule.ChannelIDs))
	for _, id := range rule.ChannelIDs {
		channels = append(channels, id.String())
	}
	response := alertRuleResponse{
		ID: rule.ID.String(), ProjectID: rule.ProjectID.String(), Name: rule.Name, Metric: rule.Metric,
		Comparator: rule.Comparator, Threshold: rule.Threshold, WindowMinutes: rule.WindowMinutes,
		CooldownMinutes: rule.CooldownMinutes, Environment: rule.Environment, Enabled: rule.Enabled,
		ChannelIDs: channels, LastStatus: rule.LastStatus,
	}
	if rule.LastEvaluatedAt != nil {
		at := rule.LastEvaluatedAt.UTC().Format(timeFormat)
		response.LastEvaluatedAt = &at
	}
	return response
}

func alertNotificationDTO(notification metadata.AlertNotification) alertNotificationResponse {
	return alertNotificationResponse{
		ID: notification.ID.String(), RuleID: notification.RuleID.String(), Title: notification.Title,
		Metric: notification.Metric, Comparator: notification.Comparator, Environment: notification.Environment,
		Value: notification.Value, Threshold: notification.Threshold,
		OccurredAt: notification.OccurredAt.UTC().Format(timeFormat),
		DeepLink: metadata.AlertDeepLink(notification.ProjectID, notification.Metric, notification.StartedAt,
			notification.OccurredAt, notification.Environment),
		Status:     notification.Status,
		Delivery:   deliveryState(notification),
		Deliveries: notification.Deliveries,
	}
}

// deliveryState summarizes a notification's channel outcomes for the Console:
// cooldown, no_channels, pending, delivered, partial or failed.
func deliveryState(notification metadata.AlertNotification) string {
	if notification.Status == "suppressed" {
		return "cooldown"
	}
	if len(notification.Deliveries) == 0 {
		if notification.NotifiedAt != nil {
			return "no_channels"
		}
		return "pending"
	}
	sent := 0
	for _, delivery := range notification.Deliveries {
		if delivery.Status == "sent" {
			sent++
		}
	}
	switch {
	case sent == len(notification.Deliveries):
		return "delivered"
	case sent > 0:
		return "partial"
	default:
		return "failed"
	}
}
