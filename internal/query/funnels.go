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

const (
	funnelBreakdownLimit = 100
	funnelSampleLimit    = 20
	funnelBudgetUnits    = int64(2 * 5 * 7 * 24 * 60)
)

var (
	ErrInvalidFunnelQuery      = errors.New("invalid funnel query")
	ErrFunnelQueryTooExpensive = errors.New("funnel query exceeds its scan budget")
	ErrFunnelCardinality       = errors.New("funnel dimension exceeds its cardinality budget")
)

type FunnelStep struct {
	Kind string `json:"kind"`
	Name string `json:"name"`
}

type FunnelQuery struct {
	ProjectID     uuid.UUID    `json:"-"`
	From          time.Time    `json:"from"`
	To            time.Time    `json:"to"`
	Environment   string       `json:"environment,omitempty"`
	Dimension     string       `json:"dimension"`
	WindowSeconds int          `json:"windowSeconds"`
	Steps         []FunnelStep `json:"steps"`
}

type FunnelStepResult struct {
	Index                  int      `json:"index"`
	Kind                   string   `json:"kind"`
	Name                   string   `json:"name"`
	Sessions               uint64   `json:"sessions"`
	ConversionFromPrevious *float64 `json:"conversionFromPrevious"`
	ConversionFromFirst    *float64 `json:"conversionFromFirst"`
}

type FunnelBreakdown struct {
	Value      string   `json:"value"`
	StepCounts []uint64 `json:"stepCounts"`
}

type FunnelSessionSample struct {
	SessionID   uuid.UUID `json:"sessionId"`
	ReachedStep int       `json:"reachedStep"`
	LastSeenAt  time.Time `json:"lastSeenAt"`
}

type FunnelResult struct {
	From          time.Time             `json:"from"`
	To            time.Time             `json:"to"`
	Dimension     string                `json:"dimension"`
	WindowSeconds int                   `json:"windowSeconds"`
	Identity      string                `json:"identity"`
	Approximate   bool                  `json:"approximate"`
	Steps         []FunnelStepResult    `json:"steps"`
	Breakdown     []FunnelBreakdown     `json:"breakdown"`
	Samples       []FunnelSessionSample `json:"samples"`
}

type FunnelRepository struct{ database *sql.DB }

func NewFunnelRepository(database *sql.DB) *FunnelRepository {
	return &FunnelRepository{database: database}
}

func NormalizeFunnelQuery(input FunnelQuery) (FunnelQuery, error) {
	input.From, input.To = input.From.UTC(), input.To.UTC()
	input.Environment = strings.TrimSpace(input.Environment)
	input.Dimension = strings.TrimSpace(input.Dimension)
	if input.Dimension == "" {
		input.Dimension = "country"
	}
	if input.ProjectID == uuid.Nil || input.From.IsZero() || !input.From.Before(input.To) ||
		input.To.Sub(input.From) > 30*24*time.Hour || len(input.Steps) < 2 || len(input.Steps) > 5 ||
		!boundedQueryDimension(input.Environment, 64) || !validBehaviorDimension(input.Dimension) ||
		(input.WindowSeconds != 1800 && input.WindowSeconds != 3600 && input.WindowSeconds != 86400) {
		return FunnelQuery{}, ErrInvalidFunnelQuery
	}
	for index := range input.Steps {
		step, err := normalizeFunnelStep(input.Steps[index])
		if err != nil {
			return FunnelQuery{}, err
		}
		input.Steps[index] = step
	}
	return input, nil
}

func CheckFunnelBudget(requested FunnelQuery) error {
	input, err := NormalizeFunnelQuery(requested)
	if err != nil {
		return err
	}
	minutes := int64(input.To.Sub(input.From).Minutes() + 0.999)
	units := minutes * int64(len(input.Steps)) * 2
	if strings.HasPrefix(input.Dimension, "property:") {
		units *= 4
	}
	if input.Environment != "" {
		units = max(1, units/4)
	}
	if units > funnelBudgetUnits {
		return ErrFunnelQueryTooExpensive
	}
	return nil
}

func (repository *FunnelRepository) Query(ctx context.Context, requested FunnelQuery) (FunnelResult, error) {
	input, err := NormalizeFunnelQuery(requested)
	if err != nil {
		return FunnelResult{}, err
	}
	if err := CheckFunnelBudget(input); err != nil {
		return FunnelResult{}, err
	}
	sessionSQL, arguments := funnelSessionQuery(input)
	breakdown, err := repository.breakdown(ctx, sessionSQL, arguments, len(input.Steps))
	if err != nil {
		return FunnelResult{}, err
	}
	counts := make([]uint64, len(input.Steps))
	for _, group := range breakdown {
		for index, count := range group.StepCounts {
			counts[index] += count
		}
	}
	steps := make([]FunnelStepResult, len(input.Steps))
	for index, step := range input.Steps {
		steps[index] = FunnelStepResult{Index: index + 1, Kind: step.Kind, Name: step.Name, Sessions: counts[index]}
		if index > 0 {
			steps[index].ConversionFromPrevious = funnelRatio(counts[index], counts[index-1])
		}
		if index > 0 {
			steps[index].ConversionFromFirst = funnelRatio(counts[index], counts[0])
		}
	}
	samples, err := repository.samples(ctx, sessionSQL, arguments)
	if err != nil {
		return FunnelResult{}, err
	}
	return FunnelResult{
		From: input.From, To: input.To, Dimension: input.Dimension, WindowSeconds: input.WindowSeconds,
		Identity: "session_id", Approximate: true, Steps: steps, Breakdown: breakdown, Samples: samples,
	}, nil
}

func (repository *FunnelRepository) breakdown(ctx context.Context, sessionSQL string, arguments []any, stepCount int) ([]FunnelBreakdown, error) {
	selects := make([]string, stepCount)
	for index := range stepCount {
		selects[index] = fmt.Sprintf("countIf(level >= %d)", index+1)
	}
	queryText := `SELECT dimension_value,` + strings.Join(selects, ",") + ` FROM (` + sessionSQL + `)
		WHERE level > 0 GROUP BY dimension_value ORDER BY count() DESC,dimension_value LIMIT ` + fmt.Sprint(funnelBreakdownLimit+1)
	rows, err := repository.database.QueryContext(ctx, queryText, arguments...)
	if err != nil {
		return nil, fmt.Errorf("query funnel breakdown: %w", err)
	}
	defer func() { _ = rows.Close() }()
	result := make([]FunnelBreakdown, 0, funnelBreakdownLimit)
	for rows.Next() {
		current := FunnelBreakdown{StepCounts: make([]uint64, stepCount)}
		targets := make([]any, 0, stepCount+1)
		targets = append(targets, &current.Value)
		for index := range current.StepCounts {
			targets = append(targets, &current.StepCounts[index])
		}
		if err := rows.Scan(targets...); err != nil {
			return nil, fmt.Errorf("scan funnel breakdown: %w", err)
		}
		result = append(result, current)
		if len(result) > funnelBreakdownLimit {
			return nil, ErrFunnelCardinality
		}
	}
	return result, rows.Err()
}

func (repository *FunnelRepository) samples(ctx context.Context, sessionSQL string, arguments []any) ([]FunnelSessionSample, error) {
	rows, err := repository.database.QueryContext(ctx, `SELECT session_id,level,last_seen_at FROM (`+sessionSQL+`)
		WHERE level > 0 ORDER BY level DESC,last_seen_at DESC LIMIT `+fmt.Sprint(funnelSampleLimit), arguments...)
	if err != nil {
		return nil, fmt.Errorf("query funnel samples: %w", err)
	}
	defer func() { _ = rows.Close() }()
	result := make([]FunnelSessionSample, 0)
	for rows.Next() {
		var current FunnelSessionSample
		if err := rows.Scan(&current.SessionID, &current.ReachedStep, &current.LastSeenAt); err != nil {
			return nil, fmt.Errorf("scan funnel sample: %w", err)
		}
		current.LastSeenAt = current.LastSeenAt.UTC()
		result = append(result, current)
	}
	return result, rows.Err()
}

func funnelSessionQuery(input FunnelQuery) (string, []any) {
	conditions := make([]string, len(input.Steps))
	conditionArguments := make([]any, 0)
	for index, step := range input.Steps {
		conditions[index], conditionArguments = funnelStepCondition(step, conditionArguments)
	}
	dimension := funnelDimensionExpression(input.Dimension)
	where := "project_id=? AND timestamp>=? AND timestamp<? AND session_id!=toUUID('00000000-0000-0000-0000-000000000000') AND NOT has(ingest_flags,'synthetic')"
	baseArguments := []any{input.ProjectID, input.From, input.To}
	if input.Environment != "" {
		where += " AND environment=?"
		baseArguments = append(baseArguments, input.Environment)
	}
	where += " AND (" + strings.Join(conditions, " OR ") + ")"
	queryText := `SELECT session_id,` + dimension + ` AS dimension_value,
		windowFunnel(` + fmt.Sprint(input.WindowSeconds*1000) + `,'strict_increase')(toUInt64(toUnixTimestamp64Milli(timestamp)),` + strings.Join(conditions, ",") + `) AS level,
		max(timestamp) AS last_seen_at
		FROM rum_events WHERE ` + where + ` GROUP BY session_id`
	arguments := append([]any{}, conditionArguments...)
	arguments = append(arguments, baseArguments...)
	arguments = append(arguments, conditionArguments...)
	return queryText, arguments
}

func funnelStepCondition(step FunnelStep, arguments []any) (string, []any) {
	switch step.Kind {
	case "page_view":
		return "event_type='page_view' AND navigation_type!='route_change'", arguments
	case "navigation":
		return "event_type='page_view' AND navigation_type='route_change'", arguments
	case "click":
		return "event_type='custom' AND custom_name='ui.click'", arguments
	default:
		return "event_type='custom' AND custom_name=?", append(arguments, step.Name)
	}
}

func funnelDimensionExpression(dimension string) string {
	switch dimension {
	case "country":
		return "if(toString(argMin(country,timestamp))='','unknown',toString(argMin(country,timestamp)))"
	case "device":
		return "if(argMin(device_type,timestamp)='','unknown',argMin(device_type,timestamp))"
	case "browser":
		return "if(argMin(browser,timestamp)='','unknown',argMin(browser,timestamp))"
	case "source":
		return "if(domain(argMin(referrer,timestamp))='','direct',domain(argMin(referrer,timestamp)))"
	default:
		key := strings.TrimPrefix(dimension, "property:")
		value := "argMinIf(attributes['" + key + "'],timestamp,attributes['" + key + "']!='')"
		return "if(" + value + "='','(not set)'," + value + ")"
	}
}

func normalizeFunnelStep(step FunnelStep) (FunnelStep, error) {
	step.Kind, step.Name = strings.TrimSpace(step.Kind), strings.TrimSpace(step.Name)
	if !validBehaviorKind(step.Kind) || step.Kind == "" || !boundedQueryDimension(step.Name, 80) {
		return FunnelStep{}, ErrInvalidFunnelQuery
	}
	if step.Kind == "custom" {
		if step.Name == "" || step.Name == "ui.click" || step.Name == "page_view" || step.Name == "navigation" || step.Name == "click" {
			return FunnelStep{}, ErrInvalidFunnelQuery
		}
		return step, nil
	}
	if step.Name != "" && step.Name != step.Kind {
		return FunnelStep{}, ErrInvalidFunnelQuery
	}
	step.Name = step.Kind
	return step, nil
}

func funnelRatio(numerator, denominator uint64) *float64 {
	if denominator == 0 {
		return nil
	}
	value := float64(numerator) / float64(denominator)
	return &value
}
