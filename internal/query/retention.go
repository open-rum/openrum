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

var (
	ErrInvalidRetentionQuery      = errors.New("invalid retention query")
	ErrRetentionQueryTooExpensive = errors.New("retention query exceeds its scan budget")
)

type RetentionQuery struct {
	ProjectID   uuid.UUID `json:"-"`
	From        time.Time `json:"from"`
	To          time.Time `json:"to"`
	Environment string    `json:"environment,omitempty"`
	Weeks       int       `json:"weeks"`
}

type RetentionPoint struct {
	WeekIndex int     `json:"weekIndex"`
	Users     uint64  `json:"users"`
	Rate      float64 `json:"rate"`
}

type RetentionCohort struct {
	CohortWeek time.Time        `json:"cohortWeek"`
	Users      uint64           `json:"users"`
	Retention  []RetentionPoint `json:"retention"`
}

type RetentionResult struct {
	From        time.Time         `json:"from"`
	To          time.Time         `json:"to"`
	Weeks       int               `json:"weeks"`
	Identity    string            `json:"identity"`
	Approximate bool              `json:"approximate"`
	Definition  string            `json:"definition"`
	Cohorts     []RetentionCohort `json:"cohorts"`
}

type RetentionRepository struct{ database *sql.DB }

func NewRetentionRepository(database *sql.DB) *RetentionRepository {
	return &RetentionRepository{database: database}
}

func NormalizeRetentionQuery(input RetentionQuery) (RetentionQuery, error) {
	input.From, input.To = input.From.UTC(), input.To.UTC()
	input.Environment = strings.TrimSpace(input.Environment)
	if input.Weeks == 0 {
		input.Weeks = 8
	}
	if input.ProjectID == uuid.Nil || input.From.IsZero() || !input.From.Before(input.To) ||
		input.Weeks < 4 || input.Weeks > 12 || input.To.Sub(input.From) > time.Duration(input.Weeks)*7*24*time.Hour ||
		!boundedQueryDimension(input.Environment, 64) {
		return RetentionQuery{}, ErrInvalidRetentionQuery
	}
	return input, nil
}

func CheckRetentionBudget(requested RetentionQuery) error {
	input, err := NormalizeRetentionQuery(requested)
	if err != nil {
		return err
	}
	units := int64(input.To.Sub(input.From).Hours()+0.999) * 2
	if input.Environment != "" {
		units = max(1, units/4)
	}
	if units > 12*7*24*2 {
		return ErrRetentionQueryTooExpensive
	}
	return nil
}

func (repository *RetentionRepository) Query(ctx context.Context, requested RetentionQuery) (RetentionResult, error) {
	input, err := NormalizeRetentionQuery(requested)
	if err != nil {
		return RetentionResult{}, err
	}
	if err := CheckRetentionBudget(input); err != nil {
		return RetentionResult{}, err
	}
	where := "project_id=? AND timestamp>=? AND timestamp<? AND anonymous_user_id!='' AND event_type IN ('page_view','custom') AND NOT has(ingest_flags,'synthetic')"
	arguments := []any{input.ProjectID, input.From, input.To}
	if input.Environment != "" {
		where += " AND environment=?"
		arguments = append(arguments, input.Environment)
	}
	queryText := `SELECT cohort_week,week_index,uniqExact(identity) AS retained_users FROM (
		SELECT identity,cohort_week,arrayJoin(active_weeks) AS active_week,dateDiff('week',cohort_week,active_week) AS week_index FROM (
			SELECT anonymous_user_id AS identity,toStartOfWeek(min(timestamp),1) AS cohort_week,
				arrayDistinct(groupArray(toStartOfWeek(timestamp,1))) AS active_weeks
			FROM rum_events WHERE ` + where + ` GROUP BY identity
		)
	) WHERE week_index>=0 AND week_index<? GROUP BY cohort_week,week_index ORDER BY cohort_week,week_index`
	rows, err := repository.database.QueryContext(ctx, queryText, append(arguments, input.Weeks)...)
	if err != nil {
		return RetentionResult{}, fmt.Errorf("query retention: %w", err)
	}
	defer func() { _ = rows.Close() }()
	cohorts := make([]RetentionCohort, 0)
	byWeek := make(map[time.Time]int)
	for rows.Next() {
		var cohortWeek time.Time
		var weekIndex int
		var users uint64
		if err := rows.Scan(&cohortWeek, &weekIndex, &users); err != nil {
			return RetentionResult{}, fmt.Errorf("scan retention: %w", err)
		}
		cohortWeek = cohortWeek.UTC()
		index, ok := byWeek[cohortWeek]
		if !ok {
			index = len(cohorts)
			byWeek[cohortWeek] = index
			cohorts = append(cohorts, RetentionCohort{CohortWeek: cohortWeek, Retention: make([]RetentionPoint, 0)})
		}
		if weekIndex == 0 {
			cohorts[index].Users = users
		}
		cohorts[index].Retention = append(cohorts[index].Retention, RetentionPoint{WeekIndex: weekIndex, Users: users})
	}
	if err := rows.Err(); err != nil {
		return RetentionResult{}, err
	}
	for cohortIndex := range cohorts {
		for pointIndex := range cohorts[cohortIndex].Retention {
			if cohorts[cohortIndex].Users > 0 {
				cohorts[cohortIndex].Retention[pointIndex].Rate = float64(cohorts[cohortIndex].Retention[pointIndex].Users) / float64(cohorts[cohortIndex].Users)
			}
		}
	}
	return RetentionResult{From: input.From, To: input.To, Weeks: input.Weeks, Identity: "anonymous_user_id", Approximate: true,
		Definition: "first activity observed in the selected range; active again in each following calendar week", Cohorts: cohorts}, nil
}
