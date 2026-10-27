package query

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"openrum/internal/search"
)

var ErrInvalidSearchValues = errors.New("invalid search value request")

const (
	searchValueLimit = 20
	// Suggestions look at the last week of the range at most: they are a typing aid, and a
	// shorter scan keeps them fast enough to follow the keyboard.
	searchValueMaxRange = 7 * 24 * time.Hour
	// A suggestion is allowed to be incomplete, so a scan that hits its row budget stops and
	// returns what it saw instead of failing.
	searchValueSettings = " SETTINGS max_execution_time=3, max_rows_to_read=5000000, read_overflow_mode='break', timeout_overflow_mode='break'"
)

// searchDataset is one page's events and the schema its search uses.
type searchDataset struct {
	schema search.Schema
	where  string
}

var searchDatasets = map[string]searchDataset{
	"logs":     {schema: logSchema, where: "event_type='log'"},
	"issues":   {schema: issueSchema, where: "event_type='error'"},
	"sessions": {schema: sessionSchema, where: "session_id!=toUUID('00000000-0000-0000-0000-000000000000')"},
	"apis":     {schema: apiSampleSchema, where: "event_type='api'"},
	"events":   {schema: behaviorSchema, where: "event_type IN ('page_view','custom')"},
}

type SearchValueFilters struct {
	ProjectID   uuid.UUID
	From, To    time.Time
	Environment string
	Dataset     string
	// Field is a field key, attributes.<name> for a property's values, or "attributes" for
	// the property names themselves.
	Field string
	// Contains narrows the values to those containing it, ignoring case.
	Contains string
	// Event narrows the Events dataset to one custom event, so its property names come first.
	Event string
}

type SearchValue struct {
	Value string `json:"value"`
	Count uint64 `json:"count"`
}

type SearchValueRepository struct{ database *sql.DB }

func NewSearchValueRepository(database *sql.DB) *SearchValueRepository {
	return &SearchValueRepository{database: database}
}

// NormalizeSearchValueFilters checks the request and resolves the field to one expression.
func NormalizeSearchValueFilters(filters SearchValueFilters) (SearchValueFilters, error) {
	filters.From, filters.To = filters.From.UTC(), filters.To.UTC()
	filters.Contains = strings.TrimSpace(filters.Contains)
	if filters.ProjectID == uuid.Nil || filters.From.IsZero() || !filters.From.Before(filters.To) ||
		filters.To.Sub(filters.From) > 30*24*time.Hour || !boundedQueryDimension(filters.Environment, 64) ||
		!boundedQueryDimension(filters.Contains, 128) || !boundedQueryDimension(filters.Event, 80) {
		return SearchValueFilters{}, ErrInvalidSearchValues
	}
	if filters.To.Sub(filters.From) > searchValueMaxRange {
		filters.From = filters.To.Add(-searchValueMaxRange)
	}
	if _, _, _, err := searchValueExpression(filters); err != nil {
		return SearchValueFilters{}, err
	}
	return filters, nil
}

// searchValueExpression is the column whose values are suggested, its bound arguments, and
// an extra condition that keeps only rows that have it.
func searchValueExpression(filters SearchValueFilters) (string, []any, string, error) {
	dataset, ok := searchDatasets[filters.Dataset]
	if !ok {
		return "", nil, "", ErrInvalidSearchValues
	}
	if filters.Field == "attributes" {
		if dataset.schema.AttributeExpr == "" {
			return "", nil, "", ErrInvalidSearchValues
		}
		return "arrayJoin(mapKeys(attributes))", nil, "notEmpty(attributes)", nil
	}
	if key, isAttribute := strings.CutPrefix(filters.Field, "attributes."); isAttribute {
		if dataset.schema.AttributeExpr == "" || !behaviorPropertyPattern.MatchString(key) {
			return "", nil, "", ErrInvalidSearchValues
		}
		return "attributes[?]", []any{key}, "mapContains(attributes,?)", nil
	}
	field, ok := dataset.schema.Lookup(filters.Field)
	// Only single-column text and enum fields have values worth suggesting.
	if !ok || len(field.Exprs) != 1 || (field.Type != search.Text && field.Type != search.Enum) {
		return "", nil, "", ErrInvalidSearchValues
	}
	return "toString(" + field.Exprs[0] + ")", nil, "", nil
}

// Values returns the most frequent values of one field in the range.
func (repository *SearchValueRepository) Values(ctx context.Context, requested SearchValueFilters) ([]SearchValue, error) {
	filters, err := NormalizeSearchValueFilters(requested)
	if err != nil {
		return nil, err
	}
	expression, expressionArguments, presence, _ := searchValueExpression(filters)
	dataset := searchDatasets[filters.Dataset]
	where := "project_id=? AND timestamp>=? AND timestamp<? AND NOT has(ingest_flags,'synthetic') AND " + dataset.where
	arguments := []any{filters.ProjectID, filters.From, filters.To}
	if filters.Environment != "" {
		where += " AND environment=?"
		arguments = append(arguments, filters.Environment)
	}
	if filters.Dataset == "events" && filters.Event != "" {
		where += " AND event_type='custom' AND custom_name=?"
		arguments = append(arguments, filters.Event)
	}
	if presence != "" {
		where += " AND " + presence
		arguments = append(arguments, expressionArguments...)
	}
	having := "value!=''"
	var havingArguments []any
	if filters.Contains != "" {
		having += " AND positionCaseInsensitiveUTF8(value,?)>0"
		havingArguments = append(havingArguments, filters.Contains)
	}
	all := append(append(append([]any(nil), expressionArguments...), arguments...), havingArguments...)
	all = append(all, searchValueLimit)
	rows, err := repository.database.QueryContext(ctx, fmt.Sprintf(`SELECT %s AS value, count() AS occurrences
		FROM rum_events WHERE %s GROUP BY value HAVING %s ORDER BY occurrences DESC, value LIMIT ?%s`,
		expression, where, having, searchValueSettings), all...)
	if err != nil {
		return nil, fmt.Errorf("query search values: %w", err)
	}
	defer func() { _ = rows.Close() }()
	values := make([]SearchValue, 0, searchValueLimit)
	for rows.Next() {
		var value SearchValue
		if err := rows.Scan(&value.Value, &value.Count); err != nil {
			return nil, fmt.Errorf("scan search value: %w", err)
		}
		value.Value = strings.TrimRight(value.Value, "\x00")
		values = append(values, value)
	}
	return values, rows.Err()
}
