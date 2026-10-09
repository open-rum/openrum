package metadata

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
)

// UpdateAlertRuleInput changes only the fields that are set.
type UpdateAlertRuleInput struct {
	Name            *string
	Metric          *AlertMetric
	Comparator      *string
	Threshold       *float64
	WindowMinutes   *int16
	CooldownMinutes *int16
	Environment     *string
	Enabled         *bool
	ChannelIDs      *[]uuid.UUID
}

// UpdateChannelInput changes only the fields that are set. Config, when present, is
// the complete plaintext config to seal; the caller has already merged write-only
// secrets that were left blank.
type UpdateChannelInput struct {
	Name    *string
	Enabled *bool
	Config  json.RawMessage
}

func (repository *AlertRepository) UpdateRule(ctx context.Context, actorID, projectID, ruleID uuid.UUID, input UpdateAlertRuleInput) (AlertRule, error) {
	transaction, err := repository.database.BeginTx(ctx, nil)
	if err != nil {
		return AlertRule{}, err
	}
	defer func() { _ = transaction.Rollback() }()
	organizationID, err := lockProject(ctx, transaction, actorID, projectID, canManageAlerts)
	if err != nil {
		return AlertRule{}, err
	}
	var rule AlertRule
	err = transaction.QueryRowContext(ctx, `SELECT id,project_id,name,metric,comparator,threshold,window_minutes,
		cooldown_minutes,environment,enabled,created_by,created_at,updated_at
		FROM alert_rules WHERE id=$1 AND project_id=$2 FOR UPDATE`, ruleID, projectID).Scan(
		&rule.ID, &rule.ProjectID, &rule.Name, &rule.Metric, &rule.Comparator, &rule.Threshold, &rule.WindowMinutes,
		&rule.CooldownMinutes, &rule.Environment, &rule.Enabled, &rule.CreatedBy, &rule.CreatedAt, &rule.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return AlertRule{}, ErrNotFound
	}
	if err != nil {
		return AlertRule{}, err
	}
	next := CreateAlertRuleInput{
		Name: rule.Name, Metric: rule.Metric, Comparator: rule.Comparator, Threshold: rule.Threshold,
		WindowMinutes: rule.WindowMinutes, CooldownMinutes: rule.CooldownMinutes, Environment: rule.Environment,
		Enabled: rule.Enabled,
	}
	if input.Name != nil {
		next.Name = strings.TrimSpace(*input.Name)
	}
	if input.Metric != nil {
		next.Metric = *input.Metric
	}
	if input.Comparator != nil {
		next.Comparator = *input.Comparator
	}
	if input.Threshold != nil {
		next.Threshold = *input.Threshold
	}
	if input.WindowMinutes != nil {
		next.WindowMinutes = *input.WindowMinutes
	}
	if input.CooldownMinutes != nil {
		next.CooldownMinutes = *input.CooldownMinutes
	}
	if input.Environment != nil {
		next.Environment = *input.Environment
	}
	if input.Enabled != nil {
		next.Enabled = *input.Enabled
	}
	if !validAlertRule(next) {
		return AlertRule{}, ErrInvalidAlertConfig
	}
	err = transaction.QueryRowContext(ctx, `UPDATE alert_rules SET name=$1,metric=$2,comparator=$3,threshold=$4,
		window_minutes=$5,cooldown_minutes=$6,environment=$7,enabled=$8,updated_at=now()
		WHERE id=$9 RETURNING name,metric,comparator,threshold,window_minutes,cooldown_minutes,environment,enabled,updated_at`,
		next.Name, next.Metric, next.Comparator, next.Threshold, next.WindowMinutes, next.CooldownMinutes,
		next.Environment, next.Enabled, ruleID).Scan(&rule.Name, &rule.Metric, &rule.Comparator, &rule.Threshold,
		&rule.WindowMinutes, &rule.CooldownMinutes, &rule.Environment, &rule.Enabled, &rule.UpdatedAt)
	if err != nil {
		return AlertRule{}, translateConstraintError(err)
	}
	if input.ChannelIDs != nil {
		if rule.ChannelIDs, err = replaceRuleChannels(ctx, transaction, organizationID, ruleID, *input.ChannelIDs); err != nil {
			return AlertRule{}, err
		}
	} else if rule.ChannelIDs, err = ruleChannelIDs(ctx, transaction, ruleID); err != nil {
		return AlertRule{}, err
	}
	if err := insertAudit(ctx, transaction, organizationID, actorID, "alert_rule.updated", "alert_rule", ruleID); err != nil {
		return AlertRule{}, err
	}
	if err := transaction.Commit(); err != nil {
		return AlertRule{}, err
	}
	return rule, nil
}

// DeleteRule removes a rule with its evaluations and delivery log.
func (repository *AlertRepository) DeleteRule(ctx context.Context, actorID, projectID, ruleID uuid.UUID) error {
	transaction, err := repository.database.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = transaction.Rollback() }()
	organizationID, err := lockProject(ctx, transaction, actorID, projectID, canManageAlerts)
	if err != nil {
		return err
	}
	result, err := transaction.ExecContext(ctx, "DELETE FROM alert_rules WHERE id=$1 AND project_id=$2", ruleID, projectID)
	if err != nil {
		return err
	}
	if affected, err := result.RowsAffected(); err != nil || affected == 0 {
		return errors.Join(ErrNotFound, err)
	}
	if err := insertAudit(ctx, transaction, organizationID, actorID, "alert_rule.deleted", "alert_rule", ruleID); err != nil {
		return err
	}
	return transaction.Commit()
}

// replaceRuleChannels sets a rule's channels. Every channel must belong to the rule's
// organization, so a rule can never notify another organization's destination.
func replaceRuleChannels(ctx context.Context, transaction *sql.Tx, organizationID, ruleID uuid.UUID, channelIDs []uuid.UUID) ([]uuid.UUID, error) {
	unique := make([]uuid.UUID, 0, len(channelIDs))
	seen := map[uuid.UUID]bool{}
	for _, id := range channelIDs {
		if !seen[id] {
			seen[id] = true
			unique = append(unique, id)
		}
	}
	if len(unique) > maxRuleChannels {
		return nil, ErrInvalidAlertConfig
	}
	if _, err := transaction.ExecContext(ctx, "DELETE FROM alert_rule_channels WHERE rule_id=$1", ruleID); err != nil {
		return nil, err
	}
	if len(unique) == 0 {
		return []uuid.UUID{}, nil
	}
	texts := make([]string, 0, len(unique))
	for _, id := range unique {
		texts = append(texts, id.String())
	}
	result, err := transaction.ExecContext(ctx, `INSERT INTO alert_rule_channels (rule_id, channel_id)
		SELECT $1, id FROM notification_channels
		WHERE organization_id=$2 AND id::text = ANY(string_to_array($3, ','))`, ruleID, organizationID, strings.Join(texts, ","))
	if err != nil {
		return nil, err
	}
	if affected, err := result.RowsAffected(); err != nil || affected != int64(len(unique)) {
		return nil, errors.Join(ErrInvalidAlertConfig, err)
	}
	return unique, nil
}

func ruleChannelIDs(ctx context.Context, transaction *sql.Tx, ruleID uuid.UUID) ([]uuid.UUID, error) {
	var joined string
	err := transaction.QueryRowContext(ctx, `SELECT coalesce(string_agg(channel_id::text, ',' ORDER BY created_at, channel_id), '')
		FROM alert_rule_channels WHERE rule_id=$1`, ruleID).Scan(&joined)
	return parseUUIDList(joined), err
}

func parseUUIDList(joined string) []uuid.UUID {
	result := make([]uuid.UUID, 0)
	for _, part := range strings.Split(joined, ",") {
		if id, err := uuid.Parse(strings.TrimSpace(part)); err == nil {
			result = append(result, id)
		}
	}
	return result
}

// lockManagedChannel locks a channel for an Owner or Admin of its organization.
func lockManagedChannel(ctx context.Context, transaction *sql.Tx, actorID, organizationID, channelID uuid.UUID) (NotificationChannel, error) {
	role, err := lockMembership(ctx, transaction, organizationID, actorID)
	if err != nil {
		return NotificationChannel{}, err
	}
	if !canManageProjectSettings(role) {
		return NotificationChannel{}, ErrForbidden
	}
	var channel NotificationChannel
	err = transaction.QueryRowContext(ctx, `SELECT id,organization_id,name,kind,encrypted_config,encryption_key_id,
		enabled,created_at,updated_at FROM notification_channels WHERE id=$1 AND organization_id=$2 FOR UPDATE`,
		channelID, organizationID).Scan(&channel.ID, &channel.OrganizationID, &channel.Name, &channel.Kind,
		&channel.EncryptedConfig, &channel.EncryptionKeyID, &channel.Enabled, &channel.CreatedAt, &channel.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return NotificationChannel{}, ErrNotFound
	}
	return channel, err
}

// OpenManagedChannel returns a channel and its decrypted config to an Owner or Admin,
// for merging an update or sending a test. The config never leaves the API.
func (repository *AlertRepository) OpenManagedChannel(ctx context.Context, actorID, organizationID, channelID uuid.UUID) (NotificationChannel, map[string]string, error) {
	if repository.codec == nil {
		return NotificationChannel{}, nil, ErrSecretsUnavailable
	}
	transaction, err := repository.database.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return NotificationChannel{}, nil, err
	}
	defer func() { _ = transaction.Rollback() }()
	role, err := membershipRole(ctx, transaction, organizationID, actorID)
	if err != nil {
		return NotificationChannel{}, nil, err
	}
	if !canManageProjectSettings(role) {
		return NotificationChannel{}, nil, ErrForbidden
	}
	var channel NotificationChannel
	err = transaction.QueryRowContext(ctx, `SELECT id,organization_id,name,kind,encrypted_config,enabled
		FROM notification_channels WHERE id=$1 AND organization_id=$2`, channelID, organizationID).Scan(
		&channel.ID, &channel.OrganizationID, &channel.Name, &channel.Kind, &channel.EncryptedConfig, &channel.Enabled)
	if errors.Is(err, sql.ErrNoRows) {
		return NotificationChannel{}, nil, ErrNotFound
	}
	if err != nil {
		return NotificationChannel{}, nil, err
	}
	plaintext, _, err := repository.codec.Open(channel.EncryptedConfig, channelAAD(channel.ID))
	if err != nil {
		return NotificationChannel{}, nil, fmt.Errorf("decrypt notification channel: %w", err)
	}
	config := map[string]string{}
	if err := json.Unmarshal(plaintext, &config); err != nil {
		return NotificationChannel{}, nil, fmt.Errorf("decode notification channel: %w", err)
	}
	return channel, config, nil
}

func membershipRole(ctx context.Context, transaction *sql.Tx, organizationID, userID uuid.UUID) (OrganizationRole, error) {
	var role OrganizationRole
	err := transaction.QueryRowContext(ctx, "SELECT role FROM organization_members WHERE organization_id=$1 AND user_id=$2",
		organizationID, userID).Scan(&role)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	return role, err
}

func (repository *AlertRepository) UpdateChannel(ctx context.Context, actorID, organizationID, channelID uuid.UUID, input UpdateChannelInput) (NotificationChannel, error) {
	transaction, err := repository.database.BeginTx(ctx, nil)
	if err != nil {
		return NotificationChannel{}, err
	}
	defer func() { _ = transaction.Rollback() }()
	channel, err := lockManagedChannel(ctx, transaction, actorID, organizationID, channelID)
	if err != nil {
		return NotificationChannel{}, err
	}
	if input.Name != nil {
		name := strings.TrimSpace(*input.Name)
		if name == "" || len(name) > 120 {
			return NotificationChannel{}, ErrInvalidAlertConfig
		}
		channel.Name = name
	}
	if input.Enabled != nil {
		channel.Enabled = *input.Enabled
	}
	if input.Config != nil {
		if repository.codec == nil {
			return NotificationChannel{}, ErrSecretsUnavailable
		}
		if !validChannelConfig(input.Config) {
			return NotificationChannel{}, ErrInvalidAlertConfig
		}
		if channel.EncryptedConfig, channel.EncryptionKeyID, err = repository.codec.Seal(input.Config, channelAAD(channel.ID)); err != nil {
			return NotificationChannel{}, fmt.Errorf("encrypt notification channel: %w", err)
		}
	}
	err = transaction.QueryRowContext(ctx, `UPDATE notification_channels SET name=$1,enabled=$2,encrypted_config=$3,
		encryption_key_id=$4,updated_at=now() WHERE id=$5 RETURNING updated_at,
		(SELECT count(*) FROM alert_rule_channels WHERE channel_id=$5)`, channel.Name, channel.Enabled,
		channel.EncryptedConfig, channel.EncryptionKeyID, channel.ID).Scan(&channel.UpdatedAt, &channel.RuleCount)
	if err != nil {
		return NotificationChannel{}, translateConstraintError(err)
	}
	if err := insertAudit(ctx, transaction, organizationID, actorID, "notification_channel.updated", "notification_channel", channel.ID); err != nil {
		return NotificationChannel{}, err
	}
	if err := transaction.Commit(); err != nil {
		return NotificationChannel{}, err
	}
	return channel, nil
}

// DeleteChannel removes a channel; rules that used it keep their other channels.
func (repository *AlertRepository) DeleteChannel(ctx context.Context, actorID, organizationID, channelID uuid.UUID) error {
	transaction, err := repository.database.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = transaction.Rollback() }()
	if _, err := lockManagedChannel(ctx, transaction, actorID, organizationID, channelID); err != nil {
		return err
	}
	if _, err := transaction.ExecContext(ctx, "DELETE FROM notification_channels WHERE id=$1", channelID); err != nil {
		return err
	}
	if err := insertAudit(ctx, transaction, organizationID, actorID, "notification_channel.deleted", "notification_channel", channelID); err != nil {
		return err
	}
	return transaction.Commit()
}

// RecordTestDelivery logs a test send and audits it.
func (repository *AlertRepository) RecordTestDelivery(ctx context.Context, actorID, organizationID, channelID uuid.UUID, sendErr error, errorCode string) error {
	transaction, err := repository.database.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = transaction.Rollback() }()
	status := "sent"
	if sendErr != nil {
		status = "failed"
	} else {
		errorCode = ""
	}
	if _, err := transaction.ExecContext(ctx, `INSERT INTO alert_deliveries (channel_id,kind,status,error_code)
		VALUES ($1,'test',$2,$3)`, channelID, status, truncateCode(errorCode)); err != nil {
		return err
	}
	if err := insertAudit(ctx, transaction, organizationID, actorID, "notification_channel.tested", "notification_channel", channelID); err != nil {
		return err
	}
	return transaction.Commit()
}

func truncateCode(code string) string {
	if len(code) > 64 {
		return code[:64]
	}
	return code
}

// AlertMetricPresentation returns a metric's Console label and value unit.
func AlertMetricPresentation(metric AlertMetric) (string, string) {
	switch metric {
	case AlertErrorCount:
		return "错误数", "count"
	case AlertErrorRate:
		return "错误率", "percent"
	case AlertAPIFailureRate:
		return "API 失败率", "percent"
	case AlertLCPP75:
		return "LCP P75", "ms"
	default:
		return string(metric), ""
	}
}

// AlertDeepLink points at the Console page that can explain a breach, over the
// breached window and in the rule's environment.
func AlertDeepLink(projectID uuid.UUID, metric AlertMetric, from, to time.Time, environment string) string {
	page := "overview"
	switch metric {
	case AlertErrorCount, AlertErrorRate:
		page = "issues"
	case AlertAPIFailureRate:
		page = "apis"
	case AlertLCPP75:
		page = "performance"
	}
	query := url.Values{"to": {to.UTC().Format(time.RFC3339)}}
	if !from.IsZero() {
		query.Set("from", from.UTC().Format(time.RFC3339))
	}
	if environment != "" {
		query.Set("environment", environment)
	}
	return fmt.Sprintf("/projects/%s/%s?%s", projectID.String(), page, query.Encode())
}
