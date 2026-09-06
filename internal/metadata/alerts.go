package metadata

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

type ChannelKind string

var ErrInvalidAlertConfig = errors.New("invalid alert configuration")

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

func (repository *AlertRepository) CreateChannel(ctx context.Context, actorID, organizationID uuid.UUID, name string, kind ChannelKind, config json.RawMessage) (NotificationChannel, error) {
	name = strings.TrimSpace(name)
	if repository.codec == nil || name == "" || len(name) > 120 || (kind != ChannelSMTP && kind != ChannelWebhook) || !validChannelConfig(config) {
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
