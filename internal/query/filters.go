package query

import (
	"errors"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
)

const MaxOverviewRange = 30 * 24 * time.Hour

var (
	ErrInvalidOverviewFilters = errors.New("invalid overview filters")
	queryEnvironmentPattern   = regexp.MustCompile(`^[a-z][a-z0-9_-]{0,63}$`)
)

type OverviewFilters struct {
	ProjectID   uuid.UUID `json:"projectId"`
	From        time.Time `json:"from"`
	To          time.Time `json:"to"`
	Environment string    `json:"environment,omitempty"`
	Release     string    `json:"release,omitempty"`
	Route       string    `json:"route,omitempty"`
	MaxPoints   int       `json:"maxPoints,omitempty"`
}

func NormalizeOverviewFilters(filters OverviewFilters) (OverviewFilters, error) {
	filters.Environment = strings.TrimSpace(filters.Environment)
	filters.Release = strings.TrimSpace(filters.Release)
	filters.Route = strings.TrimSpace(filters.Route)
	if filters.ProjectID == uuid.Nil || filters.From.IsZero() || filters.To.IsZero() ||
		!filters.To.After(filters.From) || filters.To.Sub(filters.From) > MaxOverviewRange || !validSeriesPointBudget(filters.MaxPoints) {
		return OverviewFilters{}, ErrInvalidOverviewFilters
	}
	if filters.Environment != "" && !queryEnvironmentPattern.MatchString(filters.Environment) {
		return OverviewFilters{}, ErrInvalidOverviewFilters
	}
	if !boundedQueryDimension(filters.Release, 128) || !boundedQueryDimension(filters.Route, 512) {
		return OverviewFilters{}, ErrInvalidOverviewFilters
	}
	filters.From = filters.From.UTC()
	filters.To = filters.To.UTC()
	return filters, nil
}

func (filters OverviewFilters) previousPeriod() OverviewFilters {
	duration := filters.To.Sub(filters.From)
	previous := filters
	previous.To = filters.From
	previous.From = filters.From.Add(-duration)
	return previous
}

func (filters OverviewFilters) where(includeTime bool) (string, []any) {
	clauses := []string{"project_id = ?"}
	arguments := []any{filters.ProjectID}
	if includeTime {
		clauses = append(clauses, "bucket >= ?", "bucket < ?")
		arguments = append(arguments, filters.From, filters.To)
	}
	if filters.Environment != "" {
		clauses = append(clauses, "environment = ?")
		arguments = append(arguments, filters.Environment)
	}
	if filters.Release != "" {
		clauses = append(clauses, "release = ?")
		arguments = append(arguments, filters.Release)
	}
	if filters.Route != "" {
		clauses = append(clauses, "route = ?")
		arguments = append(arguments, filters.Route)
	}
	return strings.Join(clauses, " AND "), arguments
}

func boundedQueryDimension(value string, maximum int) bool {
	return utf8.ValidString(value) && len(value) <= maximum && !strings.ContainsAny(value, "\x00\r\n")
}

func overviewInterval(duration time.Duration) time.Duration {
	switch {
	case duration <= 6*time.Hour:
		return time.Minute
	case duration <= 48*time.Hour:
		return 5 * time.Minute
	case duration <= 7*24*time.Hour:
		return 15 * time.Minute
	default:
		return time.Hour
	}
}
