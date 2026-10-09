package internal

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"openrum/internal/metadata"
	"openrum/internal/notify"
)

// maxDeliveryAttempts bounds how often one breached window is retried when every
// channel failed. It is counted from the delivery log, per channel.
const maxDeliveryAttempts = 3

// DeliveryTarget is one enabled channel a rule notifies, with its sealed config.
type DeliveryTarget struct {
	ChannelID       uuid.UUID
	Name            string
	Kind            string
	EncryptedConfig []byte
}

type AlertDeliveryStore interface {
	DeliveryTargets(ctx context.Context, ruleID uuid.UUID) ([]DeliveryTarget, error)
	EvaluationID(ctx context.Context, ruleID uuid.UUID, window AlertWindow) (uuid.UUID, error)
	ProjectName(ctx context.Context, projectID uuid.UUID) (string, error)
	RecordDelivery(ctx context.Context, evaluationID, ruleID, channelID uuid.UUID, sendErr error, code string) error
}

// ChannelOpener decrypts channel configs; it is the Instance keyring.
type ChannelOpener interface {
	Open(encoded, additionalData []byte) ([]byte, string, error)
}

// ChannelDispatcher delivers a breached window to the rule's enabled channels and
// logs every outcome. It succeeds when at least one channel accepted the alert, or
// when the rule has no channels at all (the breach then lives in the Console only).
type ChannelDispatcher struct {
	store    AlertDeliveryStore
	opener   ChannelOpener
	resolver notify.IPResolver
	baseURL  string
	warn     func(string)
	warned   sync.Once
	build    func(kind string, config map[string]string, resolver notify.IPResolver) (notify.Notifier, error)
}

func NewChannelDispatcher(store AlertDeliveryStore, opener ChannelOpener, publicBaseURL *url.URL, warn func(string)) *ChannelDispatcher {
	base := ""
	if publicBaseURL != nil {
		base = strings.TrimRight(publicBaseURL.String(), "/")
	}
	if warn == nil {
		warn = func(string) {}
	}
	return &ChannelDispatcher{store: store, opener: opener, baseURL: base, warn: warn, build: buildNotifier}
}

func buildNotifier(kind string, config map[string]string, resolver notify.IPResolver) (notify.Notifier, error) {
	spec, ok := notify.LookupKind(kind)
	if !ok {
		return nil, &notify.DeliveryError{Code: "kind_unsupported", Err: fmt.Errorf("channel kind %q has no delivery", kind)}
	}
	return spec.Build(config, resolver)
}

func (dispatcher *ChannelDispatcher) Dispatch(ctx context.Context, rule metadata.AlertRule, window AlertWindow, value float64) error {
	targets, err := dispatcher.store.DeliveryTargets(ctx, rule.ID)
	if err != nil {
		return fmt.Errorf("load alert channels: %w", err)
	}
	if len(targets) == 0 {
		return nil
	}
	evaluationID, err := dispatcher.store.EvaluationID(ctx, rule.ID, window)
	if err != nil {
		return fmt.Errorf("find alert evaluation: %w", err)
	}
	projectName, err := dispatcher.store.ProjectName(ctx, rule.ProjectID)
	if err != nil {
		return fmt.Errorf("load alert project: %w", err)
	}
	notification := dispatcher.notification(rule, window, value, projectName, evaluationID)
	delivered := false
	var result error
	for _, target := range targets {
		sendErr := dispatcher.send(ctx, target, notification)
		code := ""
		if sendErr != nil {
			code = notify.ErrorCode(sendErr)
			result = errors.Join(result, fmt.Errorf("channel %s: %w", target.ChannelID, sendErr))
		} else {
			delivered = true
		}
		if err := dispatcher.store.RecordDelivery(ctx, evaluationID, rule.ID, target.ChannelID, sendErr, code); err != nil {
			result = errors.Join(result, err)
		}
	}
	if delivered {
		return nil
	}
	return fmt.Errorf("no channel accepted alert %s: %w", rule.ID, result)
}

func (dispatcher *ChannelDispatcher) send(ctx context.Context, target DeliveryTarget, notification notify.Notification) error {
	if dispatcher.opener == nil {
		dispatcher.warned.Do(func() {
			dispatcher.warn("alert channels cannot be opened: set OPENRUM_ALLOW_MANAGED_SECRETS and OPENRUM_MASTER_KEY on the worker")
		})
		return &notify.DeliveryError{Code: "secrets_unavailable", Err: errors.New("managed secrets are not configured")}
	}
	plaintext, _, err := dispatcher.opener.Open(target.EncryptedConfig, metadata.ChannelAAD(target.ChannelID))
	if err != nil {
		return &notify.DeliveryError{Code: "decrypt_failed", Err: err}
	}
	config := map[string]string{}
	if err := json.Unmarshal(plaintext, &config); err != nil {
		return &notify.DeliveryError{Code: "config_invalid", Err: err}
	}
	notifier, err := dispatcher.build(target.Kind, config, dispatcher.resolver)
	if err != nil {
		var delivery *notify.DeliveryError
		if errors.As(err, &delivery) {
			return err
		}
		return &notify.DeliveryError{Code: "config_invalid", Err: err}
	}
	sendCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	return notifier.Send(sendCtx, notification)
}

func (dispatcher *ChannelDispatcher) notification(rule metadata.AlertRule, window AlertWindow, value float64, projectName string, evaluationID uuid.UUID) notify.Notification {
	label, unit := metadata.AlertMetricPresentation(rule.Metric)
	link := metadata.AlertDeepLink(rule.ProjectID, rule.Metric, window.StartedAt, window.EndedAt, rule.Environment)
	if dispatcher.baseURL != "" {
		link = dispatcher.baseURL + link
	} else {
		link = ""
	}
	comparator := "≥"
	if rule.Comparator == "gt" {
		comparator = ">"
	}
	return notify.Notification{
		ID: evaluationID.String(), Kind: notify.NotificationAlert, Title: rule.Name,
		Message:  fmt.Sprintf("%s %s 阈值（最近 %d 分钟）", label, comparator, rule.WindowMinutes),
		Severity: "critical", ProjectID: rule.ProjectID.String(), DeepLink: link, OccurredAt: window.EndedAt.UTC(),
		Alert: &notify.AlertContext{
			RuleName: rule.Name, ProjectName: projectName, Environment: rule.Environment, Metric: string(rule.Metric),
			MetricLabel: label, Comparator: rule.Comparator, Value: value, Threshold: rule.Threshold, Unit: unit,
			WindowMinutes: int(rule.WindowMinutes),
		},
	}
}

func (store *PostgresAlertStore) DeliveryTargets(ctx context.Context, ruleID uuid.UUID) ([]DeliveryTarget, error) {
	rows, err := store.database.QueryContext(ctx, `SELECT c.id, c.name, c.kind, c.encrypted_config
		FROM alert_rule_channels rc JOIN notification_channels c ON c.id=rc.channel_id
		WHERE rc.rule_id=$1 AND c.enabled ORDER BY rc.created_at, c.id`, ruleID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	targets := make([]DeliveryTarget, 0)
	for rows.Next() {
		var target DeliveryTarget
		if err := rows.Scan(&target.ChannelID, &target.Name, &target.Kind, &target.EncryptedConfig); err != nil {
			return nil, err
		}
		targets = append(targets, target)
	}
	return targets, rows.Err()
}

func (store *PostgresAlertStore) EvaluationID(ctx context.Context, ruleID uuid.UUID, window AlertWindow) (uuid.UUID, error) {
	var id uuid.UUID
	err := store.database.QueryRowContext(ctx, `SELECT id FROM alert_evaluations
		WHERE rule_id=$1 AND window_started_at=$2 AND window_ended_at=$3`, ruleID, window.StartedAt, window.EndedAt).Scan(&id)
	return id, err
}

func (store *PostgresAlertStore) ProjectName(ctx context.Context, projectID uuid.UUID) (string, error) {
	var name string
	err := store.database.QueryRowContext(ctx, "SELECT name FROM projects WHERE id=$1", projectID).Scan(&name)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return name, err
}

func (store *PostgresAlertStore) RecordDelivery(ctx context.Context, evaluationID, ruleID, channelID uuid.UUID, sendErr error, code string) error {
	status := "sent"
	if sendErr != nil {
		status = "failed"
	}
	if len(code) > 64 {
		code = code[:64]
	}
	_, err := store.database.ExecContext(ctx, `INSERT INTO alert_deliveries
		(evaluation_id, rule_id, channel_id, kind, status, error_code) VALUES ($1,$2,$3,'alert',$4,$5)`,
		evaluationID, ruleID, channelID, status, code)
	return err
}
