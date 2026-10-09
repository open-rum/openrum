package query

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"openrum/internal/sourcemap"
)

var ErrEventNotFound = errors.New("event not found")

var ErrInvalidSessionTimeline = errors.New("invalid session timeline query")
var ErrSessionNotFound = errors.New("session not found")

type SessionTimelineFilters struct {
	ProjectID uuid.UUID
	SessionID uuid.UUID
	From      time.Time
	To        time.Time
	Cursor    string
	Kinds     []string
	Limit     int
}

type SessionTimelineEvent struct {
	EventID        uuid.UUID          `json:"eventId"`
	Timestamp      time.Time          `json:"timestamp"`
	ReceivedAt     time.Time          `json:"receivedAt"`
	Kind           string             `json:"kind"`
	Title          string             `json:"title"`
	Route          string             `json:"route,omitempty"`
	PageID         uuid.UUID          `json:"pageId,omitempty"`
	PageURL        string             `json:"pageUrl,omitempty"`
	PageTitle      string             `json:"pageTitle,omitempty"`
	NavigationType string             `json:"navigationType,omitempty"`
	Environment    string             `json:"environment,omitempty"`
	Release        string             `json:"release,omitempty"`
	ErrorType      string             `json:"errorType,omitempty"`
	ErrorMessage   string             `json:"errorMessage,omitempty"`
	ErrorMechanism string             `json:"errorMechanism,omitempty"`
	Fingerprint    string             `json:"fingerprint,omitempty"`
	Handled        bool               `json:"handled,omitempty"`
	APIMethod      string             `json:"apiMethod,omitempty"`
	APIURL         string             `json:"apiUrl,omitempty"`
	APIStatus      uint16             `json:"apiStatus,omitempty"`
	APIFailure     string             `json:"apiFailure,omitempty"`
	DurationMS     float64            `json:"durationMs,omitempty"`
	TransferSize   uint64             `json:"transferSize,omitempty"`
	LogLevel       string             `json:"logLevel,omitempty"`
	LogMessage     string             `json:"logMessage,omitempty"`
	Logger         string             `json:"logger,omitempty"`
	MetricName     string             `json:"metricName,omitempty"`
	MetricValue    float64            `json:"metricValue,omitempty"`
	MetricDelta    float64            `json:"metricDelta,omitempty"`
	MetricRating   string             `json:"metricRating,omitempty"`
	TraceID        string             `json:"traceId,omitempty"`
	SpanID         string             `json:"spanId,omitempty"`
	SampleRate     float64            `json:"sampleRate,omitempty"`
	Attributes     map[string]string  `json:"attributes"`
	Measurements   map[string]float64 `json:"measurements"`
	IngestFlags    []string           `json:"ingestFlags"`
}

type SessionTimelineAvailability struct {
	Sampled       bool `json:"sampled"`
	ExpiredLogs   bool `json:"expiredLogs"`
	TimelineExact bool `json:"timelineExact"`
	Replay        bool `json:"replay"`
}

type SessionTimeline struct {
	ProjectID    uuid.UUID                   `json:"projectId"`
	SessionID    uuid.UUID                   `json:"sessionId"`
	From         time.Time                   `json:"from"`
	To           time.Time                   `json:"to"`
	Session      SessionSummary              `json:"session"`
	Events       []SessionTimelineEvent      `json:"events"`
	NextCursor   string                      `json:"nextCursor,omitempty"`
	Truncated    bool                        `json:"truncated"`
	Availability SessionTimelineAvailability `json:"availability"`
}

type EventContextAvailability struct {
	Stack       bool `json:"stack"`
	Breadcrumbs bool `json:"breadcrumbs"`
	Visitor     bool `json:"visitor"`
	Release     bool `json:"release"`
}

type RelatedAPI struct {
	EventID    uuid.UUID `json:"eventId"`
	Timestamp  time.Time `json:"timestamp"`
	Method     string    `json:"method"`
	URL        string    `json:"url"`
	Status     uint16    `json:"status"`
	Failure    string    `json:"failure,omitempty"`
	DurationMS float64   `json:"durationMs"`
	Route      string    `json:"route,omitempty"`
}

type EventDetail struct {
	ProjectID          uuid.UUID                `json:"projectId"`
	EventID            uuid.UUID                `json:"eventId"`
	Timestamp          time.Time                `json:"timestamp"`
	ReceivedAt         time.Time                `json:"receivedAt"`
	Environment        string                   `json:"environment"`
	Release            string                   `json:"release,omitempty"`
	Dist               string                   `json:"dist,omitempty"`
	SessionID          uuid.UUID                `json:"sessionId"`
	VisitorID          string                   `json:"visitorId,omitempty"`
	PageID             uuid.UUID                `json:"pageId"`
	PageURL            string                   `json:"pageUrl"`
	Route              string                   `json:"route,omitempty"`
	Browser            string                   `json:"browser,omitempty"`
	BrowserVersion     string                   `json:"browserVersion,omitempty"`
	OS                 string                   `json:"os,omitempty"`
	OSVersion          string                   `json:"osVersion,omitempty"`
	DeviceType         string                   `json:"deviceType,omitempty"`
	Country            string                   `json:"country,omitempty"`
	ErrorType          string                   `json:"errorType"`
	ErrorMessage       string                   `json:"errorMessage"`
	OriginalStack      string                   `json:"originalStack,omitempty"`
	ErrorMechanism     string                   `json:"errorMechanism,omitempty"`
	Fingerprint        string                   `json:"fingerprint"`
	FingerprintVersion uint16                   `json:"fingerprintVersion"`
	Handled            bool                     `json:"handled"`
	Breadcrumbs        []string                 `json:"breadcrumbs"`
	IngestFlags        []string                 `json:"ingestFlags"`
	Availability       EventContextAvailability `json:"availability"`
	RelatedAPIs        []RelatedAPI             `json:"relatedApis"`
	MappedStack        *sourcemap.MappedStack   `json:"mappedStack,omitempty"`
}

type EventPage struct {
	Events     []EventDetail `json:"events"`
	NextCursor string        `json:"nextCursor,omitempty"`
}

type EventRepository struct{ database *sql.DB }

func NewEventRepository(database *sql.DB) *EventRepository {
	return &EventRepository{database: database}
}

func (repository *EventRepository) ListSession(ctx context.Context, requested SessionTimelineFilters) (SessionTimeline, error) {
	filters, cursor, err := normalizeSessionTimelineFilters(requested)
	if err != nil {
		return SessionTimeline{}, ErrInvalidSessionTimeline
	}
	summary, availability, err := repository.sessionSummary(ctx, filters)
	if err != nil {
		return SessionTimeline{}, err
	}
	where := `project_id=? AND session_id=? AND timestamp>=? AND timestamp<=?
		AND event_type IN ('page_view','custom','error','api','log','web_vital') AND NOT has(ingest_flags,'synthetic')
		AND (event_type!='log' OR raw_expires_at>now64(3))`
	arguments := []any{filters.ProjectID, filters.SessionID, filters.From, filters.To}
	if len(filters.Kinds) > 0 {
		predicates := make([]string, 0, len(filters.Kinds))
		for _, kind := range filters.Kinds {
			switch kind {
			case "page_view":
				predicates = append(predicates, "(event_type='page_view' AND navigation_type!='route_change')")
			case "navigation":
				predicates = append(predicates, "(event_type='page_view' AND navigation_type='route_change')")
			case "click":
				predicates = append(predicates, "(event_type='custom' AND custom_name='ui.click')")
			case "custom":
				predicates = append(predicates, "(event_type='custom' AND custom_name!='ui.click')")
			default:
				predicates = append(predicates, "event_type='"+kind+"'")
			}
		}
		where += " AND (" + strings.Join(predicates, " OR ") + ")"
	}
	if cursor != nil {
		where += " AND (timestamp>? OR (timestamp=? AND event_id>?))"
		arguments = append(arguments, cursor.Timestamp, cursor.Timestamp, cursor.EventID)
	}
	arguments = append(arguments, filters.Limit+1)
	rows, err := repository.database.QueryContext(ctx, `SELECT event_id,timestamp,received_at,event_type,navigation_type,custom_name,
		route,page_url_normalized,title,page_id,environment,release,error_type,error_message,error_mechanism,fingerprint,handled,
		api_method,api_url_normalized,api_status,api_failure,duration_ms,transfer_size,attributes,measurements,
		log_level,log_message,log_logger,metric_name,metric_value,metric_delta,metric_rating,trace_id,span_id,sample_rate,ingest_flags
		FROM rum_events FINAL WHERE `+where+` ORDER BY timestamp,event_id LIMIT ?`, arguments...)
	if err != nil {
		return SessionTimeline{}, fmt.Errorf("query session timeline: %w", err)
	}
	defer func() { _ = rows.Close() }()
	events := make([]SessionTimelineEvent, 0, filters.Limit+1)
	for rows.Next() {
		var current SessionTimelineEvent
		var eventType, customName string
		if err := rows.Scan(&current.EventID, &current.Timestamp, &current.ReceivedAt, &eventType, &current.NavigationType, &customName,
			&current.Route, &current.PageURL, &current.PageTitle, &current.PageID, &current.Environment, &current.Release,
			&current.ErrorType, &current.ErrorMessage, &current.ErrorMechanism, &current.Fingerprint, &current.Handled,
			&current.APIMethod, &current.APIURL, &current.APIStatus, &current.APIFailure, &current.DurationMS, &current.TransferSize,
			&current.Attributes, &current.Measurements, &current.LogLevel, &current.LogMessage, &current.Logger,
			&current.MetricName, &current.MetricValue, &current.MetricDelta, &current.MetricRating,
			&current.TraceID, &current.SpanID, &current.SampleRate, &current.IngestFlags); err != nil {
			return SessionTimeline{}, fmt.Errorf("scan session timeline: %w", err)
		}
		current.Timestamp, current.ReceivedAt = current.Timestamp.UTC(), current.ReceivedAt.UTC()
		switch eventType {
		case "page_view":
			if current.NavigationType == "route_change" {
				current.Kind, current.Title = "navigation", firstNonEmpty(current.Route, current.PageURL, "页面导航")
			} else {
				current.Kind, current.Title = "page_view", firstNonEmpty(current.Route, current.PageURL, "页面访问")
			}
		case "custom":
			if customName == "ui.click" {
				current.Kind, current.Title = "click", "元素点击"
			} else {
				current.Kind, current.Title = "custom", customName
			}
		case "error":
			current.Kind, current.Title = "error", firstNonEmpty(current.ErrorType, "前端错误")
		case "api":
			current.Kind, current.Title = "api", strings.TrimSpace(current.APIMethod+" "+current.APIURL)
		case "log":
			current.Kind, current.Title = "log", strings.ToUpper(current.LogLevel)+" · "+current.LogMessage
		case "web_vital":
			current.Kind, current.Title = "web_vital", firstNonEmpty(current.MetricName, "性能指标")
		}
		if current.Attributes == nil {
			current.Attributes = map[string]string{}
		}
		if current.Measurements == nil {
			current.Measurements = map[string]float64{}
		}
		if current.IngestFlags == nil {
			current.IngestFlags = []string{}
		}
		events = append(events, current)
	}
	if err := rows.Err(); err != nil {
		return SessionTimeline{}, err
	}
	truncated := len(events) > filters.Limit
	nextCursor := ""
	if truncated {
		events = events[:filters.Limit]
		last := events[len(events)-1]
		nextCursor = encodeEventCursor(last.Timestamp, last.EventID)
	}
	return SessionTimeline{ProjectID: filters.ProjectID, SessionID: filters.SessionID, From: filters.From, To: filters.To,
		Session: summary, Events: events, NextCursor: nextCursor, Truncated: truncated, Availability: availability}, nil
}

func normalizeSessionTimelineFilters(filters SessionTimelineFilters) (SessionTimelineFilters, *eventCursor, error) {
	filters.From, filters.To = filters.From.UTC(), filters.To.UTC()
	if filters.Limit == 0 {
		filters.Limit = 100
	}
	if filters.ProjectID == uuid.Nil || filters.SessionID == uuid.Nil || filters.From.IsZero() ||
		!filters.From.Before(filters.To) || filters.To.Sub(filters.From) > 24*time.Hour || filters.Limit < 1 || filters.Limit > 100 {
		return SessionTimelineFilters{}, nil, ErrInvalidSessionTimeline
	}
	allowed := map[string]bool{"page_view": true, "navigation": true, "click": true, "custom": true, "error": true, "api": true, "log": true, "web_vital": true}
	seen := map[string]bool{}
	for _, kind := range filters.Kinds {
		kind = strings.TrimSpace(kind)
		if !allowed[kind] || seen[kind] {
			return SessionTimelineFilters{}, nil, ErrInvalidSessionTimeline
		}
		seen[kind] = true
	}
	cursor, err := decodeTimelineCursor(filters.Cursor)
	if err != nil {
		return SessionTimelineFilters{}, nil, err
	}
	return filters, cursor, nil
}

func decodeTimelineCursor(value string) (*eventCursor, error) {
	if value == "" {
		return nil, nil
	}
	decoded, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		return nil, ErrInvalidSessionTimeline
	}
	var cursor eventCursor
	if json.Unmarshal(decoded, &cursor) != nil || cursor.Timestamp.IsZero() || cursor.EventID == uuid.Nil {
		return nil, ErrInvalidSessionTimeline
	}
	cursor.Timestamp = cursor.Timestamp.UTC()
	return &cursor, nil
}

func (repository *EventRepository) sessionSummary(ctx context.Context, filters SessionTimelineFilters) (SessionSummary, SessionTimelineAvailability, error) {
	var summary SessionSummary
	var sampled, expiredLogs uint64
	err := repository.database.QueryRowContext(ctx, `SELECT session_id,argMin(anonymous_user_id,timestamp),
		argMaxIf(user_id,timestamp,user_id!=''),min(timestamp),max(timestamp),
		toUInt64(greatest(0,dateDiff('second',min(timestamp),max(timestamp)))),count(),
		countIf(event_type='page_view'),countIf(event_type='error'),
		countIf(event_type='api' AND (api_failure!='' OR api_status=0 OR api_status>=400)),countIf(event_type='custom'),
		argMax(environment,timestamp),argMax(release,timestamp),argMax(browser,timestamp),argMax(os,timestamp),
		argMax(device_type,timestamp),argMax(toString(country),timestamp),
		argMinIf(if(route!='',route,page_url_normalized),timestamp,route!='' OR page_url_normalized!=''),
		argMaxIf(if(route!='',route,page_url_normalized),timestamp,route!='' OR page_url_normalized!=''),
		maxIf(duration_ms,event_type='api'),maxIf(metric_value,metric_name='LCP'),maxIf(metric_value,metric_name='INP'),
		maxIf(metric_value,metric_name='CLS'),countIf(sample_rate>0 AND sample_rate<1),
		countIf(event_type='log' AND raw_expires_at<=now64(3))
		FROM rum_events FINAL WHERE project_id=? AND session_id=? AND timestamp>=? AND timestamp<=?
		AND NOT has(ingest_flags,'synthetic') GROUP BY session_id`, filters.ProjectID, filters.SessionID, filters.From, filters.To).Scan(
		&summary.SessionID, &summary.VisitorID, &summary.UserID, &summary.StartedAt, &summary.EndedAt,
		&summary.DurationSeconds, &summary.Events, &summary.PageViews, &summary.Errors, &summary.APIFailures,
		&summary.CustomEvents, &summary.Environment, &summary.Release, &summary.Browser, &summary.OS,
		&summary.DeviceType, &summary.Country, &summary.EntryRoute, &summary.ExitRoute, &summary.SlowestAPI,
		&summary.LCP, &summary.INP, &summary.CLS, &sampled, &expiredLogs)
	if errors.Is(err, sql.ErrNoRows) {
		return SessionSummary{}, SessionTimelineAvailability{}, ErrSessionNotFound
	}
	if err != nil {
		return SessionSummary{}, SessionTimelineAvailability{}, fmt.Errorf("query session summary: %w", err)
	}
	summary.StartedAt, summary.EndedAt = summary.StartedAt.UTC(), summary.EndedAt.UTC()
	summary.Country = strings.TrimSpace(summary.Country)
	availability := SessionTimelineAvailability{Sampled: sampled > 0, ExpiredLogs: expiredLogs > 0,
		TimelineExact: sampled == 0 && expiredLogs == 0, Replay: false}
	return summary, availability, nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			return value
		}
	}
	return ""
}

const eventColumns = `project_id,event_id,timestamp,received_at,environment,release,dist,session_id,
anonymous_user_id,page_id,page_url_normalized,route,browser,browser_version,os,os_version,device_type,country,
error_type,error_message,error_stack,error_mechanism,fingerprint,fingerprint_version,handled,breadcrumbs,ingest_flags`

func (repository *EventRepository) Get(ctx context.Context, eventID uuid.UUID) (EventDetail, error) {
	row := repository.database.QueryRowContext(ctx, `SELECT `+eventColumns+`
FROM rum_events FINAL WHERE event_id=? AND event_type='error' ORDER BY received_at DESC LIMIT 1`, eventID)
	event, err := scanEvent(row)
	if errors.Is(err, sql.ErrNoRows) {
		return EventDetail{}, ErrEventNotFound
	}
	if err != nil {
		return EventDetail{}, fmt.Errorf("query event detail: %w", err)
	}
	event.RelatedAPIs, err = repository.relatedAPIs(ctx, event)
	if err != nil {
		return EventDetail{}, err
	}
	event.MappedStack, err = repository.mappedStack(ctx, event.ProjectID, event.EventID)
	if err != nil {
		return EventDetail{}, err
	}
	return event, nil
}

func (repository *EventRepository) mappedStack(ctx context.Context, projectID, eventID uuid.UUID) (*sourcemap.MappedStack, error) {
	var contents string
	err := repository.database.QueryRowContext(ctx, `SELECT mapped_stack FROM event_stack_mappings FINAL
WHERE project_id=? AND event_id=? ORDER BY mapped_at DESC LIMIT 1`, projectID, eventID).Scan(&contents)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("query mapped stack: %w", err)
	}
	var mapped sourcemap.MappedStack
	if err := json.Unmarshal([]byte(contents), &mapped); err != nil {
		return nil, fmt.Errorf("decode mapped stack: %w", err)
	}
	return &mapped, nil
}

// ListIssueEvents pages an Issue's error events newest first, narrowed by the same
// Environment and dimension filters as the Issue's aggregates so samples match its counts.
func (repository *EventRepository) ListIssueEvents(ctx context.Context, filters IssueFilters, fingerprint string) (EventPage, error) {
	projectID, from, to, limit := filters.ProjectID, filters.From, filters.To, filters.Limit
	if projectID == uuid.Nil || fingerprint == "" || len(fingerprint) > 128 || from.IsZero() || !from.Before(to) || to.Sub(from) > 30*24*time.Hour || limit < 1 || limit > 100 {
		return EventPage{}, ErrInvalidIssueFilters
	}
	query := `SELECT ` + eventColumns + ` FROM rum_events FINAL
WHERE project_id=? AND event_type='error' AND fingerprint=? AND timestamp>=? AND timestamp<?`
	arguments := []any{projectID, fingerprint, from.UTC(), to.UTC()}
	for _, filter := range []struct{ column, value string }{
		{"environment", filters.Environment}, {"release", filters.Release}, {"route", filters.Route},
		{"browser", filters.Browser}, {"device_type", filters.DeviceType}, {"country", filters.Country},
		{"user_id", filters.UserID},
	} {
		if filter.value != "" {
			query += ` AND ` + filter.column + `=?`
			arguments = append(arguments, filter.value)
		}
	}
	cursor, err := decodeEventCursor(filters.Cursor)
	if err != nil {
		return EventPage{}, err
	}
	if cursor != nil {
		query += ` AND (timestamp < ? OR (timestamp = ? AND event_id < ?))`
		arguments = append(arguments, cursor.Timestamp, cursor.Timestamp, cursor.EventID)
	}
	query += ` ORDER BY timestamp DESC,event_id DESC LIMIT ?`
	arguments = append(arguments, limit+1)
	rows, err := repository.database.QueryContext(ctx, query, arguments...)
	if err != nil {
		return EventPage{}, fmt.Errorf("query issue events: %w", err)
	}
	defer func() { _ = rows.Close() }()
	events := make([]EventDetail, 0, limit+1)
	for rows.Next() {
		event, err := scanEvent(rows)
		if err != nil {
			return EventPage{}, fmt.Errorf("scan issue event: %w", err)
		}
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		return EventPage{}, err
	}
	next := ""
	if len(events) > limit {
		events = events[:limit]
		last := events[len(events)-1]
		next = encodeEventCursor(last.Timestamp, last.EventID)
	}
	return EventPage{Events: events, NextCursor: next}, nil
}

func (repository *EventRepository) relatedAPIs(ctx context.Context, event EventDetail) ([]RelatedAPI, error) {
	rows, err := repository.database.QueryContext(ctx, `SELECT event_id,timestamp,api_method,api_url_normalized,
api_status,api_failure,duration_ms,route FROM rum_events FINAL
WHERE project_id=? AND session_id=? AND event_type='api' AND timestamp>=? AND timestamp<=?
ORDER BY abs(dateDiff('millisecond',timestamp,?)),timestamp LIMIT 20`, event.ProjectID, event.SessionID,
		event.Timestamp.Add(-5*time.Minute), event.Timestamp.Add(5*time.Minute), event.Timestamp)
	if err != nil {
		return nil, fmt.Errorf("query related APIs: %w", err)
	}
	defer func() { _ = rows.Close() }()
	results := make([]RelatedAPI, 0)
	for rows.Next() {
		var current RelatedAPI
		if err := rows.Scan(&current.EventID, &current.Timestamp, &current.Method, &current.URL, &current.Status,
			&current.Failure, &current.DurationMS, &current.Route); err != nil {
			return nil, fmt.Errorf("scan related API: %w", err)
		}
		current.Timestamp = current.Timestamp.UTC()
		results = append(results, current)
	}
	return results, rows.Err()
}

type eventScanner interface{ Scan(...any) error }

func scanEvent(scanner eventScanner) (EventDetail, error) {
	var event EventDetail
	err := scanner.Scan(&event.ProjectID, &event.EventID, &event.Timestamp, &event.ReceivedAt, &event.Environment,
		&event.Release, &event.Dist, &event.SessionID, &event.VisitorID, &event.PageID, &event.PageURL, &event.Route,
		&event.Browser, &event.BrowserVersion, &event.OS, &event.OSVersion, &event.DeviceType, &event.Country,
		&event.ErrorType, &event.ErrorMessage, &event.OriginalStack, &event.ErrorMechanism, &event.Fingerprint,
		&event.FingerprintVersion, &event.Handled, &event.Breadcrumbs, &event.IngestFlags)
	if err != nil {
		return EventDetail{}, err
	}
	event.Timestamp, event.ReceivedAt = event.Timestamp.UTC(), event.ReceivedAt.UTC()
	if event.Breadcrumbs == nil {
		event.Breadcrumbs = []string{}
	}
	if event.IngestFlags == nil {
		event.IngestFlags = []string{}
	}
	event.RelatedAPIs = []RelatedAPI{}
	event.Availability = EventContextAvailability{
		Stack: event.OriginalStack != "", Breadcrumbs: len(event.Breadcrumbs) > 0,
		Visitor: event.VisitorID != "", Release: event.Release != "",
	}
	return event, nil
}

type eventCursor struct {
	Timestamp time.Time `json:"t"`
	EventID   uuid.UUID `json:"i"`
}

func encodeEventCursor(timestamp time.Time, eventID uuid.UUID) string {
	encoded, _ := json.Marshal(eventCursor{Timestamp: timestamp.UTC(), EventID: eventID})
	return base64.RawURLEncoding.EncodeToString(encoded)
}

func decodeEventCursor(value string) (*eventCursor, error) {
	if value == "" {
		return nil, nil
	}
	decoded, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		return nil, ErrInvalidIssueFilters
	}
	var cursor eventCursor
	if json.Unmarshal(decoded, &cursor) != nil || cursor.Timestamp.IsZero() || cursor.EventID == uuid.Nil {
		return nil, ErrInvalidIssueFilters
	}
	cursor.Timestamp = cursor.Timestamp.UTC()
	return &cursor, nil
}
