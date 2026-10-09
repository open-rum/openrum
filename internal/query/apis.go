package query

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
)

var ErrInvalidAPIFilters = errors.New("invalid API filters")

// minimumAPISamples mirrors the performance workspace: quantiles below this
// many requests rank last and are labelled as insufficient data.
const minimumAPISamples = 75

type APIFilters struct {
	ProjectID   uuid.UUID
	From        time.Time
	To          time.Time
	Environment string
	Release     string
	Route       string
	// Methods narrows the ranked list; Method and URL together select the one
	// endpoint whose detail is returned.
	Methods []string
	Method  string
	URL     string
	Search  string
	Sort    string
	Compare bool
}

// apiSorts maps each accepted sort to its ClickHouse ordering. Sorts driven by
// a ratio or a quantile rank endpoints below minimumAPISamples last, because a
// handful of requests otherwise produces a misleading leader.
var apiSorts = map[string]string{
	"requests": "requests_count DESC,api_method,api_url_normalized",
	"failures": "failures_count DESC,requests_count DESC,api_method,api_url_normalized",
	"p95": fmt.Sprintf("(requests_count>=%d) DESC,duration_p95_value DESC,requests_count DESC,api_method,api_url_normalized",
		minimumAPISamples),
	"failureRate": fmt.Sprintf("(requests_count>=%d) DESC,failures_count/greatest(requests_count,1) DESC,requests_count DESC,api_method,api_url_normalized",
		minimumAPISamples),
	"impact": "requests_count*coalesce(duration_p95_value,0) DESC,requests_count DESC,api_method,api_url_normalized",
}

type APIFacet struct {
	Value    string `json:"value"`
	Requests uint64 `json:"requests"`
}

// APIFacets lists the values worth filtering by. Each dimension ignores its own
// active filter so selecting a value never empties its own dropdown.
type APIFacets struct {
	Methods  []APIFacet `json:"methods"`
	Releases []APIFacet `json:"releases"`
	Routes   []APIFacet `json:"routes"`
}

type APIEndpoint struct {
	Method        string   `json:"method"`
	URL           string   `json:"url"`
	Requests      uint64   `json:"requests"`
	Estimated     float64  `json:"estimated"`
	Failures      uint64   `json:"failures"`
	ClientErrors  uint64   `json:"clientErrors"`
	ServerErrors  uint64   `json:"serverErrors"`
	NetworkErrors uint64   `json:"networkErrors"`
	P50           *float64 `json:"p50"`
	P75           *float64 `json:"p75"`
	P95           *float64 `json:"p95"`
	Sufficient    bool     `json:"sufficient"`
}

// ClientErrors is reported next to Failures rather than folded into it so the
// trend can show what a bucket's requests were made of: 4xx is a caller
// problem and is excluded from the failure rate, while Failures covers 5xx and
// transport errors.
type APITrendPoint struct {
	Bucket       time.Time `json:"bucket"`
	Requests     uint64    `json:"requests"`
	Failures     uint64    `json:"failures"`
	ClientErrors uint64    `json:"clientErrors"`
	P95          *float64  `json:"p95"`
}

type APIRouteFacet struct {
	Route    string `json:"route"`
	Requests uint64 `json:"requests"`
	Failures uint64 `json:"failures"`
}

type APISample struct {
	EventID    uuid.UUID `json:"eventId"`
	Timestamp  time.Time `json:"timestamp"`
	Status     uint16    `json:"status"`
	Failure    string    `json:"failure,omitempty"`
	DurationMS float64   `json:"durationMs"`
	Route      string    `json:"route,omitempty"`
	PageURL    string    `json:"pageUrl"`
	Release    string    `json:"release,omitempty"`
	Browser    string    `json:"browser,omitempty"`
	SessionID  uuid.UUID `json:"sessionId"`
	TraceID    string    `json:"traceId,omitempty"`
}

// APIStatusFacet reports one exact response status. A zero status with a
// failure reason is a request that never produced a response.
type APIStatusFacet struct {
	Status   uint16 `json:"status"`
	Failure  string `json:"failure,omitempty"`
	Requests uint64 `json:"requests"`
}

// APILatencyBucket counts requests whose duration falls in [FromMS, ToMS).
// A nil ToMS is the open-ended slowest bucket.
type APILatencyBucket struct {
	FromMS   float64  `json:"fromMs"`
	ToMS     *float64 `json:"toMs"`
	Requests uint64   `json:"requests"`
}

// APIPayload summarises response body size from the content-length header, so
// a slow endpoint can be attributed to payload weight rather than latency.
type APIPayload struct {
	Samples uint64   `json:"samples"`
	P50     *float64 `json:"p50"`
	P95     *float64 `json:"p95"`
}

// APIDimensionFacet compares one segment of traffic against the endpoint as a
// whole, which is how a reader tells "everyone is slow" from "one browser or
// one release is slow".
type APIDimensionFacet struct {
	Value    string   `json:"value"`
	Requests uint64   `json:"requests"`
	Failures uint64   `json:"failures"`
	P95      *float64 `json:"p95"`
}

type APIDimensions struct {
	Browsers         []APIDimensionFacet `json:"browsers"`
	OperatingSystems []APIDimensionFacet `json:"operatingSystems"`
	Devices          []APIDimensionFacet `json:"devices"`
	Countries        []APIDimensionFacet `json:"countries"`
	Releases         []APIDimensionFacet `json:"releases"`
}

type APIDetail struct {
	Endpoint   APIEndpoint        `json:"endpoint"`
	Trend      []APITrendPoint    `json:"trend"`
	Routes     []APIRouteFacet    `json:"routes"`
	Statuses   []APIStatusFacet   `json:"statuses"`
	Latency    []APILatencyBucket `json:"latency"`
	Payload    APIPayload         `json:"payload"`
	Dimensions APIDimensions      `json:"dimensions"`
	Samples    []APISample        `json:"samples"`
}

// apiDimensionColumns are only available on the raw events table, because
// api_metrics_1m aggregates on environment, release, route and endpoint alone.
var apiDimensionColumns = []string{"browser", "os", "device_type", "country", "release"}

// apiLatencyEdges bound the detail histogram. The last edge opens the slowest
// bucket so a single very slow request cannot stretch the axis.
var apiLatencyEdges = []float64{100, 300, 500, 1000, 3000}

// APISummary aggregates every endpoint in the range so the workspace can lead
// with overall health before the reader picks an endpoint to investigate.
type APISummary struct {
	Requests      uint64   `json:"requests"`
	Estimated     float64  `json:"estimated"`
	Failures      uint64   `json:"failures"`
	ClientErrors  uint64   `json:"clientErrors"`
	ServerErrors  uint64   `json:"serverErrors"`
	NetworkErrors uint64   `json:"networkErrors"`
	P50           *float64 `json:"p50"`
	P75           *float64 `json:"p75"`
	P95           *float64 `json:"p95"`
	Endpoints     uint64   `json:"endpoints"`
}

type APIResult struct {
	From      time.Time       `json:"from"`
	To        time.Time       `json:"to"`
	Summary   APISummary      `json:"summary"`
	Previous  *APISummary     `json:"previous,omitempty"`
	Trend     []APITrendPoint `json:"trend"`
	Facets    APIFacets       `json:"facets"`
	Endpoints []APIEndpoint   `json:"endpoints"`
	Truncated bool            `json:"truncated"`
	Detail    *APIDetail      `json:"detail,omitempty"`
}

// endpointListLimit bounds the ranked table; APIResult.Truncated tells the
// console when more endpoints exist than the ranking could return.
const endpointListLimit = 200

type APIRepository struct{ database *sql.DB }

func NewAPIRepository(database *sql.DB) *APIRepository { return &APIRepository{database: database} }

func NormalizeAPIFilters(filters APIFilters) (APIFilters, error) {
	filters.From, filters.To = filters.From.UTC(), filters.To.UTC()
	filters.Environment, filters.Release, filters.Route = strings.TrimSpace(filters.Environment), strings.TrimSpace(filters.Release), strings.TrimSpace(filters.Route)
	filters.Method, filters.URL, filters.Sort = strings.ToUpper(strings.TrimSpace(filters.Method)), sanitizeAPIURL(filters.URL), strings.TrimSpace(filters.Sort)
	filters.Search = strings.TrimSpace(filters.Search)
	filters.Methods = normalizeAPIMethods(filters.Methods)
	if filters.Sort == "" {
		filters.Sort = "requests"
	}
	_, knownSort := apiSorts[filters.Sort]
	pairedEndpoint := (filters.Method == "") == (filters.URL == "")
	if filters.ProjectID == uuid.Nil || filters.From.IsZero() || !filters.From.Before(filters.To) || filters.To.Sub(filters.From) > 30*24*time.Hour ||
		len(filters.Environment) > 64 || len(filters.Release) > 128 || len(filters.Route) > 1024 || len(filters.Method) > 16 || len(filters.URL) > 2048 || len(filters.Search) > 256 ||
		!pairedEndpoint || !knownSort || containsControl(filters.Environment+filters.Release+filters.Route+filters.Method+filters.URL+filters.Search) {
		return APIFilters{}, ErrInvalidAPIFilters
	}
	return filters, nil
}

// apiMethods bounds the method filter to the verbs the browser SDK records, so
// an arbitrary caller cannot widen the LowCardinality scan.
var apiMethods = []string{"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"}

func normalizeAPIMethods(requested []string) []string {
	if len(requested) == 0 {
		return nil
	}
	selected := make([]string, 0, len(apiMethods))
	for _, candidate := range apiMethods {
		for _, value := range requested {
			if strings.EqualFold(strings.TrimSpace(value), candidate) {
				selected = append(selected, candidate)
				break
			}
		}
	}
	if len(selected) == 0 || len(selected) == len(apiMethods) {
		return nil
	}
	return selected
}

func (repository *APIRepository) Get(ctx context.Context, requested APIFilters) (APIResult, error) {
	filters, err := NormalizeAPIFilters(requested)
	if err != nil {
		return APIResult{}, err
	}
	endpoints, err := repository.endpoints(ctx, filters)
	if err != nil {
		return APIResult{}, err
	}
	result := APIResult{From: filters.From, To: filters.To, Endpoints: endpoints}
	if result.Summary, err = repository.summary(ctx, filters); err != nil {
		return APIResult{}, err
	}
	result.Truncated = result.Summary.Endpoints > uint64(len(endpoints))
	if result.Trend, err = repository.trend(ctx, filters, false); err != nil {
		return APIResult{}, err
	}
	if result.Facets, err = repository.facets(ctx, filters); err != nil {
		return APIResult{}, err
	}
	if filters.Compare {
		previous, err := repository.summary(ctx, previousAPIWindow(filters))
		if err != nil {
			return APIResult{}, err
		}
		result.Previous = &previous
	}
	if filters.Method != "" {
		detail, err := repository.detail(ctx, filters)
		if err != nil {
			return APIResult{}, err
		}
		result.Detail = &detail
	}
	return result, nil
}

// previousAPIWindow shifts the range back by its own length so comparison
// numbers always cover an equally long period.
func previousAPIWindow(filters APIFilters) APIFilters {
	window := filters.To.Sub(filters.From)
	filters.From, filters.To = filters.From.Add(-window), filters.From
	return filters
}

func (repository *APIRepository) summary(ctx context.Context, filters APIFilters) (APISummary, error) {
	where, arguments := apiAggregateWhere(filters, false)
	var summary APISummary
	var p50, p75, p95 sql.NullFloat64
	err := repository.database.QueryRowContext(ctx, `SELECT uniqCombined64Merge(requests),sumMerge(estimated),
		coalesce(uniqCombined64Merge(failures),0),coalesce(uniqCombined64Merge(client_errors),0),
		coalesce(uniqCombined64Merge(server_errors),0),coalesce(uniqCombined64Merge(network_errors),0),
		quantileTDigestMerge(0.50)(duration_p50),quantileTDigestMerge(0.75)(duration_p75),quantileTDigestMerge(0.95)(duration_p95),
		uniq(api_method,api_url_normalized)
		FROM api_metrics_1m WHERE `+where, arguments...).Scan(&summary.Requests, &summary.Estimated,
		&summary.Failures, &summary.ClientErrors, &summary.ServerErrors, &summary.NetworkErrors,
		&p50, &p75, &p95, &summary.Endpoints)
	if errors.Is(err, sql.ErrNoRows) {
		return APISummary{}, nil
	}
	if err != nil {
		return APISummary{}, fmt.Errorf("query API summary: %w", err)
	}
	summary.P50, summary.P75, summary.P95 = nullableFloat(p50), nullableFloat(p75), nullableFloat(p95)
	return summary, nil
}

func (repository *APIRepository) facets(ctx context.Context, filters APIFilters) (APIFacets, error) {
	base := filters
	base.Release, base.Route, base.Methods, base.Method, base.URL = "", "", nil, "", ""
	where, arguments := apiAggregateWhere(base, false)
	dimensions := []string{"api_method", "release", "route"}
	parts := make([]string, 0, len(dimensions))
	allArguments := make([]any, 0, len(arguments)*len(dimensions))
	for _, dimension := range dimensions {
		parts = append(parts, fmt.Sprintf(`SELECT '%s' AS dimension,%s AS value,uniqCombined64Merge(requests) AS total
			FROM api_metrics_1m WHERE %s AND %s!='' GROUP BY value ORDER BY total DESC LIMIT 50`, dimension, dimension, where, dimension))
		allArguments = append(allArguments, arguments...)
	}
	rows, err := repository.database.QueryContext(ctx, strings.Join(parts, " UNION ALL "), allArguments...)
	if err != nil {
		return APIFacets{}, fmt.Errorf("query API facets: %w", err)
	}
	defer func() { _ = rows.Close() }()
	facets := APIFacets{Methods: []APIFacet{}, Releases: []APIFacet{}, Routes: []APIFacet{}}
	for rows.Next() {
		var dimension string
		var facet APIFacet
		if err := rows.Scan(&dimension, &facet.Value, &facet.Requests); err != nil {
			return APIFacets{}, fmt.Errorf("scan API facet: %w", err)
		}
		switch dimension {
		case "api_method":
			facets.Methods = append(facets.Methods, facet)
		case "release":
			facets.Releases = append(facets.Releases, facet)
		case "route":
			facets.Routes = append(facets.Routes, facet)
		}
	}
	return facets, rows.Err()
}

// apiEndpointColumns keeps the list ranking and the single-endpoint lookup on
// one projection so a deep link never disagrees with the table it came from.
const apiEndpointColumns = `api_method,api_url_normalized,
	uniqCombined64Merge(requests) AS requests_count,sumMerge(estimated),
	coalesce(uniqCombined64Merge(failures),0) AS failures_count,
	coalesce(uniqCombined64Merge(client_errors),0),coalesce(uniqCombined64Merge(server_errors),0),coalesce(uniqCombined64Merge(network_errors),0),
	quantileTDigestMerge(0.50)(duration_p50),quantileTDigestMerge(0.75)(duration_p75),quantileTDigestMerge(0.95)(duration_p95) AS duration_p95_value`

func (repository *APIRepository) endpoints(ctx context.Context, filters APIFilters) ([]APIEndpoint, error) {
	where, arguments := apiAggregateWhere(filters, false)
	order := apiSorts[filters.Sort]
	rows, err := repository.database.QueryContext(ctx, `SELECT `+apiEndpointColumns+`
		FROM api_metrics_1m WHERE `+where+` GROUP BY api_method,api_url_normalized ORDER BY `+order+
		fmt.Sprintf(" LIMIT %d", endpointListLimit), arguments...)
	if err != nil {
		return nil, fmt.Errorf("query API endpoints: %w", err)
	}
	defer func() { _ = rows.Close() }()
	result := make([]APIEndpoint, 0)
	for rows.Next() {
		current, err := scanAPIEndpoint(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, current)
	}
	return result, rows.Err()
}

func (repository *APIRepository) detail(ctx context.Context, filters APIFilters) (APIDetail, error) {
	detail := APIDetail{
		Endpoint: APIEndpoint{Method: filters.Method, URL: filters.URL},
		Trend:    []APITrendPoint{}, Routes: []APIRouteFacet{},
		Statuses: []APIStatusFacet{}, Latency: []APILatencyBucket{}, Samples: []APISample{},
	}
	var err error
	if detail.Endpoint, err = repository.endpointAggregate(ctx, filters); err != nil {
		return detail, err
	}
	if detail.Trend, err = repository.trend(ctx, filters, true); err != nil {
		return detail, err
	}
	if detail.Routes, err = repository.routes(ctx, filters); err != nil {
		return detail, err
	}
	if detail.Statuses, err = repository.statuses(ctx, filters); err != nil {
		return detail, err
	}
	if detail.Latency, err = repository.latency(ctx, filters); err != nil {
		return detail, err
	}
	if detail.Payload, err = repository.payload(ctx, filters); err != nil {
		return detail, err
	}
	if detail.Dimensions, err = repository.dimensions(ctx, filters); err != nil {
		return detail, err
	}
	detail.Samples, err = repository.samples(ctx, filters)
	return detail, err
}

func (repository *APIRepository) dimensions(ctx context.Context, filters APIFilters) (APIDimensions, error) {
	where, arguments := apiRawWhere(filters)
	parts := make([]string, 0, len(apiDimensionColumns))
	allArguments := make([]any, 0, len(arguments)*len(apiDimensionColumns))
	for _, column := range apiDimensionColumns {
		parts = append(parts, fmt.Sprintf(`SELECT '%s' AS dimension,toString(%s) AS value,count() AS total,
			countIf(api_failure!='' OR api_status>=500),quantileTDigest(0.95)(duration_ms)
			FROM rum_events WHERE %s AND toString(%s)!='' GROUP BY value ORDER BY total DESC LIMIT 8`,
			column, column, where, column))
		allArguments = append(allArguments, arguments...)
	}
	rows, err := repository.database.QueryContext(ctx, strings.Join(parts, " UNION ALL "), allArguments...)
	if err != nil {
		return APIDimensions{}, fmt.Errorf("query API dimensions: %w", err)
	}
	defer func() { _ = rows.Close() }()
	dimensions := APIDimensions{
		Browsers: []APIDimensionFacet{}, OperatingSystems: []APIDimensionFacet{},
		Devices: []APIDimensionFacet{}, Countries: []APIDimensionFacet{}, Releases: []APIDimensionFacet{},
	}
	for rows.Next() {
		var column string
		var facet APIDimensionFacet
		var p95 sql.NullFloat64
		if err := rows.Scan(&column, &facet.Value, &facet.Requests, &facet.Failures, &p95); err != nil {
			return APIDimensions{}, fmt.Errorf("scan API dimension: %w", err)
		}
		facet.P95 = nullableFloat(p95)
		switch column {
		case "browser":
			dimensions.Browsers = append(dimensions.Browsers, facet)
		case "os":
			dimensions.OperatingSystems = append(dimensions.OperatingSystems, facet)
		case "device_type":
			dimensions.Devices = append(dimensions.Devices, facet)
		case "country":
			dimensions.Countries = append(dimensions.Countries, facet)
		case "release":
			dimensions.Releases = append(dimensions.Releases, facet)
		}
	}
	return dimensions, rows.Err()
}

func (repository *APIRepository) statuses(ctx context.Context, filters APIFilters) ([]APIStatusFacet, error) {
	where, arguments := apiRawWhere(filters)
	rows, err := repository.database.QueryContext(ctx, `SELECT api_status,api_failure,count() AS total
		FROM rum_events WHERE `+where+` GROUP BY api_status,api_failure ORDER BY total DESC,api_status LIMIT 24`, arguments...)
	if err != nil {
		return nil, fmt.Errorf("query API statuses: %w", err)
	}
	defer func() { _ = rows.Close() }()
	result := make([]APIStatusFacet, 0)
	for rows.Next() {
		var current APIStatusFacet
		if err := rows.Scan(&current.Status, &current.Failure, &current.Requests); err != nil {
			return nil, err
		}
		result = append(result, current)
	}
	return result, rows.Err()
}

// latencyBucketExpression maps each duration onto the lower bound of its
// bucket, which keeps every bucket a distinct grouping key.
func latencyBucketExpression() string {
	lower := 0.0
	conditions := make([]string, 0, len(apiLatencyEdges))
	for _, edge := range apiLatencyEdges {
		conditions = append(conditions, fmt.Sprintf("duration_ms<%g,%g", edge, lower))
		lower = edge
	}
	return "multiIf(" + strings.Join(conditions, ",") + fmt.Sprintf(",%g)", lower)
}

func (repository *APIRepository) latency(ctx context.Context, filters APIFilters) ([]APILatencyBucket, error) {
	where, arguments := apiRawWhere(filters)
	rows, err := repository.database.QueryContext(ctx, `SELECT `+latencyBucketExpression()+` AS bucket,count()
		FROM rum_events WHERE `+where+` GROUP BY bucket ORDER BY bucket`, arguments...)
	if err != nil {
		return nil, fmt.Errorf("query API latency distribution: %w", err)
	}
	defer func() { _ = rows.Close() }()
	result := make([]APILatencyBucket, 0)
	for rows.Next() {
		var current APILatencyBucket
		if err := rows.Scan(&current.FromMS, &current.Requests); err != nil {
			return nil, err
		}
		current.ToMS = latencyBucketUpperBound(current.FromMS)
		result = append(result, current)
	}
	return result, rows.Err()
}

// latencyBucketUpperBound returns the edge that closes a bucket, or nil for the
// open-ended slowest bucket.
func latencyBucketUpperBound(lower float64) *float64 {
	for _, edge := range apiLatencyEdges {
		if edge > lower {
			bound := edge
			return &bound
		}
	}
	return nil
}

func (repository *APIRepository) payload(ctx context.Context, filters APIFilters) (APIPayload, error) {
	where, arguments := apiRawWhere(filters)
	var payload APIPayload
	var p50, p95 sql.NullFloat64
	err := repository.database.QueryRowContext(ctx, `SELECT countIf(transfer_size>0),
		quantileIf(0.50)(transfer_size,transfer_size>0),quantileIf(0.95)(transfer_size,transfer_size>0)
		FROM rum_events WHERE `+where, arguments...).Scan(&payload.Samples, &p50, &p95)
	if errors.Is(err, sql.ErrNoRows) {
		return APIPayload{}, nil
	}
	if err != nil {
		return APIPayload{}, fmt.Errorf("query API payload size: %w", err)
	}
	payload.P50, payload.P95 = nullableFloat(p50), nullableFloat(p95)
	return payload, nil
}

// endpointAggregate resolves the selected endpoint on its own so a deep link
// still reports real metrics when the endpoint falls outside the ranked list.
func (repository *APIRepository) endpointAggregate(ctx context.Context, filters APIFilters) (APIEndpoint, error) {
	where, arguments := apiAggregateWhere(filters, true)
	row := repository.database.QueryRowContext(ctx, `SELECT `+apiEndpointColumns+`
		FROM api_metrics_1m WHERE `+where+` GROUP BY api_method,api_url_normalized LIMIT 1`, arguments...)
	endpoint, err := scanAPIEndpoint(row)
	if errors.Is(err, sql.ErrNoRows) {
		return APIEndpoint{Method: filters.Method, URL: filters.URL}, nil
	}
	if err != nil {
		return APIEndpoint{}, fmt.Errorf("query API endpoint: %w", err)
	}
	return endpoint, nil
}

func (repository *APIRepository) trend(ctx context.Context, filters APIFilters, endpoint bool) ([]APITrendPoint, error) {
	where, arguments := apiAggregateWhere(filters, endpoint)
	interval := legacySeriesInterval(filters.To.Sub(filters.From))
	rows, err := repository.database.QueryContext(ctx, `SELECT toStartOfInterval(bucket, INTERVAL `+interval+`) AS point,
		uniqCombined64Merge(requests),coalesce(uniqCombined64Merge(failures),0),
		coalesce(uniqCombined64Merge(client_errors),0),quantileTDigestMerge(0.95)(duration_p95)
		FROM api_metrics_1m WHERE `+where+` GROUP BY point ORDER BY point`, arguments...)
	if err != nil {
		return nil, fmt.Errorf("query API trend: %w", err)
	}
	defer func() { _ = rows.Close() }()
	result := make([]APITrendPoint, 0)
	for rows.Next() {
		var current APITrendPoint
		var p95 sql.NullFloat64
		if err := rows.Scan(&current.Bucket, &current.Requests, &current.Failures, &current.ClientErrors, &p95); err != nil {
			return nil, err
		}
		current.Bucket = current.Bucket.UTC()
		current.P95 = nullableFloat(p95)
		result = append(result, current)
	}
	return result, rows.Err()
}

func (repository *APIRepository) routes(ctx context.Context, filters APIFilters) ([]APIRouteFacet, error) {
	where, arguments := apiAggregateWhere(filters, true)
	rows, err := repository.database.QueryContext(ctx, `SELECT route,uniqCombined64Merge(requests),coalesce(uniqCombined64Merge(failures),0)
		FROM api_metrics_1m WHERE `+where+` AND route!='' GROUP BY route ORDER BY uniqCombined64Merge(requests) DESC LIMIT 20`, arguments...)
	if err != nil {
		return nil, fmt.Errorf("query API route facets: %w", err)
	}
	defer func() { _ = rows.Close() }()
	result := make([]APIRouteFacet, 0)
	for rows.Next() {
		var current APIRouteFacet
		if err := rows.Scan(&current.Route, &current.Requests, &current.Failures); err != nil {
			return nil, err
		}
		result = append(result, current)
	}
	return result, rows.Err()
}

func (repository *APIRepository) samples(ctx context.Context, filters APIFilters) ([]APISample, error) {
	where, arguments := apiRawWhere(filters)
	rows, err := repository.database.QueryContext(ctx, `SELECT event_id,timestamp,api_status,api_failure,duration_ms,route,page_url_normalized,release,browser,session_id,trace_id
		FROM rum_events FINAL WHERE `+where+` ORDER BY (api_failure!='' OR api_status>=500) DESC,duration_ms DESC,timestamp DESC LIMIT 25`, arguments...)
	if err != nil {
		return nil, fmt.Errorf("query API samples: %w", err)
	}
	defer func() { _ = rows.Close() }()
	result := make([]APISample, 0)
	for rows.Next() {
		var current APISample
		if err := rows.Scan(&current.EventID, &current.Timestamp, &current.Status, &current.Failure, &current.DurationMS, &current.Route, &current.PageURL, &current.Release, &current.Browser, &current.SessionID, &current.TraceID); err != nil {
			return nil, err
		}
		current.Timestamp = current.Timestamp.UTC()
		current.PageURL = sanitizeAPIURL(current.PageURL)
		result = append(result, current)
	}
	return result, rows.Err()
}

type apiEndpointScanner interface{ Scan(...any) error }

func scanAPIEndpoint(scanner apiEndpointScanner) (APIEndpoint, error) {
	var current APIEndpoint
	var p50, p75, p95 sql.NullFloat64
	if err := scanner.Scan(&current.Method, &current.URL, &current.Requests, &current.Estimated, &current.Failures, &current.ClientErrors, &current.ServerErrors, &current.NetworkErrors, &p50, &p75, &p95); err != nil {
		return APIEndpoint{}, err
	}
	current.URL = sanitizeAPIURL(current.URL)
	current.P50, current.P75, current.P95 = nullableFloat(p50), nullableFloat(p75), nullableFloat(p95)
	current.Sufficient = current.Requests >= minimumAPISamples
	return current, nil
}

func apiAggregateWhere(filters APIFilters, endpoint bool) (string, []any) {
	where := "project_id=? AND bucket>=? AND bucket<? AND positionCaseInsensitive(api_url_normalized,'/ingest/v1/envelope')=0"
	arguments := []any{filters.ProjectID, filters.From, filters.To}
	for _, item := range []struct{ column, value string }{{"environment", filters.Environment}, {"release", filters.Release}, {"route", filters.Route}} {
		if item.value != "" {
			where += " AND " + item.column + "=?"
			arguments = append(arguments, item.value)
		}
	}
	if endpoint {
		where += " AND api_method=? AND api_url_normalized=?"
		arguments = append(arguments, filters.Method, filters.URL)
	} else {
		if filters.Search != "" {
			where += " AND positionCaseInsensitive(api_url_normalized,?)>0"
			arguments = append(arguments, filters.Search)
		}
		if len(filters.Methods) > 0 {
			where += " AND api_method IN (" + strings.TrimSuffix(strings.Repeat("?,", len(filters.Methods)), ",") + ")"
			for _, method := range filters.Methods {
				arguments = append(arguments, method)
			}
		}
	}
	return where, arguments
}

func apiRawWhere(filters APIFilters) (string, []any) {
	where := "project_id=? AND timestamp>=? AND timestamp<? AND event_type='api' AND api_method=? AND api_url_normalized=? AND positionCaseInsensitive(api_url_normalized,'/ingest/v1/envelope')=0 AND NOT has(ingest_flags,'synthetic')"
	arguments := []any{filters.ProjectID, filters.From, filters.To, filters.Method, filters.URL}
	for _, item := range []struct{ column, value string }{{"environment", filters.Environment}, {"release", filters.Release}, {"route", filters.Route}} {
		if item.value != "" {
			where += " AND " + item.column + "=?"
			arguments = append(arguments, item.value)
		}
	}
	return where, arguments
}

// nullableFloat treats NaN and infinity as absent. Merging a quantile state
// over an empty range yields NaN, and JSON cannot encode it, so passing one
// through would truncate the whole response body.
func nullableFloat(value sql.NullFloat64) *float64 {
	if !value.Valid || math.IsNaN(value.Float64) || math.IsInf(value.Float64, 0) {
		return nil
	}
	result := value.Float64
	return &result
}

func sanitizeAPIURL(value string) string {
	value = strings.TrimSpace(value)
	parsed, err := url.Parse(value)
	if err != nil {
		if index := strings.IndexAny(value, "?#"); index >= 0 {
			return value[:index]
		}
		return value
	}
	parsed.RawQuery, parsed.ForceQuery, parsed.Fragment = "", false, ""
	parsed.User = nil
	return parsed.String()
}
