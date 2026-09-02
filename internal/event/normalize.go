package event

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"time"

	"github.com/google/uuid"
	"github.com/mileusna/useragent"

	"openrum/internal/privacy"
)

var ErrInvalidQueueEnvelope = errors.New("invalid queued envelope")

const (
	QueueSchemaVersion         = "1.0"
	PreviousQueueSchemaVersion = "0.9"
)

type CanonicalEvent struct {
	ProjectID         uuid.UUID
	EventID           uuid.UUID
	EventType         EventType
	Timestamp         time.Time
	ReceivedAt        time.Time
	Environment       string
	Release           string
	Dist              string
	SessionID         uuid.UUID
	AnonymousUserID   string
	UserID            string
	PageID            uuid.UUID
	PageURL           string
	PageURLNormalized string
	Route             string
	Referrer          string
	Title             string
	NavigationType    string
	SDKName           string
	SDKVersion        string
	SchemaVersion     string
	SampleRate        float32
	Browser           string
	BrowserVersion    string
	OS                string
	OSVersion         string
	DeviceType        string
	Country           string
	TraceID           string
	SpanID            string
	ErrorType         string
	ErrorMessage      string
	ErrorStack        string
	ErrorMechanism    string
	Fingerprint       string
	Handled           bool
	APIMethod         string
	APIURLNormalized  string
	APIStatus         uint16
	APIFailure        string
	DurationMS        float64
	TransferSize      uint64
	MetricName        string
	MetricValue       float64
	MetricDelta       float64
	MetricRating      string
	CustomName        string
	Attributes        map[string]string
	Measurements      map[string]float64
	Breadcrumbs       []string
	IngestFlags       []string
}

type EventFailure struct {
	EventID string
	Code    string
}

type queuedEnvelopeDocument struct {
	QueueSchemaVersion string    `json:"queue_schema_version"`
	ProjectID          uuid.UUID `json:"project_id"`
	OrganizationID     uuid.UUID `json:"organization_id"`
	ReceivedAt         time.Time `json:"received_at"`
	Origin             string    `json:"origin"`
	ClientIP           string    `json:"client_ip"`
	UserAgent          string    `json:"user_agent"`
	Envelope           struct {
		SchemaVersion string            `json:"schema_version"`
		SentAt        string            `json:"sent_at"`
		SDK           SDK               `json:"sdk"`
		Context       EventContext      `json:"context"`
		Events        []json.RawMessage `json:"events"`
	} `json:"envelope"`
}

func NormalizeQueuedEnvelope(payload []byte) ([]CanonicalEvent, []EventFailure, error) {
	var queued queuedEnvelopeDocument
	if err := json.Unmarshal(payload, &queued); err != nil {
		return nil, nil, fmt.Errorf("%w: decode: %w", ErrInvalidQueueEnvelope, err)
	}
	if !supportedQueueSchema(queued.QueueSchemaVersion) || !supportedEventSchema(queued.Envelope.SchemaVersion) ||
		queued.ProjectID == uuid.Nil || queued.OrganizationID == uuid.Nil || queued.ReceivedAt.IsZero() ||
		len(queued.Envelope.Events) == 0 || len(queued.Envelope.Events) > 100 {
		return nil, nil, fmt.Errorf("%w: unsupported or incomplete metadata", ErrInvalidQueueEnvelope)
	}
	if _, err := time.Parse(time.RFC3339Nano, queued.Envelope.SentAt); err != nil {
		return nil, nil, fmt.Errorf("%w: invalid sent_at", ErrInvalidQueueEnvelope)
	}
	context := queued.Envelope.Context
	sessionID, err := uuid.Parse(context.SessionID)
	if err != nil {
		return nil, nil, fmt.Errorf("%w: invalid session_id", ErrInvalidQueueEnvelope)
	}
	pageID, err := uuid.Parse(context.PageID)
	if err != nil {
		return nil, nil, fmt.Errorf("%w: invalid page_id", ErrInvalidQueueEnvelope)
	}
	pageURL, pageURLNormalized, ok := NormalizeURL(context.Page.URL)
	if !ok {
		return nil, nil, fmt.Errorf("%w: invalid page URL", ErrInvalidQueueEnvelope)
	}
	route := NormalizeRoute(context.Page.Route)
	if route != "" {
		pageURLNormalized = urlWithRoute(pageURL, route)
	}
	referrer, _, _ := NormalizeURL(context.Page.Referrer)
	parsedUserAgent := useragent.Parse(queued.UserAgent)

	results := make([]CanonicalEvent, 0, len(queued.Envelope.Events))
	failures := make([]EventFailure, 0)
	for _, raw := range queued.Envelope.Events {
		var current EventV1
		if err := json.Unmarshal(raw, &current); err != nil {
			failures = append(failures, EventFailure{EventID: safeRawEventID(raw), Code: "INVALID_EVENT"})
			continue
		}
		normalized, err := normalizeEvent(normalizeInput{
			queued: queued, context: context, event: current, sessionID: sessionID, pageID: pageID,
			pageURL: pageURL, pageURLNormalized: pageURLNormalized, route: route, referrer: referrer, userAgent: parsedUserAgent,
		})
		if err != nil {
			failures = append(failures, EventFailure{EventID: safeRawEventID(raw), Code: "INVALID_EVENT"})
			continue
		}
		results = append(results, normalized)
	}
	return results, failures, nil
}

type normalizeInput struct {
	queued            queuedEnvelopeDocument
	context           EventContext
	event             EventV1
	sessionID         uuid.UUID
	pageID            uuid.UUID
	pageURL           string
	pageURLNormalized string
	route             string
	referrer          string
	userAgent         useragent.UserAgent
}

func normalizeEvent(input normalizeInput) (CanonicalEvent, error) {
	eventID, err := uuid.Parse(input.event.EventID)
	if err != nil {
		return CanonicalEvent{}, err
	}
	timestamp, err := time.Parse(time.RFC3339Nano, input.event.Timestamp)
	if err != nil {
		return CanonicalEvent{}, err
	}
	sampleRate := float32(1)
	if input.event.SampleRate != nil {
		if *input.event.SampleRate <= 0 || *input.event.SampleRate > 1 {
			return CanonicalEvent{}, errors.New("invalid sample rate")
		}
		sampleRate = float32(*input.event.SampleRate)
	}
	anonymousUserID, anonymousChanged := privacy.ScrubIdentifier(input.context.AnonymousUserID, 128)
	userID, userChanged := privacy.ScrubIdentifier(input.context.UserID, 128)
	title, titleChanged := privacy.ScrubString(input.context.Page.Title, 512)
	attributes, attributesChanged := prefixedTags(input.context.Tags)
	result := CanonicalEvent{
		ProjectID: input.queued.ProjectID, EventID: eventID, EventType: input.event.Type,
		Timestamp: timestamp.UTC(), ReceivedAt: input.queued.ReceivedAt.UTC(), Environment: input.context.Environment,
		Release: input.context.Release, Dist: input.context.Dist, SessionID: input.sessionID,
		AnonymousUserID: anonymousUserID, UserID: userID, PageID: input.pageID,
		PageURL: input.pageURL, PageURLNormalized: input.pageURLNormalized, Route: input.route, Referrer: input.referrer, Title: title,
		SDKName: input.queued.Envelope.SDK.Name, SDKVersion: input.queued.Envelope.SDK.Version,
		SchemaVersion: input.queued.Envelope.SchemaVersion, SampleRate: sampleRate,
		Browser: input.userAgent.Name, BrowserVersion: input.userAgent.Version, OS: input.userAgent.OS, OSVersion: input.userAgent.OSVersion,
		DeviceType: deviceType(input.userAgent), Country: "ZZ", Attributes: attributes, Measurements: map[string]float64{}, Breadcrumbs: []string{}, IngestFlags: []string{},
	}
	if timestamp.Before(time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC)) || timestamp.After(input.queued.ReceivedAt.Add(24*time.Hour)) {
		result.Timestamp = input.queued.ReceivedAt.UTC()
		result.IngestFlags = append(result.IngestFlags, "clock_adjusted")
	}
	if input.context.Trace != nil {
		result.TraceID = input.context.Trace.TraceID
		result.SpanID = input.context.Trace.SpanID
	}
	if anonymousChanged || userChanged || titleChanged || attributesChanged {
		result.IngestFlags = append(result.IngestFlags, "pii_scrubbed")
	}

	switch input.event.Type {
	case EventTypePageView:
		if !validNavigationType(input.event.NavigationType) {
			return CanonicalEvent{}, errors.New("navigation type is required")
		}
		result.NavigationType = input.event.NavigationType
	case EventTypeError:
		if input.event.Error == nil || input.event.Error.Name == "" {
			return CanonicalEvent{}, errors.New("error details are required")
		}
		result.ErrorType, _ = privacy.ScrubString(input.event.Error.Name, 128)
		result.ErrorMessage, titleChanged = privacy.ScrubString(input.event.Error.Message, 2048)
		result.ErrorStack, userChanged = privacy.ScrubString(input.event.Error.Stack, 65536)
		result.ErrorMechanism, anonymousChanged = privacy.ScrubString(input.event.Error.Mechanism, 64)
		result.Handled = input.event.Error.Handled
		result.Breadcrumbs, attributesChanged = scrubBreadcrumbs(input.event.Breadcrumbs)
		if titleChanged || userChanged || anonymousChanged || attributesChanged {
			result.IngestFlags = appendFlag(result.IngestFlags, "pii_scrubbed")
		}
	case EventTypeWebVital:
		if input.event.Metric == nil || !validMetricName(input.event.Metric.Name) || input.event.Metric.Value < 0 || !validMetricRating(input.event.Metric.Rating) {
			return CanonicalEvent{}, errors.New("web vital metric is required")
		}
		result.MetricName = input.event.Metric.Name
		result.MetricValue = input.event.Metric.Value
		if input.event.Metric.Delta != nil {
			result.MetricDelta = *input.event.Metric.Delta
		}
		result.MetricRating = input.event.Metric.Rating
		result.NavigationType = input.event.Metric.NavigationType
	case EventTypeAPI:
		if input.event.Request == nil || !validAPIMethod(input.event.Request.Method) || input.event.Request.DurationMS < 0 || !validAPIFailure(input.event.Request.Failure) {
			return CanonicalEvent{}, errors.New("API Request details are required")
		}
		_, normalized, valid := NormalizeURL(input.event.Request.URL)
		if !valid {
			return CanonicalEvent{}, errors.New("invalid API Request URL")
		}
		result.APIMethod = input.event.Request.Method
		result.APIURLNormalized = normalized
		if input.event.Request.Status != nil {
			if *input.event.Request.Status < 0 || *input.event.Request.Status > 599 {
				return CanonicalEvent{}, errors.New("invalid API Request status")
			}
			result.APIStatus = uint16(*input.event.Request.Status)
		}
		result.APIFailure = input.event.Request.Failure
		result.DurationMS = input.event.Request.DurationMS
		if input.event.Request.TransferSize != nil && *input.event.Request.TransferSize >= 0 {
			result.TransferSize = uint64(*input.event.Request.TransferSize)
		}
	case EventTypeCustom:
		if input.event.Name == "" {
			return CanonicalEvent{}, errors.New("custom event name is required")
		}
		result.CustomName, titleChanged = privacy.ScrubString(input.event.Name, 80)
		customAttributes, customChanged := privacy.ScrubAttributes(input.event.Attributes, 20)
		for key, value := range customAttributes {
			result.Attributes[key] = value
		}
		result.Measurements = boundedMeasurements(input.event.Measurements)
		if titleChanged || customChanged {
			result.IngestFlags = appendFlag(result.IngestFlags, "pii_scrubbed")
		}
	default:
		return CanonicalEvent{}, errors.New("unsupported Event type")
	}
	return result, nil
}

func supportedQueueSchema(version string) bool {
	return version == QueueSchemaVersion || version == PreviousQueueSchemaVersion
}

func supportedEventSchema(version string) bool { return version == "1.0" || version == "0.9" }

func validNavigationType(value string) bool {
	switch value {
	case "navigate", "reload", "back_forward", "prerender", "route_change":
		return true
	default:
		return false
	}
}

func validMetricName(value string) bool {
	switch value {
	case "LCP", "INP", "CLS", "FCP", "TTFB":
		return true
	default:
		return false
	}
}

func validMetricRating(value string) bool {
	switch value {
	case "good", "needs-improvement", "poor":
		return true
	default:
		return false
	}
}

func validAPIMethod(value string) bool {
	switch value {
	case "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS":
		return true
	default:
		return false
	}
}

func validAPIFailure(value string) bool {
	switch value {
	case "", "network", "timeout", "abort", "http":
		return true
	default:
		return false
	}
}

func safeRawEventID(raw json.RawMessage) string {
	var value struct {
		EventID string `json:"event_id"`
	}
	if json.Unmarshal(raw, &value) != nil {
		return ""
	}
	if _, err := uuid.Parse(value.EventID); err != nil {
		return ""
	}
	return value.EventID
}

func urlWithRoute(raw, route string) string {
	parsed, err := url.Parse(raw)
	if err != nil {
		return raw
	}
	parsed.Path = route
	return parsed.String()
}

func deviceType(value useragent.UserAgent) string {
	switch {
	case value.Bot:
		return "bot"
	case value.Tablet:
		return "tablet"
	case value.Mobile:
		return "mobile"
	case value.Desktop:
		return "desktop"
	default:
		return "unknown"
	}
}

func prefixedTags(tags map[string]string) (map[string]string, bool) {
	scrubbed, changed := privacy.ScrubAttributes(tags, 20)
	result := make(map[string]string, len(scrubbed))
	for key, value := range scrubbed {
		result["tag."+key] = value
	}
	return result, changed
}

func boundedMeasurements(measurements map[string]float64) map[string]float64 {
	result := make(map[string]float64, min(len(measurements), 20))
	for key, value := range measurements {
		if len(result) >= 20 {
			break
		}
		if key == "" {
			continue
		}
		if len(key) > 64 {
			key = key[:64]
		}
		result[key] = value
	}
	return result
}

func scrubBreadcrumbs(breadcrumbs []Breadcrumb) ([]string, bool) {
	result := make([]string, 0, min(len(breadcrumbs), 50))
	changed := len(breadcrumbs) > 50
	for _, breadcrumb := range breadcrumbs {
		if len(result) >= 50 {
			break
		}
		breadcrumb.Category, _ = privacy.ScrubString(breadcrumb.Category, 64)
		var messageChanged, dataChanged bool
		breadcrumb.Message, messageChanged = privacy.ScrubString(breadcrumb.Message, 512)
		breadcrumb.Data, dataChanged = privacy.ScrubAttributes(breadcrumb.Data, 20)
		changed = changed || messageChanged || dataChanged
		encoded, err := json.Marshal(breadcrumb)
		if err == nil {
			result = append(result, string(encoded))
		}
	}
	return result, changed
}

func appendFlag(flags []string, value string) []string {
	for _, current := range flags {
		if current == value {
			return flags
		}
	}
	return append(flags, value)
}
