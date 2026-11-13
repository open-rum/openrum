package query

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"openrum/internal/event"
	"openrum/internal/search"

	"github.com/google/uuid"
)

var ErrInvalidLogFilters = errors.New("invalid log filters or search syntax")

type LogFilters struct {
	ProjectID                                                 uuid.UUID
	From, To                                                  time.Time
	Environment, Release, Route, Browser, DeviceType, Country string
	Level, Query, Cursor                                      string
	Anchor, AnchorAt, Direction                               string
	Limit                                                     int
	MaxPoints                                                 int
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
	From            time.Time   `json:"from"`
	To              time.Time   `json:"to"`
	Items           []LogEntry  `json:"items"`
	Trend           []LogBucket `json:"trend"`
	Total           uint64      `json:"total"`
	NextCursor      string      `json:"nextCursor"`
	PreviousCursor  string      `json:"previousCursor,omitempty"`
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
		f.Limit < 1 || f.Limit > 100 || !validSeriesPointBudget(f.MaxPoints) || !boundedQueryDimension(f.Environment, 64) || !boundedQueryDimension(f.Release, 128) ||
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
	if f.Anchor != "" || f.AnchorAt != "" {
		id, idErr := uuid.Parse(f.Anchor)
		at, timeErr := time.Parse(time.RFC3339Nano, f.AnchorAt)
		if idErr != nil || id == uuid.Nil || timeErr != nil || at.IsZero() {
			return LogFilters{}, ErrInvalidLogFilters
		}
	}
	if f.Direction != "" && (f.Anchor == "" || f.Cursor == "" || (f.Direction != "before" && f.Direction != "after")) {
		return LogFilters{}, ErrInvalidLogFilters
	}

	if _, _, err := logSearch(f.Query); err != nil {
		return LogFilters{}, err
	}
	return f, nil
}

// logSchema is what the Logs search accepts. Any name it does not know is an attribute, as it
// always has been, and a bare word or message:x looks inside the message, case-sensitively.
var logSchema = search.Schema{
	Fields: []search.Field{
		{Key: "event_id", Exprs: []string{"event_id"}, Type: search.UUID},
		{Key: "level", Aliases: []string{"severity"}, Exprs: []string{"log_level"}, Type: search.Enum, Normalize: func(value string) (string, bool) {
			value = strings.ToLower(value)
			return value, event.ValidLogLevel(value)
		}},
		{Key: "logger", Exprs: []string{"log_logger"}, Type: search.Text},
		{Key: "environment", Exprs: []string{"environment"}, Type: search.Enum},
		{Key: "release", Exprs: []string{"release"}, Type: search.Text},
		{Key: "route", Exprs: []string{"route"}, Type: search.Text},
		{Key: "browser", Exprs: []string{"browser"}, Type: search.Enum},
		{Key: "device", Aliases: []string{"deviceType"}, Exprs: []string{"device_type"}, Type: search.Enum},
		{Key: "country", Exprs: []string{"country"}, Type: search.Enum, Normalize: upperCountry},
		{Key: "trace_id", Aliases: []string{"traceId"}, Exprs: []string{"trace_id"}, Type: search.Text},
		{Key: "session_id", Aliases: []string{"sessionId"}, Exprs: []string{"session_id"}, Type: search.UUID},
		{Key: "user.id", Aliases: []string{"user_id", "userId"}, Exprs: []string{"user_id"}, Type: search.Text},
		{Key: "anonymous_user_id", Aliases: []string{"anonymousUserId"}, Exprs: []string{"anonymous_user_id"}, Type: search.Text},
		{Key: "message", Exprs: []string{"log_message"}, Type: search.Text, CaseSensitive: true, EqualsMeansContains: true},
	},
	AttributeExpr:              "attributes",
	UnknownFieldsAreAttributes: true,
	AttributeKey:               behaviorPropertyPattern.MatchString,
	FreeText:                   "message",
}

func upperCountry(value string) (string, bool) {
	value = strings.ToUpper(value)
	return value, len(value) == 2
}

// logSearch turns the q parameter into conditions joined with AND.
func logSearch(input string) (string, []any, error) {
	compiled, _, err := logSchema.ParseAndCompile(input, search.Raw)
	if err != nil {
		return "", nil, errors.Join(ErrInvalidLogFilters, err)
	}
	where, args := compiled.WhereSQL()
	return strings.TrimPrefix(where, " AND "), args, nil
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
	interval := logInterval(f)
	result := LogPage{From: f.From, To: f.To, Items: []LogEntry{}, Trend: []LogBucket{}, IntervalSeconds: interval}
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
			_ = rows.Close()
			return LogPage{}, err
		}
		bucket.Bucket = bucket.Bucket.UTC()
		result.Total += bucket.Trace + bucket.Debug + bucket.Info + bucket.Warn + bucket.Error + bucket.Fatal
		result.Trend = append(result.Trend, bucket)
	}
	err = rows.Err()
	_ = rows.Close()
	if err != nil {
		return LogPage{}, err
	}
	if f.MaxPoints > 0 {
		// This successful, bounded aggregate proves that absent buckets contain no logs.
		byTime := make(map[int64]LogBucket, len(result.Trend))
		for _, bucket := range result.Trend {
			byTime[bucket.Bucket.Unix()] = bucket
		}
		result.Trend = nil
		for _, at := range seriesBuckets(f.From, f.To, time.Duration(interval)*time.Second) {
			bucket := byTime[at.Unix()]
			bucket.Bucket = at
			result.Trend = append(result.Trend, bucket)
		}
	}
	result.Items, result.PreviousCursor, result.NextCursor, err = loadLogItems(f, func(window logWindow) ([]LogEntry, error) {
		statement, arguments := logWindowQuery(f, window)
		rows, readErr := repository.database.QueryContext(ctx, statement, arguments...)
		if readErr != nil {
			return nil, readErr
		}
		defer func() { _ = rows.Close() }()
		items := []LogEntry{}
		for rows.Next() {
			var item LogEntry
			if readErr = rows.Scan(&item.EventID, &item.Timestamp, &item.Level, &item.Message, &item.Logger, &item.Environment, &item.Release,
				&item.Route, &item.PageURL, &item.Browser, &item.DeviceType, &item.Country, &item.SessionID, &item.UserID, &item.AnonymousUserID, &item.TraceID, &item.SpanID, &item.Attributes, &item.SampleRate); readErr != nil {
				return nil, readErr
			}
			item.Timestamp = item.Timestamp.UTC()
			if item.Attributes == nil {
				item.Attributes = map[string]string{}
			}
			items = append(items, item)
		}
		return items, rows.Err()
	})
	return result, err
}

// Each window has a deterministic timestamp + UUID boundary; context is always
// returned chronologically, including when fetching the preceding window.
type logWindow struct {
	pivot      *eventCursor
	comparison string
	ascending  bool
	limit      int
}

func logWindowQuery(f LogFilters, window logWindow) (string, []any) {
	where, args := logWhere(f)
	if window.pivot != nil {
		// Binding time.Time can lose milliseconds in ClickHouse's SQL driver.
		where += " AND (timestamp,event_id)" + window.comparison + "(toDateTime64(?,3,'UTC'),?)"
		args = append(args, window.pivot.Timestamp.UTC().Format("2006-01-02 15:04:05.000"), window.pivot.EventID)
	}
	order := "DESC"
	if window.ascending {
		order = "ASC"
	}
	args = append(args, window.limit+1)
	return `SELECT event_id,timestamp,log_level,log_message,log_logger,
		environment,release,route,page_url,browser,device_type,country,session_id,user_id,anonymous_user_id,trace_id,span_id,attributes,sample_rate
		FROM rum_events FINAL WHERE ` + where + ` ORDER BY timestamp ` + order + `,event_id ` + order + ` LIMIT ?` + logQuerySettings, args
}

func loadLogItems(f LogFilters, fetch func(logWindow) ([]LogEntry, error)) (items []LogEntry, previous, next string, err error) {
	items = []LogEntry{}
	cursor, _ := decodeEventCursor(f.Cursor)
	contextMode := f.Anchor != ""
	windows := []logWindow{{pivot: cursor, comparison: "<", limit: f.Limit}}
	if contextMode {
		if cursor == nil {
			at, _ := time.Parse(time.RFC3339Nano, f.AnchorAt)
			pivot := &eventCursor{Timestamp: at, EventID: uuid.MustParse(f.Anchor)}
			windows = []logWindow{
				{pivot: pivot, comparison: "<", limit: f.Limit / 2},
				{pivot: pivot, comparison: ">=", ascending: true, limit: f.Limit - f.Limit/2},
			}
		} else if f.Direction != "before" {
			windows[0].comparison, windows[0].ascending = ">", true
		}
	}
	hasPrevious, hasNext := false, false
	for _, window := range windows {
		if window.limit == 0 {
			continue
		}
		batch, readErr := fetch(window)
		if readErr != nil {
			return nil, "", "", readErr
		}
		more := len(batch) > window.limit
		if more {
			batch = batch[:window.limit]
		}
		if contextMode {
			if window.ascending {
				hasNext = more
				if cursor != nil {
					hasPrevious = true
				}
			} else {
				hasPrevious = more
				if cursor != nil {
					hasNext = true
				}
				slices.Reverse(batch)
			}
		} else {
			hasNext = more
		}
		items = append(items, batch...)
	}
	if len(items) > 0 {
		if hasPrevious {
			previous = encodeEventCursor(items[0].Timestamp, items[0].EventID)
		}
		if hasNext {
			last := items[len(items)-1]
			next = encodeEventCursor(last.Timestamp, last.EventID)
		}
	}
	return items, previous, next, nil
}

func logInterval(f LogFilters) int {
	if f.MaxPoints > 0 {
		return int(adaptiveSeriesInterval(f.To.Sub(f.From), f.MaxPoints) / time.Second)
	}
	// Preserve the historical resolution for clients that have not opted in.
	interval := 60
	for _, candidate := range []int{60, 300, 900, 3600, 21600, 86400} {
		interval = candidate
		if f.To.Sub(f.From).Seconds()/float64(candidate) <= 120 {
			break
		}
	}
	return interval
}
