package query

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode"

	"github.com/google/uuid"
	"openrum/internal/event"
)

var ErrInvalidLogFilters = errors.New("invalid log filters or search syntax")

type LogFilters struct {
	ProjectID                                                 uuid.UUID
	From, To                                                  time.Time
	Environment, Release, Route, Browser, DeviceType, Country string
	Level, Query, Cursor                                      string
	Limit                                                     int
}

type LogEntry struct {
	EventID         uuid.UUID         `json:"eventId"`
	Timestamp       time.Time         `json:"timestamp"`
	Level           string            `json:"level"`
	Message         string            `json:"message"`
	Logger          string            `json:"logger"`
	Environment     string            `json:"environment"`
	Release         string            `json:"release"`
	Route           string            `json:"route"`
	PageURL         string            `json:"pageUrl"`
	Browser         string            `json:"browser"`
	DeviceType      string            `json:"deviceType"`
	Country         string            `json:"country"`
	SessionID       uuid.UUID         `json:"sessionId"`
	UserID          string            `json:"userId"`
	AnonymousUserID string            `json:"anonymousUserId"`
	TraceID         string            `json:"traceId"`
	SpanID          string            `json:"spanId"`
	Attributes      map[string]string `json:"attributes"`
	SampleRate      float32           `json:"sampleRate"`
}

type LogBucket struct {
	Bucket time.Time `json:"bucket"`
	Trace  uint64    `json:"trace"`
	Debug  uint64    `json:"debug"`
	Info   uint64    `json:"info"`
	Warn   uint64    `json:"warn"`
	Error  uint64    `json:"error"`
	Fatal  uint64    `json:"fatal"`
}

type LogPage struct {
	Items           []LogEntry  `json:"items"`
	Trend           []LogBucket `json:"trend"`
	Total           uint64      `json:"total"`
	NextCursor      string      `json:"nextCursor"`
	IntervalSeconds int         `json:"intervalSeconds"`
}

type LogRepository struct{ database *sql.DB }

func NewLogRepository(database *sql.DB) *LogRepository { return &LogRepository{database: database} }

func NormalizeLogFilters(f LogFilters) (LogFilters, error) {
	f.From, f.To = f.From.UTC(), f.To.UTC()
	f.Level = strings.ToLower(strings.TrimSpace(f.Level))
	f.Country = strings.ToUpper(strings.TrimSpace(f.Country))
	f.Query = strings.TrimSpace(f.Query)
	if f.Limit == 0 {
		f.Limit = 50
	}
	if f.ProjectID == uuid.Nil || f.From.IsZero() || !f.From.Before(f.To) || f.To.Sub(f.From) > 30*24*time.Hour ||
		f.Limit < 1 || f.Limit > 100 || !boundedQueryDimension(f.Environment, 64) || !boundedQueryDimension(f.Release, 128) ||
		!boundedQueryDimension(f.Route, 512) || !boundedQueryDimension(f.Browser, 128) || !boundedQueryDimension(f.DeviceType, 64) ||
		!boundedQueryDimension(f.Country, 2) || !boundedQueryDimension(f.Query, 1024) || len(f.Cursor) > 256 ||
		(f.Level != "" && !event.ValidLogLevel(f.Level)) {
		return LogFilters{}, ErrInvalidLogFilters
	}
	if f.Cursor != "" {
		cursor, err := decodeEventCursor(f.Cursor)
		if err != nil || cursor.Timestamp.Before(f.From) || !cursor.Timestamp.Before(f.To) {
			return LogFilters{}, ErrInvalidLogFilters
		}
	}
	if _, _, err := logSearch(f.Query); err != nil {
		return LogFilters{}, err
	}
	return f, nil
}

// Search is a deliberately small AND-only grammar: words, quoted phrases, field:value.
// Identifiers are allowlisted; user text and attribute keys are always bound parameters.
func logSearch(input string) (string, []any, error) {
	var tokens []string
	var current strings.Builder
	var quoted, escaped bool
	for _, r := range input {
		if escaped {
			switch r {
			case 'n':
				current.WriteRune('\n')
			case 'r':
				current.WriteRune('\r')
			case 't':
				current.WriteRune('\t')
			default:
				current.WriteRune(r)
			}
			escaped = false
			continue
		}
		if r == '\\' {
			escaped = true
			continue
		}
		if r == '"' {
			quoted = !quoted
			continue
		}
		if unicode.IsSpace(r) && !quoted {
			if current.Len() > 0 {
				tokens = append(tokens, current.String())
				current.Reset()
			}
		} else {
			current.WriteRune(r)
		}
	}
	if quoted || escaped {
		return "", nil, ErrInvalidLogFilters
	}
	if current.Len() > 0 {
		tokens = append(tokens, current.String())
	}
	if len(tokens) > 12 {
		return "", nil, ErrInvalidLogFilters
	}
	columns := map[string]string{
		"severity": "log_level", "level": "log_level", "logger": "log_logger",
		"environment": "environment", "release": "release", "route": "route",
		"browser": "browser", "device": "device_type", "country": "country",
		"trace_id": "trace_id", "session_id": "session_id",
		"user.id": "user_id", "user_id": "user_id", "userId": "user_id",
		"anonymous_user_id": "anonymous_user_id", "anonymousUserId": "anonymous_user_id",
	}
	var clauses []string
	var args []any
	for _, token := range tokens {
		if token == "OR" || token == "AND" || token == "NOT" {
			return "", nil, ErrInvalidLogFilters
		}
		key, value, field := strings.Cut(token, ":")
		if !field {
			clauses = append(clauses, "position(log_message,?)>0")
			args = append(args, token)
			continue
		}
		attributeKey := strings.TrimPrefix(key, "attributes.")
		if value == "" || !behaviorPropertyPattern.MatchString(attributeKey) || strings.HasPrefix(value, ">") || strings.HasPrefix(value, "<") {
			return "", nil, ErrInvalidLogFilters
		}
		if strings.HasPrefix(key, "attributes.") {
			clauses = append(clauses, "attributes[?]=?")
			args = append(args, attributeKey, value)
			continue
		}
		if key == "message" {
			clauses = append(clauses, "position(log_message,?)>0")
			args = append(args, value)
			continue
		}
		if column, ok := columns[key]; ok {
			if column == "log_level" {
				value = strings.ToLower(value)
				if !event.ValidLogLevel(value) {
					return "", nil, ErrInvalidLogFilters
				}
			}
			if column == "session_id" {
				if _, err := uuid.Parse(value); err != nil {
					return "", nil, ErrInvalidLogFilters
				}
			}
			clauses = append(clauses, column+"=?")
			args = append(args, value)
		} else {
			clauses = append(clauses, "attributes[?]=?")
			args = append(args, key, value)
		}
	}
	return strings.Join(clauses, " AND "), args, nil
}

func logWhere(f LogFilters) (string, []any) {
	where := "project_id=? AND event_type='log' AND timestamp>=? AND timestamp<? AND raw_expires_at>now64(3) AND NOT has(ingest_flags,'synthetic')"
	args := []any{f.ProjectID, f.From, f.To}
	for _, pair := range [][2]string{{"environment", f.Environment}, {"release", f.Release}, {"route", f.Route}, {"browser", f.Browser}, {"device_type", f.DeviceType}, {"country", f.Country}, {"log_level", f.Level}} {
		if pair[1] != "" {
			where += " AND " + pair[0] + "=?"
			args = append(args, pair[1])
		}
	}
	search, searchArgs, _ := logSearch(f.Query)
	if search != "" {
		where += " AND " + search
		args = append(args, searchArgs...)
	}
	return where, args
}

// Bounded scans fail explicitly; never return a silently partial count as the total.
const logQuerySettings = " SETTINGS max_execution_time=8, max_rows_to_read=5000000, read_overflow_mode='throw'"

func (repository *LogRepository) List(ctx context.Context, requested LogFilters) (LogPage, error) {
	f, err := NormalizeLogFilters(requested)
	if err != nil {
		return LogPage{}, err
	}
	interval := 60
	for _, candidate := range []int{60, 300, 900, 3600, 21600, 86400} {
		interval = candidate
		if f.To.Sub(f.From).Seconds()/float64(candidate) <= 120 {
			break
		}
	}
	result := LogPage{Items: []LogEntry{}, Trend: []LogBucket{}, IntervalSeconds: interval}
	where, args := logWhere(f)
	rows, err := repository.database.QueryContext(ctx, fmt.Sprintf(`SELECT toStartOfInterval(timestamp,INTERVAL %d SECOND) AS bucket,
		countIf(log_level='trace'),countIf(log_level='debug'),countIf(log_level='info'),
		countIf(log_level='warn'),countIf(log_level='error'),countIf(log_level='fatal')
		FROM rum_events FINAL WHERE %s GROUP BY bucket ORDER BY bucket%s`, interval, where, logQuerySettings), args...)
	if err != nil {
		return LogPage{}, err
	}
	for rows.Next() {
		var bucket LogBucket
		if err = rows.Scan(&bucket.Bucket, &bucket.Trace, &bucket.Debug, &bucket.Info, &bucket.Warn, &bucket.Error, &bucket.Fatal); err != nil {
			rows.Close()
			return LogPage{}, err
		}
		bucket.Bucket = bucket.Bucket.UTC()
		result.Total += bucket.Trace + bucket.Debug + bucket.Info + bucket.Warn + bucket.Error + bucket.Fatal
		result.Trend = append(result.Trend, bucket)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return LogPage{}, err
	}
	if f.Cursor != "" {
		cursor, _ := decodeEventCursor(f.Cursor)
		where += " AND (timestamp,event_id)<(?,?)"
		args = append(args, cursor.Timestamp, cursor.EventID)
	}
	args = append(args, f.Limit+1)
	rows, err = repository.database.QueryContext(ctx, `SELECT event_id,timestamp,log_level,log_message,log_logger,
		environment,release,route,page_url,browser,device_type,country,session_id,user_id,anonymous_user_id,trace_id,span_id,attributes,sample_rate
		FROM rum_events FINAL WHERE `+where+` ORDER BY timestamp DESC,event_id DESC LIMIT ?`+logQuerySettings, args...)
	if err != nil {
		return LogPage{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var item LogEntry
		if err = rows.Scan(&item.EventID, &item.Timestamp, &item.Level, &item.Message, &item.Logger, &item.Environment, &item.Release,
			&item.Route, &item.PageURL, &item.Browser, &item.DeviceType, &item.Country, &item.SessionID, &item.UserID, &item.AnonymousUserID, &item.TraceID, &item.SpanID, &item.Attributes, &item.SampleRate); err != nil {
			return LogPage{}, err
		}
		item.Timestamp = item.Timestamp.UTC()
		if item.Attributes == nil {
			item.Attributes = map[string]string{}
		}
		result.Items = append(result.Items, item)
	}
	if err = rows.Err(); err != nil {
		return LogPage{}, err
	}
	if len(result.Items) > f.Limit {
		result.Items = result.Items[:f.Limit]
		last := result.Items[len(result.Items)-1]
		result.NextCursor = encodeEventCursor(last.Timestamp, last.EventID)
	}
	return result, nil
}
