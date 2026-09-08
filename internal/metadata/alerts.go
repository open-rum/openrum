package metadata

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
)

type ChannelKind string

var ErrInvalidAlertConfig = errors.New("invalid alert configuration")

// ErrSecretsUnavailable is returned when a notification channel cannot be
// stored because the Instance has no master key configured. Distinguishing it
// from ErrInvalidAlertConfig matters: the caller's input was fine, the
// deployment is missing OPENRUM_ALLOW_MANAGED_SECRETS and OPENRUM_MASTER_KEY.
var ErrSecretsUnavailable = errors.New("managed secrets are not configured")

const (
	ChannelSMTP    ChannelKind = "smtp"
	ChannelWebhook ChannelKind = "webhook"
)

type AlertMetric string

const (
	AlertErrorCount     AlertMetric = "error_count"
	AlertErrorRate      AlertMetric = "error_rate"
	AlertAPIFailureRate AlertMetric = "api_failure_rate"
	AlertLCPP75         AlertMetric = "lcp_p75"
)

type NotificationChannel struct {
	ID              uuid.UUID   `json:"id"`
	OrganizationID  uuid.UUID   `json:"organizationId"`
	Name            string      `json:"name"`
	Kind            ChannelKind `json:"kind"`
	EncryptionKeyID string      `json:"encryptionKeyId"`
	Enabled         bool        `json:"enabled"`
	CreatedAt       time.Time   `json:"createdAt"`
	UpdatedAt       time.Time   `json:"updatedAt"`
	EncryptedConfig []byte      `json:"-"`
}

type AlertRule struct {
	ID              uuid.UUID   `json:"id"`
	ProjectID       uuid.UUID   `json:"projectId"`
	Name            string      `json:"name"`
	Metric          AlertMetric `json:"metric"`
	Comparator      string      `json:"comparator"`
	Threshold       float64     `json:"threshold"`
	WindowMinutes   int16       `json:"windowMinutes"`
	CooldownMinutes int16       `json:"cooldownMinutes"`
	Environment     string      `json:"environment"`
	Enabled         bool        `json:"enabled"`
	CreatedBy       *uuid.UUID  `json:"createdBy,omitempty"`
	CreatedAt       time.Time   `json:"createdAt"`
	UpdatedAt       time.Time   `json:"updatedAt"`
}

// AlertNotification is a breached evaluation surfaced back to the console. It
// carries the rule's threshold so a notification stays readable after the rule
// has been retuned.
type AlertNotification struct {
	ID         uuid.UUID
	RuleID     uuid.UUID
	ProjectID  uuid.UUID
	Title      string
	Metric     AlertMetric
	Value      float64
	Threshold  float64
	Status     string
	OccurredAt time.Time
}

type CreateAlertRuleInput struct {
	Name            string
	Metric          AlertMetric
	Comparator      string
	Threshold       float64
	WindowMinutes   int16
	CooldownMinutes int16
	Environment     string
	Enabled         bool
}

type EnvelopeCodec interface {
	Seal(plaintext, additionalData []byte) ([]byte, string, error)
	Open(encoded, additionalData []byte) ([]byte, string, error)
	Rotate(encoded, additionalData []byte) ([]byte, string, bool, error)
}

type AlertRepository struct {
	database *sql.DB
	codec    EnvelopeCodec
}

func NewAlertRepository(database *sql.DB, codec EnvelopeCodec) *AlertRepository {
	return &AlertRepository{database: database, codec: codec}
}

// ListRules returns the project's rules along with the caller's role in the
// owning organization. Non-members get ErrNotFound rather than an empty list so
// project existence is not observable across organizations.
func (repository *AlertRepository) ListRules(ctx context.Context, actorID, projectID uuid.UUID) ([]AlertRule, OrganizationRole, error) {
	var role OrganizationRole
	err := repository.database.QueryRowContext(ctx, `SELECT organization_members.role
		FROM projects JOIN organization_members ON organization_members.organization_id=projects.organization_id
		WHERE projects.id=$1 AND organization_members.user_id=$2 AND projects.status!='deleting'`,
		projectID, actorID).Scan(&role)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, "", ErrNotFound
	}
	if err != nil {
		return nil, "", err
	}
	rows, err := repository.database.QueryContext(ctx, `SELECT id,project_id,name,metric,comparator,threshold,
		window_minutes,cooldown_minutes,environment,enabled,created_by,created_at,updated_at
		FROM alert_rules WHERE project_id=$1 ORDER BY created_at, id`, projectID)
	if err != nil {
		return nil, "", err
	}
	defer func() { _ = rows.Close() }()
	rules := make([]AlertRule, 0)
	for rows.Next() {
		var rule AlertRule
		if err := rows.Scan(&rule.ID, &rule.ProjectID, &rule.Name, &rule.Metric, &rule.Comparator,
			&rule.Threshold, &rule.WindowMinutes, &rule.CooldownMinutes, &rule.Environment, &rule.Enabled,
			&rule.CreatedBy, &rule.CreatedAt, &rule.UpdatedAt); err != nil {
			return nil, "", err
		}
		rules = append(rules, rule)
	}
	return rules, role, rows.Err()
}

// ListNotifications returns recent breached evaluations. Suppressed windows are
// excluded because the cooldown already decided they are not worth surfacing.
func (repository *AlertRepository) ListNotifications(ctx context.Context, actorID, projectID uuid.UUID, limit int) ([]AlertNotification, error) {
	if limit < 1 || limit > 200 {
		limit = 50
	}
	rows, err := repository.database.QueryContext(ctx, `SELECT alert_evaluations.id, alert_rules.id, alert_rules.project_id,
		alert_rules.name, alert_rules.metric, coalesce(alert_evaluations.value,0), alert_rules.threshold,
		alert_evaluations.status, alert_evaluations.window_ended_at
		FROM alert_evaluations
		JOIN alert_rules ON alert_rules.id=alert_evaluations.rule_id
		JOIN projects ON projects.id=alert_rules.project_id
		JOIN organization_members ON organization_members.organization_id=projects.organization_id
		WHERE alert_rules.project_id=$1 AND organization_members.user_id=$2 AND alert_evaluations.status='breached'
		ORDER BY alert_evaluations.window_ended_at DESC, alert_evaluations.id
		LIMIT $3`, projectID, actorID, limit)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	notifications := make([]AlertNotification, 0)
	for rows.Next() {
		var notification AlertNotification
		if err := rows.Scan(&notification.ID, &notification.RuleID, &notification.ProjectID, &notification.Title,
			&notification.Metric, &notification.Value, &notification.Threshold, &notification.Status,
			&notification.OccurredAt); err != nil {
			return nil, err
		}
		notification.OccurredAt = notification.OccurredAt.UTC()
		notifications = append(notifications, notification)
	}
	return notifications, rows.Err()
}

func (repository *AlertRepository) CreateRule(ctx context.Context, actorID, projectID uuid.UUID, input CreateAlertRuleInput) (AlertRule, error) {
	input.Name = strings.TrimSpace(input.Name)
	if !validAlertRule(input) {
		return AlertRule{}, ErrInvalidAlertConfig
	}
	transaction, err := repository.database.BeginTx(ctx, nil)
	if err != nil {
		return AlertRule{}, err
	}
	defer func() { _ = transaction.Rollback() }()
	organizationID, err := lockProject(ctx, transaction, actorID, projectID, canManageAlerts)
	if err != nil {
		return AlertRule{}, err
	}
	rule := AlertRule{ID: uuid.New(), ProjectID: projectID}
	err = transaction.QueryRowContext(ctx, `INSERT INTO alert_rules
		(id,project_id,name,metric,comparator,threshold,window_minutes,cooldown_minutes,environment,enabled,created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
		RETURNING name,metric,comparator,threshold,window_minutes,cooldown_minutes,environment,enabled,created_by,
		          created_at,updated_at`,
		rule.ID, projectID, input.Name, input.Metric, input.Comparator, input.Threshold, input.WindowMinutes,
		input.CooldownMinutes, input.Environment, input.Enabled, actorID,
	).Scan(&rule.Name, &rule.Metric, &rule.Comparator, &rule.Threshold, &rule.WindowMinutes, &rule.CooldownMinutes,
		&rule.Environment, &rule.Enabled, &rule.CreatedBy, &rule.CreatedAt, &rule.UpdatedAt)
	if err != nil {
		return AlertRule{}, translateConstraintError(err)
	}
	if err := insertAudit(ctx, transaction, organizationID, actorID, "alert_rule.created", "alert_rule", rule.ID); err != nil {
		return AlertRule{}, err
	}
	if err := transaction.Commit(); err != nil {
		return AlertRule{}, err
	}
	return rule, nil
}

func (repository *AlertRepository) ListChannels(ctx context.Context, actorID, organizationID uuid.UUID) ([]NotificationChannel, error) {
	rows, err := repository.database.QueryContext(ctx, `SELECT c.id,c.organization_id,c.name,c.kind,
		c.encryption_key_id,c.enabled,c.created_at,c.updated_at
		FROM notification_channels c
		JOIN organization_members m ON m.organization_id=c.organization_id
		WHERE c.organization_id=$1 AND m.user_id=$2
		ORDER BY c.created_at DESC, c.id`, organizationID, actorID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	channels := make([]NotificationChannel, 0)
	for rows.Next() {
		var channel NotificationChannel
		if err := rows.Scan(&channel.ID, &channel.OrganizationID, &channel.Name, &channel.Kind,
			&channel.EncryptionKeyID, &channel.Enabled, &channel.CreatedAt, &channel.UpdatedAt); err != nil {
			return nil, err
		}
		channels = append(channels, channel)
	}
	return channels, rows.Err()
}

// validAlertRule mirrors the CHECK constraints on alert_rules so a bad rule is
// rejected as a validation error instead of surfacing as a constraint failure.
func validAlertRule(input CreateAlertRuleInput) bool {
	switch input.Metric {
	case AlertErrorCount, AlertErrorRate, AlertAPIFailureRate, AlertLCPP75:
	default:
		return false
	}
	switch input.WindowMinutes {
	case 5, 10, 15, 30, 60:
	default:
		return false
	}
	if input.Comparator != "gt" && input.Comparator != "gte" {
		return false
	}
	if input.Name == "" || len(input.Name) > 120 {
		return false
	}
	if math.IsNaN(input.Threshold) || input.Threshold < 0 || input.Threshold >= 1e12 {
		return false
	}
	if input.CooldownMinutes < 5 || input.CooldownMinutes > 1440 {
		return false
	}
	return input.Environment == "" || alertEnvironmentPattern.MatchString(input.Environment)
}

var alertEnvironmentPattern = regexp.MustCompile(`^[a-z][a-z0-9_-]{0,63}$`)

func (repository *AlertRepository) CreateChannel(ctx context.Context, actorID, organizationID uuid.UUID, name string, kind ChannelKind, config json.RawMessage) (NotificationChannel, error) {
	name = strings.TrimSpace(name)
	if repository.codec == nil {
		return NotificationChannel{}, ErrSecretsUnavailable
	}
	if name == "" || len(name) > 120 || (kind != ChannelSMTP && kind != ChannelWebhook) || !validChannelConfig(config) {
		return NotificationChannel{}, ErrInvalidAlertConfig
	}
	transaction, err := repository.database.BeginTx(ctx, nil)
	if err != nil {
		return NotificationChannel{}, err
	}
	defer func() { _ = transaction.Rollback() }()
	if err := lockOrganization(ctx, transaction, organizationID); err != nil {
		return NotificationChannel{}, err
	}
	role, err := lockMembership(ctx, transaction, organizationID, actorID)
	if err != nil {
		return NotificationChannel{}, err
	}
	if !canManageProjectSettings(role) {
		return NotificationChannel{}, ErrForbidden
	}
	channel := NotificationChannel{ID: uuid.New(), OrganizationID: organizationID, Name: name, Kind: kind, Enabled: true}
	encrypted, keyID, err := repository.codec.Seal(config, channelAAD(channel.ID))
	if err != nil {
		return NotificationChannel{}, fmt.Errorf("encrypt notification channel: %w", err)
	}
	err = transaction.QueryRowContext(ctx, `INSERT INTO notification_channels
		(id,organization_id,name,kind,encrypted_config,encryption_key_id)
		VALUES ($1,$2,$3,$4,$5,$6) RETURNING created_at,updated_at`, channel.ID, organizationID, name,
		kind, encrypted, keyID).Scan(&channel.CreatedAt, &channel.UpdatedAt)
	if err != nil {
		return NotificationChannel{}, translateConstraintError(err)
	}
	channel.EncryptionKeyID, channel.EncryptedConfig = keyID, encrypted
	if err := insertAudit(ctx, transaction, organizationID, actorID, "notification_channel.created", "notification_channel", channel.ID); err != nil {
		return NotificationChannel{}, err
	}
	if err := transaction.Commit(); err != nil {
		return NotificationChannel{}, err
	}
	return channel, nil
}

func (repository *AlertRepository) OpenChannelConfig(ctx context.Context, actorID, channelID uuid.UUID) (json.RawMessage, error) {
	var organizationID uuid.UUID
	var encrypted []byte
	err := repository.database.QueryRowContext(ctx, `SELECT c.organization_id,c.encrypted_config
		FROM notification_channels c JOIN organization_members m ON m.organization_id=c.organization_id
		WHERE c.id=$1 AND m.user_id=$2`, channelID, actorID).Scan(&organizationID, &encrypted)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	plaintext, _, err := repository.codec.Open(encrypted, channelAAD(channelID))
	if err != nil {
		return nil, fmt.Errorf("decrypt notification channel: %w", err)
	}
	return json.RawMessage(plaintext), nil
}

func (repository *AlertRepository) RotateChannelConfig(ctx context.Context, channelID uuid.UUID) (bool, error) {
	transaction, err := repository.database.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer func() { _ = transaction.Rollback() }()
	var encrypted []byte
	if err := transaction.QueryRowContext(ctx, "SELECT encrypted_config FROM notification_channels WHERE id=$1 FOR UPDATE", channelID).Scan(&encrypted); errors.Is(err, sql.ErrNoRows) {
		return false, ErrNotFound
	} else if err != nil {
		return false, err
	}
	rotated, keyID, changed, err := repository.codec.Rotate(encrypted, channelAAD(channelID))
	if err != nil || !changed {
		return changed, err
	}
	if _, err := transaction.ExecContext(ctx, `UPDATE notification_channels SET encrypted_config=$1,
		encryption_key_id=$2,updated_at=now() WHERE id=$3`, rotated, keyID, channelID); err != nil {
		return false, err
	}
	return true, transaction.Commit()
}

func validChannelConfig(value json.RawMessage) bool {
	if len(value) < 2 || len(value) > 12<<10 {
		return false
	}
	var object map[string]any
	return json.Unmarshal(value, &object) == nil && object != nil
}

func channelAAD(id uuid.UUID) []byte { return []byte("openrum:notification-channel:" + id.String()) }
