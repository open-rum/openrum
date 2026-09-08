package handlers

import (
	"errors"
	"fmt"
	"net/http"
	"net/url"

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
}

type alertNotificationResponse struct {
	ID         string  `json:"id"`
	RuleID     string  `json:"ruleId"`
	Title      string  `json:"title"`
	Value      float64 `json:"value"`
	Threshold  float64 `json:"threshold"`
	OccurredAt string  `json:"occurredAt"`
	DeepLink   string  `json:"deepLink"`
	Status     string  `json:"status"`
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
	notifications, err := handler.alerts.ListNotifications(request.Context(), principal.UserID, projectID, 50)
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
	writeJSON(writer, http.StatusOK, map[string]any{"rules": ruleDTOs, "notifications": notificationDTOs})
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
	enabled := true
	if payload.Enabled != nil {
		enabled = *payload.Enabled
	}
	rule, err := handler.alerts.CreateRule(request.Context(), principal.UserID, projectID, metadata.CreateAlertRuleInput{
		Name: payload.Name, Metric: payload.Metric, Comparator: payload.Comparator, Threshold: payload.Threshold,
		WindowMinutes: payload.WindowMinutes, CooldownMinutes: payload.CooldownMinutes,
		Environment: payload.Environment, Enabled: enabled,
	})
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	writeJSON(writer, http.StatusCreated, alertRuleDTO(rule))
}

func alertRuleDTO(rule metadata.AlertRule) alertRuleResponse {
	return alertRuleResponse{
		ID: rule.ID.String(), ProjectID: rule.ProjectID.String(), Name: rule.Name, Metric: rule.Metric,
		Comparator: rule.Comparator, Threshold: rule.Threshold, WindowMinutes: rule.WindowMinutes,
		CooldownMinutes: rule.CooldownMinutes, Environment: rule.Environment, Enabled: rule.Enabled,
	}
}

func alertNotificationDTO(notification metadata.AlertNotification) alertNotificationResponse {
	return alertNotificationResponse{
		ID: notification.ID.String(), RuleID: notification.RuleID.String(), Title: notification.Title,
		Value: notification.Value, Threshold: notification.Threshold,
		OccurredAt: notification.OccurredAt.UTC().Format(timeFormat),
		DeepLink:   alertDeepLink(notification),
		Status:     notification.Status,
	}
}

// alertDeepLink points at the console page that can explain the breach, keeping
// the environment filter so the landing view matches the rule that fired.
func alertDeepLink(notification metadata.AlertNotification) string {
	page := "overview"
	switch notification.Metric {
	case metadata.AlertErrorCount, metadata.AlertErrorRate:
		page = "issues"
	case metadata.AlertAPIFailureRate:
		page = "apis"
	case metadata.AlertLCPP75:
		page = "performance"
	}
	link := fmt.Sprintf("/projects/%s/%s", notification.ProjectID.String(), page)
	query := url.Values{"to": {notification.OccurredAt.UTC().Format(timeFormat)}}
	return link + "?" + query.Encode()
}
