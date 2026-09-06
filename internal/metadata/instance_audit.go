package metadata

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

type InstanceAuditEntry struct {
	ID            int64
	ActorUserID   *uuid.UUID
	ActorEmail    string
	RequestID     string
	Action        string
	ResourceType  string
	ResourcePath  string
	ConfigSource  string
	ChangeSummary json.RawMessage
	CreatedAt     time.Time
}

type InstanceAuditRepository struct{ database *sql.DB }

func NewInstanceAuditRepository(database *sql.DB) *InstanceAuditRepository {
	return &InstanceAuditRepository{database: database}
}

func (repository *InstanceAuditRepository) Record(ctx context.Context, entry InstanceAuditEntry) error {
	summary := entry.ChangeSummary
	if len(summary) == 0 {
		summary = json.RawMessage(`{}`)
	}
	_, err := repository.database.ExecContext(ctx, `INSERT INTO instance_audit_logs
		(actor_user_id,request_id,action,resource_type,resource_path,config_source,change_summary)
		VALUES ($1,$2,$3,$4,$5,$6,$7)`, entry.ActorUserID, entry.RequestID, entry.Action,
		entry.ResourceType, entry.ResourcePath, entry.ConfigSource, summary)
	return err
}

func (repository *InstanceAuditRepository) List(ctx context.Context, limit int) ([]InstanceAuditEntry, error) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	rows, err := repository.database.QueryContext(ctx, `SELECT logs.id,logs.actor_user_id,
		COALESCE(users.email,''),logs.request_id,logs.action,logs.resource_type,logs.resource_path,
		logs.config_source,logs.change_summary,logs.created_at
		FROM instance_audit_logs logs LEFT JOIN users ON users.id=logs.actor_user_id
		ORDER BY logs.created_at DESC LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	entries := make([]InstanceAuditEntry, 0)
	for rows.Next() {
		var entry InstanceAuditEntry
		if err := rows.Scan(&entry.ID, &entry.ActorUserID, &entry.ActorEmail, &entry.RequestID,
			&entry.Action, &entry.ResourceType, &entry.ResourcePath, &entry.ConfigSource,
			&entry.ChangeSummary, &entry.CreatedAt); err != nil {
			return nil, err
		}
		entries = append(entries, entry)
	}
	return entries, rows.Err()
}
