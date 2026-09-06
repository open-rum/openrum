package query

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

var ErrInvalidUsageFilters = errors.New("invalid usage filters")

type UsageFilters struct {
	ProjectID uuid.UUID
	From      time.Time
	To        time.Time
	EventType string
}

type UsageTotals struct {
	Accepted  uint64  `json:"accepted"`
	Estimated float64 `json:"estimated"`
	Sampled   uint64  `json:"sampled"`
	Rejected  uint64  `json:"rejected"`
	Failed    uint64  `json:"failed"`
	Bytes     uint64  `json:"bytes"`
}

type UsageBreakdown struct {
	Bucket    time.Time `json:"bucket"`
	EventType string    `json:"eventType"`
	Outcome   string    `json:"outcome"`
	Reason    string    `json:"reason,omitempty"`
	Events    uint64    `json:"events"`
	Estimated float64   `json:"estimated"`
	Bytes     uint64    `json:"bytes"`
}

type UsageResult struct {
	From            time.Time        `json:"from"`
	To              time.Time        `json:"to"`
	IntervalSeconds int64            `json:"intervalSeconds"`
	Totals          UsageTotals      `json:"totals"`
	Breakdown       []UsageBreakdown `json:"breakdown"`
}

type UsageRepository struct{ database *sql.DB }

func NewUsageRepository(database *sql.DB) *UsageRepository {
	return &UsageRepository{database: database}
}

func NormalizeUsageFilters(filters UsageFilters) (UsageFilters, error) {
	filters.From, filters.To = filters.From.UTC(), filters.To.UTC()
	filters.EventType = strings.TrimSpace(filters.EventType)
	if filters.ProjectID == uuid.Nil || filters.From.IsZero() || !filters.From.Before(filters.To) ||
		filters.To.Sub(filters.From) > 90*24*time.Hour || len(filters.EventType) > 64 || containsControl(filters.EventType) {
		return UsageFilters{}, ErrInvalidUsageFilters
	}
	return filters, nil
}

func (repository *UsageRepository) Get(ctx context.Context, requested UsageFilters) (UsageResult, error) {
	filters, err := NormalizeUsageFilters(requested)
	if err != nil {
		return UsageResult{}, err
	}
	where, arguments := usageWhere(filters)
	var totals UsageTotals
	totalRows, err := repository.database.QueryContext(ctx, `SELECT outcome,sumMerge(events),sumMerge(estimated),sumMerge(bytes)
		FROM usage_metrics_1h WHERE `+where+` GROUP BY outcome`, arguments...)
	if err != nil {
		return UsageResult{}, fmt.Errorf("query usage totals: %w", err)
	}
	for totalRows.Next() {
		var outcome string
		var events, bytes uint64
		var estimated float64
		if err := totalRows.Scan(&outcome, &events, &estimated, &bytes); err != nil {
			_ = totalRows.Close()
			return UsageResult{}, fmt.Errorf("scan usage totals: %w", err)
		}
		totals.Estimated += estimated
		totals.Bytes += bytes
		switch outcome {
		case "accepted":
			totals.Accepted += events
		case "sampled":
			totals.Sampled += events
		case "rejected":
			totals.Rejected += events
		case "failed":
			totals.Failed += events
		}
	}
	if err := totalRows.Err(); err != nil {
		_ = totalRows.Close()
		return UsageResult{}, fmt.Errorf("iterate usage totals: %w", err)
	}
	if err := totalRows.Close(); err != nil {
		return UsageResult{}, fmt.Errorf("close usage totals: %w", err)
	}
	interval := time.Hour
	if filters.To.Sub(filters.From) > 7*24*time.Hour {
		interval = 24 * time.Hour
	}
	intervalHours := int(interval / time.Hour)
	rows, err := repository.database.QueryContext(ctx, fmt.Sprintf(`SELECT
		toStartOfInterval(bucket,INTERVAL %d HOUR) AS point,event_type,outcome,reason,
		sumMerge(events),sumMerge(estimated),sumMerge(bytes)
		FROM usage_metrics_1h WHERE %s GROUP BY point,event_type,outcome,reason
		ORDER BY point,event_type,outcome,reason LIMIT 5000`, intervalHours, where), arguments...)
	if err != nil {
		return UsageResult{}, fmt.Errorf("query usage breakdown: %w", err)
	}
	defer func() { _ = rows.Close() }()
	breakdown := make([]UsageBreakdown, 0)
	for rows.Next() {
		var item UsageBreakdown
		if err := rows.Scan(&item.Bucket, &item.EventType, &item.Outcome, &item.Reason, &item.Events, &item.Estimated, &item.Bytes); err != nil {
			return UsageResult{}, fmt.Errorf("scan usage breakdown: %w", err)
		}
		item.Bucket = item.Bucket.UTC()
		breakdown = append(breakdown, item)
	}
	if err := rows.Err(); err != nil {
		return UsageResult{}, fmt.Errorf("iterate usage breakdown: %w", err)
	}
	return UsageResult{From: filters.From, To: filters.To, IntervalSeconds: int64(interval / time.Second), Totals: totals, Breakdown: breakdown}, nil
}

func usageWhere(filters UsageFilters) (string, []any) {
	where := "project_id=? AND bucket>=? AND bucket<?"
	arguments := []any{filters.ProjectID, filters.From, filters.To}
	if filters.EventType != "" {
		where += " AND event_type=?"
		arguments = append(arguments, filters.EventType)
	}
	return where, arguments
}
