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

type SessionTimelineEvent struct {
	EventID      uuid.UUID         `json:"eventId"`
	Timestamp    time.Time         `json:"timestamp"`
	Kind         string            `json:"kind"`
	Title        string            `json:"title"`
	Route        string            `json:"route,omitempty"`
	Fingerprint  string            `json:"fingerprint,omitempty"`
	ErrorMessage string            `json:"errorMessage,omitempty"`
	APIMethod    string            `json:"apiMethod,omitempty"`
	APIURL       string            `json:"apiUrl,omitempty"`
	APIStatus    uint16            `json:"apiStatus,omitempty"`
	Attributes   map[string]string `json:"attributes"`
}

type SessionTimeline struct {
	ProjectID uuid.UUID              `json:"projectId"`
	SessionID uuid.UUID              `json:"sessionId"`
	From      time.Time              `json:"from"`
	To        time.Time              `json:"to"`
	Events    []SessionTimelineEvent `json:"events"`
	Truncated bool                   `json:"truncated"`
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

func (repository *EventRepository) ListSession(ctx context.Context, projectID, sessionID uuid.UUID, from, to time.Time) (SessionTimeline, error) {
	if projectID == uuid.Nil || sessionID == uuid.Nil || from.IsZero() || !from.Before(to) || to.Sub(from) > 24*time.Hour {
		return SessionTimeline{}, ErrInvalidSessionTimeline
	}
	rows, err := repository.database.QueryContext(ctx, `SELECT event_id,timestamp,event_type,navigation_type,custom_name,
		route,page_url_normalized,error_type,error_message,fingerprint,api_method,api_url_normalized,api_status,attributes
		FROM rum_events WHERE project_id=? AND session_id=? AND timestamp>=? AND timestamp<?
			AND event_type IN ('page_view','custom','error','api') AND NOT has(ingest_flags,'synthetic')
		ORDER BY timestamp,event_id LIMIT 101`, projectID, sessionID, from.UTC(), to.UTC())
	if err != nil {
		return SessionTimeline{}, fmt.Errorf("query session timeline: %w", err)
	}
	defer func() { _ = rows.Close() }()
	events := make([]SessionTimelineEvent, 0, 101)
	for rows.Next() {
		var current SessionTimelineEvent
		var eventType, navigationType, customName, pageURL, errorType string
		if err := rows.Scan(&current.EventID, &current.Timestamp, &eventType, &navigationType, &customName,
			&current.Route, &pageURL, &errorType, &current.ErrorMessage, &current.Fingerprint,
			&current.APIMethod, &current.APIURL, &current.APIStatus, &current.Attributes); err != nil {
			return SessionTimeline{}, fmt.Errorf("scan session timeline: %w", err)
		}
		current.Timestamp = current.Timestamp.UTC()
		switch eventType {
		case "page_view":
			if navigationType == "route_change" {
				current.Kind, current.Title = "navigation", firstNonEmpty(current.Route, pageURL, "页面导航")
			} else {
				current.Kind, current.Title = "page_view", firstNonEmpty(current.Route, pageURL, "页面访问")
			}
		case "custom":
			if customName == "ui.click" {
				current.Kind, current.Title = "click", "元素点击"
			} else {
				current.Kind, current.Title = "custom", customName
			}
		case "error":
			current.Kind, current.Title = "error", firstNonEmpty(errorType, "前端错误")
		case "api":
			current.Kind, current.Title = "api", strings.TrimSpace(current.APIMethod+" "+current.APIURL)
		}
		if current.Attributes == nil {
			current.Attributes = map[string]string{}
		}
		events = append(events, current)
	}
	if err := rows.Err(); err != nil {
		return SessionTimeline{}, err
	}
	truncated := len(events) > 100
	if truncated {
		events = events[:100]
	}
	return SessionTimeline{ProjectID: projectID, SessionID: sessionID, From: from.UTC(), To: to.UTC(), Events: events, Truncated: truncated}, nil
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

func (repository *EventRepository) ListIssueEvents(ctx context.Context, projectID uuid.UUID, fingerprint string, from, to time.Time, limit int, cursorValue string) (EventPage, error) {
	if projectID == uuid.Nil || fingerprint == "" || len(fingerprint) > 128 || from.IsZero() || !from.Before(to) || to.Sub(from) > 30*24*time.Hour || limit < 1 || limit > 100 {
		return EventPage{}, ErrInvalidIssueFilters
	}
	query := `SELECT ` + eventColumns + ` FROM rum_events FINAL
WHERE project_id=? AND event_type='error' AND fingerprint=? AND timestamp>=? AND timestamp<?`
	arguments := []any{projectID, fingerprint, from.UTC(), to.UTC()}
	cursor, err := decodeEventCursor(cursorValue)
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
