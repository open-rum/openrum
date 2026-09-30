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
	ChannelFeishu  ChannelKind = "feishu"
)

// creatableChannelKinds are the kinds with a delivery implementation. SMTP rows may
// exist from earlier versions but new ones are refused until email delivery ships.
var creatableChannelKinds = map[ChannelKind]bool{ChannelWebhook: true, ChannelFeishu: true}

// maxRuleChannels bounds how many channels one rule may notify.
const maxRuleChannels = 10

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
	RuleCount       int         `json:"ruleCount"`
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
	ChannelIDs      []uuid.UUID `json:"channelIds"`
	// LastStatus is the most recent evaluation's status, or "" before the first one.
	LastStatus      string     `json:"lastStatus"`
	LastEvaluatedAt *time.Time `json:"lastEvaluatedAt,omitempty"`
	CreatedBy       *uuid.UUID `json:"createdBy,omitempty"`
	CreatedAt       time.Time  `json:"createdAt"`
	UpdatedAt       time.Time  `json:"updatedAt"`
}

// AlertNotification is a breached evaluation surfaced back to the console. It
// carries the rule's threshold so a notification stays readable after the rule
// has been retuned.
type AlertNotification struct {
	ID          uuid.UUID
	RuleID      uuid.UUID
	ProjectID   uuid.UUID
	Title       string
	Metric      AlertMetric
	Comparator  string
	Environment string
	Value       float64
	Threshold   float64
	// Status is "breached" or "suppressed" (inside the rule's cooldown).
	Status     string
	StartedAt  time.Time
	OccurredAt time.Time
	NotifiedAt *time.Time
	Deliveries []AlertDelivery
}

// AlertDelivery is the latest outcome of one channel for one notification.
type AlertDelivery struct {
	ChannelID   uuid.UUID   `json:"channelId"`
	ChannelName string      `json:"channelName"`
	ChannelKind ChannelKind `json:"channelKind"`
	Status      string      `json:"status"`
	Attempts    int         `json:"attempts"`
	ErrorCode   string      `json:"errorCode,omitempty"`
	At          time.Time   `json:"at"`
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
	ChannelIDs      []uuid.UUID
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
	rows, err := repository.database.QueryContext(ctx, `SELECT r.id,r.project_id,r.name,r.metric,r.comparator,r.threshold,
		r.window_minutes,r.cooldown_minutes,r.environment,r.enabled,r.created_by,r.created_at,r.updated_at,
		coalesce((SELECT string_agg(rc.channel_id::text, ',' ORDER BY rc.created_at, rc.channel_id)
		          FROM alert_rule_channels rc WHERE rc.rule_id=r.id), ''),
		coalesce(last.status,''), last.evaluated_at
		FROM alert_rules r
		LEFT JOIN LATERAL (SELECT status, evaluated_at FROM alert_evaluations
		                   WHERE rule_id=r.id ORDER BY window_ended_at DESC LIMIT 1) last ON true
		WHERE r.project_id=$1 ORDER BY r.created_at, r.id`, projectID)
	if err != nil {
		return nil, "", err
	}
	defer func() { _ = rows.Close() }()
	rules := make([]AlertRule, 0)
	for rows.Next() {
		var rule AlertRule
		var channels string
		var lastEvaluated sql.NullTime
		if err := rows.Scan(&rule.ID, &rule.ProjectID, &rule.Name, &rule.Metric, &rule.Comparator,
			&rule.Threshold, &rule.WindowMinutes, &rule.CooldownMinutes, &rule.Environment, &rule.Enabled,
			&rule.CreatedBy, &rule.CreatedAt, &rule.UpdatedAt, &channels, &rule.LastStatus, &lastEvaluated); err != nil {
			return nil, "", err
		}
		rule.ChannelIDs = parseUUIDList(channels)
		if lastEvaluated.Valid {
			at := lastEvaluated.Time.UTC()
			rule.LastEvaluatedAt = &at
		}
		rules = append(rules, rule)
	}
	return rules, role, rows.Err()
}

// ListNotifications returns recent breached evaluations, including those held back
// by the rule's cooldown, each with the latest outcome of every channel it reached.
func (repository *AlertRepository) ListNotifications(ctx context.Context, actorID, projectID uuid.UUID, limit int) ([]AlertNotification, error) {
	if limit < 1 || limit > 200 {
		limit = 50
	}
	rows, err := repository.database.QueryContext(ctx, `SELECT alert_evaluations.id, alert_rules.id, alert_rules.project_id,
		alert_rules.name, alert_rules.metric, alert_rules.comparator, alert_rules.environment,
		coalesce(alert_evaluations.value,0), alert_rules.threshold, alert_evaluations.status,
		alert_evaluations.window_started_at, alert_evaluations.window_ended_at, alert_evaluations.notified_at
		FROM alert_evaluations
		JOIN alert_rules ON alert_rules.id=alert_evaluations.rule_id
		JOIN projects ON projects.id=alert_rules.project_id
		JOIN organization_members ON organization_members.organization_id=projects.organization_id
		WHERE alert_rules.project_id=$1 AND organization_members.user_id=$2
		  AND alert_evaluations.status IN ('breached','suppressed')
		ORDER BY alert_evaluations.window_ended_at DESC, alert_evaluations.id
		LIMIT $3`, projectID, actorID, limit)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	notifications := make([]AlertNotification, 0)
	ids := make([]string, 0)
	for rows.Next() {
		var notification AlertNotification
		var notified sql.NullTime
		if err := rows.Scan(&notification.ID, &notification.RuleID, &notification.ProjectID, &notification.Title,
			&notification.Metric, &notification.Comparator, &notification.Environment, &notification.Value,
			&notification.Threshold, &notification.Status, &notification.StartedAt, &notification.OccurredAt, &notified); err != nil {
			return nil, err
		}
		notification.StartedAt = notification.StartedAt.UTC()
		notification.OccurredAt = notification.OccurredAt.UTC()
		if notified.Valid {
			at := notified.Time.UTC()
			notification.NotifiedAt = &at
		}
		notification.Deliveries = []AlertDelivery{}
		notifications = append(notifications, notification)
		ids = append(ids, notification.ID.String())
	}
	if err := rows.Err(); err != nil || len(ids) == 0 {
		return notifications, err
	}
	deliveries, err := repository.latestDeliveries(ctx, ids)
	if err != nil {
		return nil, err
	}
	for index := range notifications {
		if found, ok := deliveries[notifications[index].ID]; ok {
			notifications[index].Deliveries = found
		}
	}
	return notifications, nil
}

// latestDeliveries returns, per evaluation, each channel's most recent outcome and how
// many attempts it took.
func (repository *AlertRepository) latestDeliveries(ctx context.Context, evaluationIDs []string) (map[uuid.UUID][]AlertDelivery, error) {
	rows, err := repository.database.QueryContext(ctx, `SELECT DISTINCT ON (d.evaluation_id, d.channel_id)
		d.evaluation_id, d.channel_id, c.name, c.kind, d.status, d.error_code, d.created_at,
		count(*) OVER (PARTITION BY d.evaluation_id, d.channel_id)
		FROM alert_deliveries d JOIN notification_channels c ON c.id=d.channel_id
		WHERE d.evaluation_id::text = ANY(string_to_array($1, ','))
		ORDER BY d.evaluation_id, d.channel_id, d.created_at DESC`, strings.Join(evaluationIDs, ","))
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	result := map[uuid.UUID][]AlertDelivery{}
	for rows.Next() {
		var evaluationID uuid.UUID
		var delivery AlertDelivery
		if err := rows.Scan(&evaluationID, &delivery.ChannelID, &delivery.ChannelName, &delivery.ChannelKind,
			&delivery.Status, &delivery.ErrorCode, &delivery.At, &delivery.Attempts); err != nil {
			return nil, err
		}
		delivery.At = delivery.At.UTC()
		result[evaluationID] = append(result[evaluationID], delivery)
	}
	return result, rows.Err()
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
	if rule.ChannelIDs, err = replaceRuleChannels(ctx, transaction, organizationID, rule.ID, input.ChannelIDs); err != nil {
		return AlertRule{}, err
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
		c.encryption_key_id,c.enabled,c.created_at,c.updated_at,
		(SELECT count(*) FROM alert_rule_channels rc WHERE rc.channel_id=c.id)
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
			&channel.EncryptionKeyID, &channel.Enabled, &channel.CreatedAt, &channel.UpdatedAt, &channel.RuleCount); err != nil {
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
	if name == "" || len(name) > 120 || !creatableChannelKinds[kind] || !validChannelConfig(config) {
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

// ChannelAAD binds an encrypted channel config to its row, so a ciphertext copied
// onto another channel does not decrypt. The worker uses it to open configs.
func ChannelAAD(id uuid.UUID) []byte { return []byte("openrum:notification-channel:" + id.String()) }

func channelAAD(id uuid.UUID) []byte { return ChannelAAD(id) }
