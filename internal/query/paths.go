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

const pathMaxRange = 7 * 24 * time.Hour

var (
	ErrInvalidPathQuery      = errors.New("invalid path query")
	ErrPathQueryTooExpensive = errors.New("path query exceeds its scan budget")
)

type PathQuery struct {
	ProjectID   uuid.UUID `json:"-"`
	From        time.Time `json:"from"`
	To          time.Time `json:"to"`
	Environment string    `json:"environment,omitempty"`
	Depth       int       `json:"depth"`
	TopN        int       `json:"topN"`
}

type PathRow struct {
	Events   []string `json:"events"`
	Sessions uint64   `json:"sessions"`
	Share    float64  `json:"share"`
}

type PathResult struct {
	From          time.Time `json:"from"`
	To            time.Time `json:"to"`
	Depth         int       `json:"depth"`
	TopN          int       `json:"topN"`
	Identity      string    `json:"identity"`
	Approximate   bool      `json:"approximate"`
	TotalSessions uint64    `json:"totalSessions"`
	Paths         []PathRow `json:"paths"`
}

type PathRepository struct{ database *sql.DB }

func NewPathRepository(database *sql.DB) *PathRepository { return &PathRepository{database: database} }

func NormalizePathQuery(input PathQuery) (PathQuery, error) {
	input.From, input.To = input.From.UTC(), input.To.UTC()
	input.Environment = strings.TrimSpace(input.Environment)
	if input.Depth == 0 {
		input.Depth = 5
	}
	if input.TopN == 0 {
		input.TopN = 20
	}
	if input.ProjectID == uuid.Nil || input.From.IsZero() || !input.From.Before(input.To) ||
		input.To.Sub(input.From) > pathMaxRange || !boundedQueryDimension(input.Environment, 64) ||
		input.Depth < 2 || input.Depth > 5 || (input.TopN != 5 && input.TopN != 10 && input.TopN != 20) {
		return PathQuery{}, ErrInvalidPathQuery
	}
	return input, nil
}

func CheckPathBudget(requested PathQuery) error {
	input, err := NormalizePathQuery(requested)
	if err != nil {
		return err
	}
	units := int64(input.To.Sub(input.From).Minutes()+0.999) * int64(input.Depth)
	if input.Environment != "" {
		units = max(1, units/4)
	}
	if units > int64(pathMaxRange.Minutes())*5 {
		return ErrPathQueryTooExpensive
	}
	return nil
}

func (repository *PathRepository) Query(ctx context.Context, requested PathQuery) (PathResult, error) {
	input, err := NormalizePathQuery(requested)
	if err != nil {
		return PathResult{}, err
	}
	if err := CheckPathBudget(input); err != nil {
		return PathResult{}, err
	}
	where := "project_id=? AND timestamp>=? AND timestamp<? AND session_id!=toUUID('00000000-0000-0000-0000-000000000000') AND event_type IN ('page_view','custom') AND NOT has(ingest_flags,'synthetic')"
	arguments := []any{input.ProjectID, input.From, input.To}
	if input.Environment != "" {
		where += " AND environment=?"
		arguments = append(arguments, input.Environment)
	}
	label := `multiIf(event_type='page_view' AND navigation_type='route_change',concat('navigation:',leftUTF8(if(route!='',route,page_url_normalized),160)),event_type='page_view',concat('page:',leftUTF8(if(route!='',route,page_url_normalized),160)),custom_name='ui.click','click',concat('event:',leftUTF8(custom_name,80)))`
	queryText := `SELECT path,sessions,sum(sessions) OVER () AS total_sessions FROM (
		SELECT path,count() AS sessions FROM (
			SELECT session_id,arrayMap(item -> item.2,arraySlice(arraySort(item -> item.1,groupArray(100)((timestamp,` + label + `))),1,?)) AS path
			FROM rum_events WHERE ` + where + ` GROUP BY session_id HAVING length(path)>0
		) GROUP BY path
	) ORDER BY sessions DESC,path LIMIT ?`
	rows, err := repository.database.QueryContext(ctx, queryText, append([]any{input.Depth}, append(arguments, input.TopN)...)...)
	if err != nil {
		return PathResult{}, fmt.Errorf("query paths: %w", err)
	}
	defer func() { _ = rows.Close() }()
	result := PathResult{From: input.From, To: input.To, Depth: input.Depth, TopN: input.TopN, Identity: "session_id", Approximate: true, Paths: make([]PathRow, 0)}
	for rows.Next() {
		var current PathRow
		if err := rows.Scan(&current.Events, &current.Sessions, &result.TotalSessions); err != nil {
			return PathResult{}, fmt.Errorf("scan paths: %w", err)
		}
		if result.TotalSessions > 0 {
			current.Share = float64(current.Sessions) / float64(result.TotalSessions)
		}
		result.Paths = append(result.Paths, current)
	}
	return result, rows.Err()
}
