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

	"openrum/internal/metadata"
)

var ErrInvalidIssueFilters = errors.New("invalid issue filters")

type IssueStateLookup interface {
	ListIssueStates(context.Context, uuid.UUID, []string) (map[string]metadata.IssueState, error)
}

type IssueFilters struct {
	ProjectID   uuid.UUID
	From        time.Time
	To          time.Time
	Environment string
	Title       string
	ErrorType   string
	UserID      string
	Release     string
	Route       string
	Browser     string
	DeviceType  string
	Country     string
	Fingerprint string
	Status      metadata.IssueStatus
	Sort        string
	Limit       int
	Cursor      string
}

type IssueSummary struct {
	Fingerprint        string               `json:"fingerprint"`
	FingerprintVersion uint16               `json:"fingerprintVersion"`
	Title              string               `json:"title"`
	ErrorType          string               `json:"errorType"`
	Events             uint64               `json:"events"`
	Users              uint64               `json:"users"`
	Sessions           uint64               `json:"sessions"`
	FirstSeenAt        time.Time            `json:"firstSeenAt"`
	LastSeenAt         time.Time            `json:"lastSeenAt"`
	Status             metadata.IssueStatus `json:"status"`
	AssigneeUserID     *uuid.UUID           `json:"assigneeUserId"`
	ResolvedInRelease  *uuid.UUID           `json:"resolvedInReleaseId"`
}

type IssueFacet struct {
	Value  string `json:"value"`
	Events uint64 `json:"events"`
	Users  uint64 `json:"users"`
}

type IssueFacets struct {
	Environments []IssueFacet `json:"environments"`
	Releases     []IssueFacet `json:"releases"`
	Browsers     []IssueFacet `json:"browsers"`
	DeviceTypes  []IssueFacet `json:"deviceTypes"`
	Countries    []IssueFacet `json:"countries"`
}

type IssuePage struct {
	Issues     []IssueSummary `json:"issues"`
	NextCursor string         `json:"nextCursor,omitempty"`
	Facets     IssueFacets    `json:"facets"`
}

type IssueTrendPoint struct {
	Bucket   time.Time `json:"bucket"`
	Events   uint64    `json:"events"`
	Users    uint64    `json:"users"`
	Sessions uint64    `json:"sessions"`
}

type IssueOverviewPoint struct {
	Bucket          time.Time `json:"bucket"`
	Events          uint64    `json:"events"`
	AnonymousUsers  uint64    `json:"anonymousUsers"`
	IdentifiedUsers uint64    `json:"identifiedUsers"`
	Sessions        uint64    `json:"sessions"`
	Pages           uint64    `json:"pages"`
}

type IssueDistributionItem struct {
	Value  string `json:"value"`
	Events uint64 `json:"events"`
}

type IssueOverview struct {
	From            time.Time               `json:"from"`
	To              time.Time               `json:"to"`
	IntervalSeconds int64                   `json:"intervalSeconds"`
	Trend           []IssueOverviewPoint    `json:"trend"`
	ErrorTypes      []IssueDistributionItem `json:"errorTypes"`
	Pages           []IssueDistributionItem `json:"pages"`
	Countries       []IssueDistributionItem `json:"countries"`
}

type IssuesRepository struct {
	database *sql.DB
	states   IssueStateLookup
}

func NewIssuesRepository(database *sql.DB, states IssueStateLookup) *IssuesRepository {
	return &IssuesRepository{database: database, states: states}
}

func (repository *IssuesRepository) List(ctx context.Context, requested IssueFilters) (IssuePage, error) {
	filters, cursor, err := normalizeIssueFilters(requested)
	if err != nil {
		return IssuePage{}, err
	}
	where, arguments := issueWhere(filters)
	query := `SELECT fingerprint, max(fingerprint_version), argMaxMerge(error_type) AS error_type_value, argMaxMerge(error_message) AS issue_title,
  uniqCombined64Merge(events) AS event_count, uniqCombined64Merge(users) AS user_count, uniqCombined64Merge(sessions) AS session_count,
  minMerge(first_seen) AS first_seen_at, maxMerge(last_seen) AS last_seen_at
FROM issue_metrics_5m WHERE ` + where + `
GROUP BY fingerprint`
	usesRawEvents := filters.UserID != ""
	if usesRawEvents {
		where, arguments = issueEventWhere(filters)
		query = `SELECT fingerprint, max(fingerprint_version), argMax(error_type, timestamp) AS error_type_value, argMax(error_message, timestamp) AS issue_title,
  uniqCombined64(event_id) AS event_count, uniqCombined64If(anonymous_user_id, anonymous_user_id != '') AS user_count,
  uniqCombined64(session_id) AS session_count, min(timestamp) AS first_seen_at, max(timestamp) AS last_seen_at
FROM rum_events WHERE ` + where + `
GROUP BY fingerprint`
	}
	having := make([]string, 0, 3)
	if filters.ErrorType != "" && !usesRawEvents {
		having = append(having, "error_type_value = ?")
		arguments = append(arguments, filters.ErrorType)
	}
	if filters.Title != "" && !usesRawEvents {
		having = append(having, "positionCaseInsensitiveUTF8(issue_title, ?) > 0")
		arguments = append(arguments, filters.Title)
	}
	if cursor != nil {
		primary, value := "event_count", any(cursor.Events)
		if filters.Sort == "users" {
			primary, value = "user_count", cursor.Users
		}
		if filters.Sort == "last_seen" {
			having = append(having, `(last_seen_at < ? OR (last_seen_at = ? AND fingerprint > ?))`)
			arguments = append(arguments, cursor.LastSeenAt, cursor.LastSeenAt, cursor.Fingerprint)
		} else {
			having = append(having, fmt.Sprintf(`(%s < ? OR (%s = ? AND last_seen_at < ?) OR
  (%s = ? AND last_seen_at = ? AND fingerprint > ?))`, primary, primary, primary))
			arguments = append(arguments, value, value, cursor.LastSeenAt, value, cursor.LastSeenAt, cursor.Fingerprint)
		}
	}
	if len(having) > 0 {
		query += ` HAVING ` + strings.Join(having, " AND ")
	}
	candidateLimit := min(max(filters.Limit*4, filters.Limit+1), 1000)
	order := "event_count DESC, last_seen_at DESC, fingerprint ASC"
	if filters.Sort == "users" {
		order = "user_count DESC, last_seen_at DESC, fingerprint ASC"
	} else if filters.Sort == "last_seen" {
		order = "last_seen_at DESC, fingerprint ASC"
	}
	query += ` ORDER BY ` + order + ` LIMIT ?`
	arguments = append(arguments, candidateLimit)
	rows, err := repository.database.QueryContext(ctx, query, arguments...)
	if err != nil {
		return IssuePage{}, fmt.Errorf("query issues: %w", err)
	}
	candidates, err := scanIssueCandidates(rows)
	if err != nil {
		return IssuePage{}, err
	}
	states := map[string]metadata.IssueState{}
	if repository.states != nil && len(candidates) > 0 {
		fingerprints := make([]string, len(candidates))
		for index := range candidates {
			fingerprints[index] = candidates[index].Fingerprint
		}
		states, err = repository.states.ListIssueStates(ctx, filters.ProjectID, fingerprints)
		if err != nil {
			return IssuePage{}, fmt.Errorf("query issue states: %w", err)
		}
	}
	issues := make([]IssueSummary, 0, filters.Limit)
	consumed := 0
	for _, issue := range candidates {
		consumed++
		issue.Status = metadata.IssueStatusUnresolved
		if state, ok := states[issue.Fingerprint]; ok {
			issue.Status = state.Status
			issue.AssigneeUserID = state.AssigneeUserID
			issue.ResolvedInRelease = state.ResolvedInRelease
		}
		if filters.Status != "" && issue.Status != filters.Status {
			continue
		}
		issues = append(issues, issue)
		if len(issues) == filters.Limit {
			break
		}
	}
	next := ""
	if consumed > 0 && (consumed < len(candidates) || len(candidates) == candidateLimit) {
		next = encodeIssueCursor(candidates[consumed-1], filters.Sort)
	}
	facets, err := repository.readFacets(ctx, filters)
	if err != nil {
		return IssuePage{}, err
	}
	return IssuePage{Issues: issues, NextCursor: next, Facets: facets}, nil
}

func (repository *IssuesRepository) Trend(ctx context.Context, requested IssueFilters, fingerprint string) ([]IssueTrendPoint, error) {
	filters, _, err := normalizeIssueFilters(requested)
	if err != nil || fingerprint == "" || len(fingerprint) > 128 {
		return nil, ErrInvalidIssueFilters
	}
	where, arguments := issueWhere(filters)
	arguments = append(arguments, fingerprint)
	interval := ConsoleSeriesInterval(filters.To.Sub(filters.From), 5*time.Minute)
	minutes := int(interval / time.Minute)
	rows, err := repository.database.QueryContext(ctx, fmt.Sprintf(`SELECT
  toStartOfInterval(bucket, INTERVAL %d MINUTE), uniqCombined64Merge(events),
  uniqCombined64Merge(users), uniqCombined64Merge(sessions)
FROM issue_metrics_5m WHERE %s AND fingerprint = ?
GROUP BY 1 ORDER BY 1`, minutes, where), arguments...)
	if err != nil {
		return nil, fmt.Errorf("query issue trend: %w", err)
	}
	defer func() { _ = rows.Close() }()
	points := make([]IssueTrendPoint, 0)
	for rows.Next() {
		var point IssueTrendPoint
		if err := rows.Scan(&point.Bucket, &point.Events, &point.Users, &point.Sessions); err != nil {
			return nil, fmt.Errorf("scan issue trend: %w", err)
		}
		point.Bucket = point.Bucket.UTC()
		points = append(points, point)
	}
	return points, rows.Err()
}

// Overview reads raw error events so the Console can distinguish anonymous
// visitors from explicitly identified business users and count affected page
// instances. Those dimensions are intentionally not approximated from the
// issue rollup because the rollup does not retain user_id or page_id.
func (repository *IssuesRepository) Overview(ctx context.Context, requested IssueFilters) (IssueOverview, error) {
	requested.Cursor = ""
	filters, _, err := normalizeIssueFilters(requested)
	if err != nil {
		return IssueOverview{}, err
	}
	where, arguments := issueEventWhere(filters)
	interval := ConsoleSeriesInterval(filters.To.Sub(filters.From), time.Minute)
	minutes := int(interval / time.Minute)
	rows, err := repository.database.QueryContext(ctx, fmt.Sprintf(`SELECT
  toStartOfInterval(timestamp, INTERVAL %d MINUTE) AS bucket,
  uniqCombined64(event_id),
  uniqCombined64If(anonymous_user_id, anonymous_user_id != ''),
  uniqCombined64If(user_id, user_id != ''),
  uniqCombined64If(session_id, session_id != toUUID('00000000-0000-0000-0000-000000000000')),
  uniqCombined64If(page_id, page_id != toUUID('00000000-0000-0000-0000-000000000000'))
FROM rum_events WHERE %s
GROUP BY bucket ORDER BY bucket`, minutes, where), arguments...)
	if err != nil {
		return IssueOverview{}, fmt.Errorf("query issue overview trend: %w", err)
	}
	trend := make([]IssueOverviewPoint, 0)
	for rows.Next() {
		var point IssueOverviewPoint
		if err := rows.Scan(&point.Bucket, &point.Events, &point.AnonymousUsers, &point.IdentifiedUsers, &point.Sessions, &point.Pages); err != nil {
			_ = rows.Close()
			return IssueOverview{}, fmt.Errorf("scan issue overview trend: %w", err)
		}
		point.Bucket = point.Bucket.UTC()
		trend = append(trend, point)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return IssueOverview{}, fmt.Errorf("scan issue overview trend: %w", err)
	}
	_ = rows.Close()

	distributionQuery := `SELECT dimension, value, events FROM (
  SELECT 'error_type' AS dimension, if(error_type = '', 'unknown', error_type) AS value, uniqCombined64(event_id) AS events
  FROM rum_events WHERE ` + where + ` GROUP BY value
  UNION ALL
  SELECT 'page' AS dimension, if(route = '', if(page_url_normalized = '', 'unknown', page_url_normalized), route) AS value, uniqCombined64(event_id) AS events
  FROM rum_events WHERE ` + where + ` GROUP BY value
  UNION ALL
  SELECT 'country' AS dimension, if(country = '', 'unknown', toString(country)) AS value, uniqCombined64(event_id) AS events
  FROM rum_events WHERE ` + where + ` GROUP BY value
) ORDER BY dimension, events DESC, value LIMIT 7 BY dimension`
	distributionArguments := make([]any, 0, len(arguments)*3)
	for range 3 {
		distributionArguments = append(distributionArguments, arguments...)
	}
	distributionRows, err := repository.database.QueryContext(ctx, distributionQuery, distributionArguments...)
	if err != nil {
		return IssueOverview{}, fmt.Errorf("query issue overview distribution: %w", err)
	}
	defer func() { _ = distributionRows.Close() }()
	overview := IssueOverview{
		From: filters.From, To: filters.To, IntervalSeconds: int64(interval / time.Second),
		Trend: trend, ErrorTypes: []IssueDistributionItem{}, Pages: []IssueDistributionItem{}, Countries: []IssueDistributionItem{},
	}
	for distributionRows.Next() {
		var dimension string
		var item IssueDistributionItem
		if err := distributionRows.Scan(&dimension, &item.Value, &item.Events); err != nil {
			return IssueOverview{}, fmt.Errorf("scan issue overview distribution: %w", err)
		}
		switch dimension {
		case "error_type":
			overview.ErrorTypes = append(overview.ErrorTypes, item)
		case "page":
			overview.Pages = append(overview.Pages, item)
		case "country":
			overview.Countries = append(overview.Countries, item)
		}
	}
	if err := distributionRows.Err(); err != nil {
		return IssueOverview{}, fmt.Errorf("scan issue overview distribution: %w", err)
	}
	return overview, nil
}

func (repository *IssuesRepository) readFacets(ctx context.Context, filters IssueFilters) (IssueFacets, error) {
	where, arguments := issueWhere(filters)
	query := `SELECT dimension, value, uniqCombined64Merge(events), uniqCombined64Merge(users) FROM (` +
		facetSelect("environment", where) + ` UNION ALL ` + facetSelect("release", where) + ` UNION ALL ` +
		facetSelect("browser", where) + ` UNION ALL ` + facetSelect("device_type", where) + ` UNION ALL ` + facetSelect("country", where) +
		`) GROUP BY dimension, value ORDER BY dimension, uniqCombined64Merge(events) DESC, value LIMIT 100 BY dimension`
	allArguments := make([]any, 0, len(arguments)*5)
	for range 5 {
		allArguments = append(allArguments, arguments...)
	}
	rows, err := repository.database.QueryContext(ctx, query, allArguments...)
	if err != nil {
		return IssueFacets{}, fmt.Errorf("query issue facets: %w", err)
	}
	defer func() { _ = rows.Close() }()
	facets := IssueFacets{
		Environments: []IssueFacet{}, Releases: []IssueFacet{}, Browsers: []IssueFacet{}, DeviceTypes: []IssueFacet{}, Countries: []IssueFacet{},
	}
	for rows.Next() {
		var dimension string
		var facet IssueFacet
		if err := rows.Scan(&dimension, &facet.Value, &facet.Events, &facet.Users); err != nil {
			return IssueFacets{}, fmt.Errorf("scan issue facet: %w", err)
		}
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

func facetSelect(dimension, where string) string {
	return fmt.Sprintf(`SELECT '%s' AS dimension, %s AS value, events, users FROM issue_metrics_5m WHERE %s`, dimension, dimension, where)
}

type issueCursor struct {
	Events      uint64    `json:"e"`
	Users       uint64    `json:"u"`
	LastSeenAt  time.Time `json:"l"`
	Fingerprint string    `json:"f"`
	Sort        string    `json:"s"`
}

func normalizeIssueFilters(filters IssueFilters) (IssueFilters, *issueCursor, error) {
	if filters.ProjectID == uuid.Nil || filters.From.IsZero() || filters.To.IsZero() || !filters.From.Before(filters.To) || filters.To.Sub(filters.From) > 30*24*time.Hour {
		return IssueFilters{}, nil, ErrInvalidIssueFilters
	}
	if filters.Limit == 0 {
		filters.Limit = 25
	}
	if filters.Sort == "" {
		filters.Sort = "events"
	}
	if filters.Limit < 1 || filters.Limit > 100 || !validIssueStatus(filters.Status) ||
		(filters.Sort != "events" && filters.Sort != "users" && filters.Sort != "last_seen") ||
		!boundedQueryDimension(filters.Environment, 64) || !boundedQueryDimension(filters.Release, 128) ||
		!boundedQueryDimension(filters.Route, 512) || !boundedQueryDimension(filters.Browser, 128) ||
		!boundedQueryDimension(filters.DeviceType, 64) || !boundedQueryDimension(filters.Country, 2) ||
		!boundedQueryDimension(filters.Title, 200) || !boundedQueryDimension(filters.ErrorType, 128) ||
		!boundedQueryDimension(filters.UserID, 128) ||
		!boundedQueryDimension(filters.Fingerprint, 128) {
		return IssueFilters{}, nil, ErrInvalidIssueFilters
	}
	filters.From, filters.To = filters.From.UTC(), filters.To.UTC()
	var cursor *issueCursor
	if filters.Cursor != "" {
		decoded, err := base64.RawURLEncoding.DecodeString(filters.Cursor)
		if err != nil || json.Unmarshal(decoded, &cursor) != nil || cursor == nil || cursor.Fingerprint == "" || cursor.LastSeenAt.IsZero() || cursor.Sort != filters.Sort {
			return IssueFilters{}, nil, ErrInvalidIssueFilters
		}
		cursor.LastSeenAt = cursor.LastSeenAt.UTC()
	}
	return filters, cursor, nil
}

func NormalizeIssueFilters(filters IssueFilters) (IssueFilters, error) {
	normalized, _, err := normalizeIssueFilters(filters)
	return normalized, err
}

func validIssueStatus(status metadata.IssueStatus) bool {
	return status == "" || status == metadata.IssueStatusUnresolved || status == metadata.IssueStatusResolved || status == metadata.IssueStatusIgnored
}

func issueWhere(filters IssueFilters) (string, []any) {
	clauses := []string{"project_id = ?", "bucket >= ?", "bucket < ?"}
	arguments := []any{filters.ProjectID, filters.From, filters.To}
	for _, filter := range []struct{ column, value string }{
		{"environment", filters.Environment}, {"release", filters.Release}, {"route", filters.Route},
		{"browser", filters.Browser}, {"device_type", filters.DeviceType}, {"country", filters.Country},
		{"fingerprint", filters.Fingerprint},
	} {
		if filter.value != "" {
			clauses = append(clauses, filter.column+" = ?")
			arguments = append(arguments, filter.value)
		}
	}
	return strings.Join(clauses, " AND "), arguments
}

func issueEventWhere(filters IssueFilters) (string, []any) {
	clauses := []string{
		"project_id = ?", "event_type = 'error'", "timestamp >= ?", "timestamp < ?", "NOT has(ingest_flags, 'synthetic')",
	}
	arguments := []any{filters.ProjectID, filters.From, filters.To}
	for _, filter := range []struct{ column, value string }{
		{"environment", filters.Environment}, {"release", filters.Release}, {"route", filters.Route},
		{"browser", filters.Browser}, {"device_type", filters.DeviceType}, {"country", filters.Country},
		{"error_type", filters.ErrorType}, {"fingerprint", filters.Fingerprint}, {"user_id", filters.UserID},
	} {
		if filter.value != "" {
			clauses = append(clauses, filter.column+" = ?")
			arguments = append(arguments, filter.value)
		}
	}
	if filters.Title != "" {
		clauses = append(clauses, "positionCaseInsensitiveUTF8(error_message, ?) > 0")
		arguments = append(arguments, filters.Title)
	}
	return strings.Join(clauses, " AND "), arguments
}

func scanIssueCandidates(rows *sql.Rows) ([]IssueSummary, error) {
	defer func() { _ = rows.Close() }()
	issues := make([]IssueSummary, 0)
	for rows.Next() {
		var issue IssueSummary
		if err := rows.Scan(&issue.Fingerprint, &issue.FingerprintVersion, &issue.ErrorType, &issue.Title,
			&issue.Events, &issue.Users, &issue.Sessions, &issue.FirstSeenAt, &issue.LastSeenAt); err != nil {
			return nil, fmt.Errorf("scan issue: %w", err)
		}
		issue.FirstSeenAt, issue.LastSeenAt = issue.FirstSeenAt.UTC(), issue.LastSeenAt.UTC()
		issues = append(issues, issue)
	}
	return issues, rows.Err()
}

func encodeIssueCursor(issue IssueSummary, sort string) string {
	encoded, _ := json.Marshal(issueCursor{Events: issue.Events, Users: issue.Users, LastSeenAt: issue.LastSeenAt, Fingerprint: issue.Fingerprint, Sort: sort})
	return base64.RawURLEncoding.EncodeToString(encoded)
}
