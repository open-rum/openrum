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

var ErrInvalidSessionFilters = errors.New("invalid session filters")

type SessionFilters struct {
	ProjectID       uuid.UUID
	From            time.Time
	To              time.Time
	Environment     string
	Release         string
	Browser         string
	DeviceType      string
	Country         string
	Route           string
	Search          string
	Signal          string
	Sort            string
	MinimumEvents   int
	MinimumDuration int
	Limit           int
	Page            int
}

type SessionSummary struct {
	SessionID       uuid.UUID `json:"sessionId"`
	VisitorID       string    `json:"visitorId,omitempty"`
	StartedAt       time.Time `json:"startedAt"`
	EndedAt         time.Time `json:"endedAt"`
	DurationSeconds uint64    `json:"durationSeconds"`
	Events          uint64    `json:"events"`
	PageViews       uint64    `json:"pageViews"`
	Errors          uint64    `json:"errors"`
	APIFailures     uint64    `json:"apiFailures"`
	CustomEvents    uint64    `json:"customEvents"`
	Environment     string    `json:"environment,omitempty"`
	Release         string    `json:"release,omitempty"`
	Browser         string    `json:"browser,omitempty"`
	OS              string    `json:"os,omitempty"`
	DeviceType      string    `json:"deviceType,omitempty"`
	Country         string    `json:"country,omitempty"`
	EntryRoute      string    `json:"entryRoute,omitempty"`
	ExitRoute       string    `json:"exitRoute,omitempty"`
	SlowestAPI      float64   `json:"slowestApiMs"`
	LCP             float64   `json:"lcp,omitempty"`
	INP             float64   `json:"inp,omitempty"`
	CLS             float64   `json:"cls,omitempty"`
}

type SessionFacet struct {
	Value    string `json:"value"`
	Sessions uint64 `json:"sessions"`
}

type SessionFacets struct {
	Environments []SessionFacet `json:"environments"`
	Releases     []SessionFacet `json:"releases"`
	Browsers     []SessionFacet `json:"browsers"`
	DeviceTypes  []SessionFacet `json:"deviceTypes"`
	Countries    []SessionFacet `json:"countries"`
}

type SessionPage struct {
	Sessions []SessionSummary `json:"sessions"`
	Page     int              `json:"page"`
	Limit    int              `json:"limit"`
	HasMore  bool             `json:"hasMore"`
	Facets   SessionFacets    `json:"facets"`
}

type SessionRepository struct{ database *sql.DB }

func NewSessionRepository(database *sql.DB) *SessionRepository {
	return &SessionRepository{database: database}
}

func (repository *SessionRepository) ListSession(ctx context.Context, projectID, sessionID uuid.UUID, from, to time.Time) (SessionTimeline, error) {
	return NewEventRepository(repository.database).ListSession(ctx, projectID, sessionID, from, to)
}

func NormalizeSessionFilters(filters SessionFilters) (SessionFilters, error) {
	filters.From, filters.To = filters.From.UTC(), filters.To.UTC()
	filters.Environment = strings.TrimSpace(filters.Environment)
	filters.Release = strings.TrimSpace(filters.Release)
	filters.Browser = strings.TrimSpace(filters.Browser)
	filters.DeviceType = strings.TrimSpace(filters.DeviceType)
	filters.Country = strings.TrimSpace(filters.Country)
	filters.Route = strings.TrimSpace(filters.Route)
	filters.Search = strings.TrimSpace(filters.Search)
	filters.Signal = strings.TrimSpace(filters.Signal)
	filters.Sort = strings.TrimSpace(filters.Sort)
	if filters.Limit == 0 {
		filters.Limit = 50
	}
	if filters.Page == 0 {
		filters.Page = 1
	}
	if filters.Sort == "" {
		filters.Sort = "latest"
	}
	if filters.ProjectID == uuid.Nil || filters.From.IsZero() || !filters.From.Before(filters.To) ||
		filters.To.Sub(filters.From) > 30*24*time.Hour || filters.Limit < 1 || filters.Limit > 100 ||
		filters.Page < 1 || filters.Page > 100 || filters.MinimumEvents < 0 || filters.MinimumEvents > 100_000 ||
		filters.MinimumDuration < 0 || filters.MinimumDuration > 24*60*60 || !validSessionSignal(filters.Signal) ||
		!validSessionSort(filters.Sort) || !boundedQueryDimension(filters.Environment, 64) ||
		!boundedQueryDimension(filters.Release, 128) || !boundedQueryDimension(filters.Browser, 128) ||
		!boundedQueryDimension(filters.DeviceType, 64) || !boundedQueryDimension(filters.Country, 2) ||
		!boundedQueryDimension(filters.Route, 512) || !boundedQueryDimension(filters.Search, 128) {
		return SessionFilters{}, ErrInvalidSessionFilters
	}
	return filters, nil
}

func validSessionSignal(value string) bool {
	return value == "" || value == "error" || value == "api_failure" || value == "slow_api" || value == "poor_vital"
}

func validSessionSort(value string) bool {
	return value == "latest" || value == "duration" || value == "events" || value == "errors"
}

func (repository *SessionRepository) List(ctx context.Context, requested SessionFilters) (SessionPage, error) {
	filters, err := NormalizeSessionFilters(requested)
	if err != nil {
		return SessionPage{}, err
	}
	where, arguments := sessionWhere(filters)
	having, havingArguments := sessionHaving(filters)
	order := map[string]string{
		"latest":   "ended_at DESC, session_id DESC",
		"duration": "duration_seconds DESC, ended_at DESC",
		"events":   "event_count DESC, ended_at DESC",
		"errors":   "error_count DESC, ended_at DESC",
	}[filters.Sort]
	query := `SELECT session_id,
		argMin(anonymous_user_id,timestamp),min(timestamp) AS started_at,max(timestamp) AS ended_at,
		toUInt64(greatest(0,dateDiff('second',started_at,ended_at))) AS duration_seconds,
		uniqCombined64(event_id) AS event_count,
		countIf(event_type='page_view') AS page_view_count,
		countIf(event_type='error') AS error_count,
		countIf(event_type='api' AND (api_failure!='' OR api_status=0 OR api_status>=400)) AS api_failure_count,
		countIf(event_type='custom') AS custom_event_count,
		argMax(environment,timestamp),argMax(release,timestamp),argMax(browser,timestamp),argMax(os,timestamp),
		argMax(device_type,timestamp),argMax(toString(country),timestamp),
		argMinIf(if(route!='',route,page_url_normalized),timestamp,route!='' OR page_url_normalized!=''),
		argMaxIf(if(route!='',route,page_url_normalized),timestamp,route!='' OR page_url_normalized!=''),
		maxIf(duration_ms,event_type='api'),maxIf(metric_value,metric_name='LCP'),
		maxIf(metric_value,metric_name='INP'),maxIf(metric_value,metric_name='CLS')
	FROM rum_events WHERE ` + where + ` GROUP BY session_id` + having + ` ORDER BY ` + order + ` LIMIT ? OFFSET ?`
	arguments = append(arguments, havingArguments...)
	arguments = append(arguments, filters.Limit+1, (filters.Page-1)*filters.Limit)
	rows, err := repository.database.QueryContext(ctx, query, arguments...)
	if err != nil {
		return SessionPage{}, fmt.Errorf("query sessions: %w", err)
	}
	sessions, err := scanSessions(rows)
	if err != nil {
		return SessionPage{}, err
	}
	hasMore := len(sessions) > filters.Limit
	if hasMore {
		sessions = sessions[:filters.Limit]
	}
	facets, err := repository.readSessionFacets(ctx, filters)
	if err != nil {
		return SessionPage{}, err
	}
	return SessionPage{Sessions: sessions, Page: filters.Page, Limit: filters.Limit, HasMore: hasMore, Facets: facets}, nil
}

func sessionWhere(filters SessionFilters) (string, []any) {
	clauses := []string{"project_id=?", "timestamp>=?", "timestamp<?", "session_id!=toUUID('00000000-0000-0000-0000-000000000000')", "NOT has(ingest_flags,'synthetic')"}
	arguments := []any{filters.ProjectID, filters.From, filters.To}
	for _, filter := range []struct{ column, value string }{
		{"environment", filters.Environment}, {"release", filters.Release}, {"browser", filters.Browser},
		{"device_type", filters.DeviceType}, {"country", filters.Country},
	} {
		if filter.value != "" {
			clauses = append(clauses, filter.column+"=?")
			arguments = append(arguments, filter.value)
		}
	}
	return strings.Join(clauses, " AND "), arguments
}

func sessionHaving(filters SessionFilters) (string, []any) {
	clauses := make([]string, 0, 5)
	arguments := make([]any, 0, 6)
	if filters.Route != "" {
		clauses = append(clauses, "countIf(route=? OR page_url_normalized=?)>0")
		arguments = append(arguments, filters.Route, filters.Route)
	}
	if filters.Search != "" {
		clauses = append(clauses, `(positionCaseInsensitiveUTF8(toString(session_id),?)>0 OR
			countIf(positionCaseInsensitiveUTF8(anonymous_user_id,?)>0 OR positionCaseInsensitiveUTF8(route,?)>0 OR
			positionCaseInsensitiveUTF8(page_url_normalized,?)>0 OR positionCaseInsensitiveUTF8(custom_name,?)>0 OR
			positionCaseInsensitiveUTF8(error_message,?)>0)>0)`)
		for range 6 {
			arguments = append(arguments, filters.Search)
		}
	}
	switch filters.Signal {
	case "error":
		clauses = append(clauses, "error_count>0")
	case "api_failure":
		clauses = append(clauses, "api_failure_count>0")
	case "slow_api":
		clauses = append(clauses, "maxIf(duration_ms,event_type='api')>=1000")
	case "poor_vital":
		clauses = append(clauses, "countIf(event_type='web_vital' AND metric_rating='poor')>0")
	}
	if filters.MinimumEvents > 0 {
		clauses = append(clauses, "event_count>=?")
		arguments = append(arguments, filters.MinimumEvents)
	}
	if filters.MinimumDuration > 0 {
		clauses = append(clauses, "duration_seconds>=?")
		arguments = append(arguments, filters.MinimumDuration)
	}
	if len(clauses) == 0 {
		return "", arguments
	}
	return " HAVING " + strings.Join(clauses, " AND "), arguments
}

func scanSessions(rows *sql.Rows) ([]SessionSummary, error) {
	defer func() { _ = rows.Close() }()
	result := make([]SessionSummary, 0)
	for rows.Next() {
		var session SessionSummary
		if err := rows.Scan(&session.SessionID, &session.VisitorID, &session.StartedAt, &session.EndedAt,
			&session.DurationSeconds, &session.Events, &session.PageViews, &session.Errors, &session.APIFailures,
			&session.CustomEvents, &session.Environment, &session.Release, &session.Browser, &session.OS,
			&session.DeviceType, &session.Country, &session.EntryRoute, &session.ExitRoute, &session.SlowestAPI,
			&session.LCP, &session.INP, &session.CLS); err != nil {
			return nil, fmt.Errorf("scan session: %w", err)
		}
		session.StartedAt, session.EndedAt = session.StartedAt.UTC(), session.EndedAt.UTC()
		session.Country = strings.TrimSpace(session.Country)
		result = append(result, session)
	}
	return result, rows.Err()
}

func (repository *SessionRepository) readSessionFacets(ctx context.Context, filters SessionFilters) (SessionFacets, error) {
	base := filters
	base.Environment, base.Release, base.Browser, base.DeviceType, base.Country = "", "", "", "", ""
	where, arguments := sessionWhere(base)
	dimensions := []string{"environment", "release", "browser", "device_type", "country"}
	parts := make([]string, 0, len(dimensions))
	allArguments := make([]any, 0, len(arguments)*len(dimensions))
	for _, dimension := range dimensions {
		parts = append(parts, fmt.Sprintf(`SELECT '%s' AS dimension,toString(%s) AS value,uniqCombined64(session_id) AS sessions
			FROM rum_events WHERE %s AND toString(%s)!='' GROUP BY value ORDER BY sessions DESC LIMIT 20`, dimension, dimension, where, dimension))
		allArguments = append(allArguments, arguments...)
	}
	rows, err := repository.database.QueryContext(ctx, strings.Join(parts, " UNION ALL "), allArguments...)
	if err != nil {
		return SessionFacets{}, fmt.Errorf("query session facets: %w", err)
	}
	defer func() { _ = rows.Close() }()
	facets := SessionFacets{Environments: []SessionFacet{}, Releases: []SessionFacet{}, Browsers: []SessionFacet{}, DeviceTypes: []SessionFacet{}, Countries: []SessionFacet{}}
	for rows.Next() {
		var dimension string
		var facet SessionFacet
		if err := rows.Scan(&dimension, &facet.Value, &facet.Sessions); err != nil {
			return SessionFacets{}, fmt.Errorf("scan session facet: %w", err)
		}
		facet.Value = strings.TrimSpace(facet.Value)
		switch dimension {
		case "environment":
			facets.Environments = append(facets.Environments, facet)
		case "release":
			facets.Releases = append(facets.Releases, facet)
		case "browser":
			facets.Browsers = append(facets.Browsers, facet)
		case "device_type":
			facets.DeviceTypes = append(facets.DeviceTypes, facet)
		case "country":
			facets.Countries = append(facets.Countries, facet)
		}
	}
	return facets, rows.Err()
}
