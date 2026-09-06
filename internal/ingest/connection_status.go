package ingest

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

const (
	connectionStatusPrefix           = "openrum:connection:"
	defaultConnectionStatusTTL       = 30 * 24 * time.Hour
	connectionStatusOperationTimeout = 250 * time.Millisecond
)

var ErrInvalidRejectReason = errors.New("invalid connection-status reject reason")

type RejectReason string

const (
	RejectOriginRejected      RejectReason = "ORIGIN_REJECTED"
	RejectRateLimited         RejectReason = "RATE_LIMITED"
	RejectPayloadTooLarge     RejectReason = "PAYLOAD_TOO_LARGE"
	RejectUnsupportedEncoding RejectReason = "UNSUPPORTED_ENCODING"
	RejectUnsupportedMedia    RejectReason = "UNSUPPORTED_MEDIA_TYPE"
	RejectInvalidCompression  RejectReason = "INVALID_COMPRESSION"
	RejectInvalidBody         RejectReason = "INVALID_BODY"
	RejectInvalidEnvelope     RejectReason = "INVALID_ENVELOPE"
	RejectEnvironmentMismatch RejectReason = "ENVIRONMENT_MISMATCH"
	RejectInvalidEvent        RejectReason = "INVALID_EVENT"
	RejectIngestUnavailable   RejectReason = "INGEST_UNAVAILABLE"
)

var validRejectReasons = map[RejectReason]struct{}{
	RejectOriginRejected: {}, RejectRateLimited: {}, RejectPayloadTooLarge: {},
	RejectUnsupportedEncoding: {}, RejectUnsupportedMedia: {}, RejectInvalidCompression: {},
	RejectInvalidBody: {}, RejectInvalidEnvelope: {}, RejectEnvironmentMismatch: {},
	RejectInvalidEvent: {}, RejectIngestUnavailable: {},
}

type ConnectionStatus struct {
	LastSDKSeenAt        *time.Time
	LastEventReceivedAt  *time.Time
	LastEventQueryableAt *time.Time
	LastRejectReason     *RejectReason
	LastRejectAt         *time.Time
}

type ConnectionStatusRecorder interface {
	MarkSDKSeen(context.Context, uuid.UUID, time.Time) error
	MarkEventReceived(context.Context, uuid.UUID, time.Time) error
	MarkEventQueryable(context.Context, uuid.UUID, time.Time) error
	MarkRejected(context.Context, uuid.UUID, time.Time, RejectReason) error
}

type ConnectionStatusReader interface {
	GetConnectionStatus(context.Context, uuid.UUID) (ConnectionStatus, error)
}

type connectionStatusRedis interface {
	redis.Scripter
	HGetAll(context.Context, string) *redis.MapStringStringCmd
}

type RedisConnectionStatus struct {
	client connectionStatusRedis
	ttl    time.Duration
}

func NewRedisConnectionStatus(client connectionStatusRedis) *RedisConnectionStatus {
	return &RedisConnectionStatus{client: client, ttl: defaultConnectionStatusTTL}
}

const advanceStatusScriptSource = `
local current = tonumber(redis.call('HGET', KEYS[1], ARGV[1]) or '-1')
local incoming = tonumber(ARGV[2])
if incoming >= current then
  redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
  if ARGV[3] ~= '' then
    redis.call('HSET', KEYS[1], ARGV[3], ARGV[4])
  end
end
redis.call('PEXPIRE', KEYS[1], ARGV[5])
return incoming >= current and 1 or 0
`

var advanceStatusScript = redis.NewScript(advanceStatusScriptSource)

func (status *RedisConnectionStatus) MarkSDKSeen(ctx context.Context, projectID uuid.UUID, at time.Time) error {
	return status.advance(ctx, projectID, "last_sdk_seen_at", at, "", "")
}

func (status *RedisConnectionStatus) MarkEventReceived(ctx context.Context, projectID uuid.UUID, at time.Time) error {
	return status.advance(ctx, projectID, "last_event_received_at", at, "", "")
}

func (status *RedisConnectionStatus) MarkEventQueryable(ctx context.Context, projectID uuid.UUID, at time.Time) error {
	return status.advance(ctx, projectID, "last_event_queryable_at", at, "", "")
}

func (status *RedisConnectionStatus) MarkRejected(ctx context.Context, projectID uuid.UUID, at time.Time, reason RejectReason) error {
	if _, ok := validRejectReasons[reason]; !ok {
		return fmt.Errorf("%w: %q", ErrInvalidRejectReason, reason)
	}
	return status.advance(ctx, projectID, "last_reject_at", at, "last_reject_reason", string(reason))
}

func (status *RedisConnectionStatus) advance(ctx context.Context, projectID uuid.UUID, timestampField string, at time.Time, valueField, value string) error {
	if projectID == uuid.Nil || at.IsZero() {
		return errors.New("project ID and timestamp are required")
	}
	operationCtx, cancel := boundedStatusContext(ctx)
	defer cancel()
	return advanceStatusScript.Run(operationCtx, status.client, []string{connectionStatusKey(projectID)},
		timestampField, at.UTC().UnixMilli(), valueField, value, status.ttl.Milliseconds()).Err()
}

func (status *RedisConnectionStatus) GetConnectionStatus(ctx context.Context, projectID uuid.UUID) (ConnectionStatus, error) {
	if projectID == uuid.Nil {
		return ConnectionStatus{}, errors.New("project ID is required")
	}
	operationCtx, cancel := boundedStatusContext(ctx)
	defer cancel()
	fields, err := status.client.HGetAll(operationCtx, connectionStatusKey(projectID)).Result()
	if err != nil {
		return ConnectionStatus{}, err
	}
	result := ConnectionStatus{
		LastSDKSeenAt:        parseStatusTime(fields["last_sdk_seen_at"]),
		LastEventReceivedAt:  parseStatusTime(fields["last_event_received_at"]),
		LastEventQueryableAt: parseStatusTime(fields["last_event_queryable_at"]),
		LastRejectAt:         parseStatusTime(fields["last_reject_at"]),
	}
	if reason := RejectReason(fields["last_reject_reason"]); reason != "" {
		if _, ok := validRejectReasons[reason]; ok {
			result.LastRejectReason = &reason
		}
	}
	return result, nil
}

func connectionStatusKey(projectID uuid.UUID) string {
	return connectionStatusPrefix + projectID.String()
}

func boundedStatusContext(parent context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(parent, connectionStatusOperationTimeout)
}

func parseStatusTime(raw string) *time.Time {
	milliseconds, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || milliseconds < 0 {
		return nil
	}
	value := time.UnixMilli(milliseconds).UTC()
	return &value
}
