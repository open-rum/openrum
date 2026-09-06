package internal

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"

	"openrum/internal/sourcemap"
)

const MaxBatchSize = 100

type PendingEvent struct {
	ProjectID uuid.UUID
	EventID   uuid.UUID
	Release   string
	Dist      string
	Stack     string
}

type EventMappings interface {
	NextBatch(context.Context, int) ([]PendingEvent, error)
	Save(context.Context, PendingEvent, sourcemap.MappedStack) error
}

type StackMapper interface {
	MapStack(context.Context, uuid.UUID, string, string, string) sourcemap.MappedStack
}

type SourceMapJob struct {
	events EventMappings
	mapper StackMapper
}

func NewSourceMapJob(events EventMappings, mapper StackMapper) *SourceMapJob {
	return &SourceMapJob{events: events, mapper: mapper}
}

func (job *SourceMapJob) RunBatch(ctx context.Context, limit int) (int, error) {
	if limit < 1 || limit > MaxBatchSize {
		limit = MaxBatchSize
	}
	events, err := job.events.NextBatch(ctx, limit)
	if err != nil {
		return 0, err
	}
	processed := 0
	for _, event := range events {
		if err := ctx.Err(); err != nil {
			return processed, err
		}
		mapped := job.mapper.MapStack(ctx, event.ProjectID, event.Release, event.Dist, event.Stack)
		if err := job.events.Save(ctx, event, mapped); err != nil {
			return processed, err
		}
		processed++
	}
	return processed, nil
}

type ClickHouseMappings struct{ database *sql.DB }

func NewClickHouseMappings(database *sql.DB) *ClickHouseMappings {
	return &ClickHouseMappings{database: database}
}

func (repository *ClickHouseMappings) NextBatch(ctx context.Context, limit int) ([]PendingEvent, error) {
	rows, err := repository.database.QueryContext(ctx, `SELECT project_id,event_id,release,dist,error_stack
FROM rum_events FINAL
WHERE event_type='error' AND error_stack!=''
  AND event_id GLOBAL NOT IN (SELECT event_id FROM event_stack_mappings FINAL)
ORDER BY received_at LIMIT ?`, limit)
	if err != nil {
		return nil, fmt.Errorf("query unmapped error events: %w", err)
	}
	defer func() { _ = rows.Close() }()
	results := make([]PendingEvent, 0, limit)
	for rows.Next() {
		var event PendingEvent
		if err := rows.Scan(&event.ProjectID, &event.EventID, &event.Release, &event.Dist, &event.Stack); err != nil {
			return nil, err
		}
		results = append(results, event)
	}
	return results, rows.Err()
}

func (repository *ClickHouseMappings) Save(ctx context.Context, event PendingEvent, mapped sourcemap.MappedStack) error {
	contents, err := json.Marshal(mapped)
	if err != nil {
		return err
	}
	_, err = repository.database.ExecContext(ctx,
		`INSERT INTO event_stack_mappings (project_id,event_id,status,failure_code,mapped_stack,mapped_at) VALUES (?,?,?,?,?,?)`,
		event.ProjectID, event.EventID, mapped.Status, mapped.Failure, string(contents), time.Now().UTC())
	if err != nil {
		return fmt.Errorf("save mapped stack: %w", err)
	}
	return nil
}
