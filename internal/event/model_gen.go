// Code generated from packages/protocol/schema/envelope-v1.json; DO NOT EDIT BY HAND.

package event

import "encoding/json"

type EventType string

const (
	EventTypePageView EventType = "page_view"
	EventTypeError    EventType = "error"
	EventTypeWebVital EventType = "web_vital"
	EventTypeAPI      EventType = "api"
	EventTypeCustom   EventType = "custom"
)

type EnvelopeV1 struct {
	SchemaVersion string       `json:"schema_version"`
	SentAt        string       `json:"sent_at"`
	SDK           SDK          `json:"sdk"`
	Context       EventContext `json:"context"`
	Events        []EventV1    `json:"events"`
}

type SDK struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

type EventContext struct {
	Environment     string            `json:"environment"`
	Release         string            `json:"release,omitempty"`
	Dist            string            `json:"dist,omitempty"`
	SessionID       string            `json:"session_id"`
	PageID          string            `json:"page_id"`
	AnonymousUserID string            `json:"anonymous_user_id"`
	UserID          string            `json:"user_id,omitempty"`
	Page            PageContext       `json:"page"`
	Trace           *TraceContext     `json:"trace,omitempty"`
	Tags            map[string]string `json:"tags,omitempty"`
}

type PageContext struct {
	URL      string `json:"url"`
	Route    string `json:"route,omitempty"`
	Title    string `json:"title,omitempty"`
	Referrer string `json:"referrer,omitempty"`
}

type TraceContext struct {
	TraceID string `json:"trace_id"`
	SpanID  string `json:"span_id,omitempty"`
}

type EventV1 struct {
	EventID        string             `json:"event_id"`
	Type           EventType          `json:"type"`
	Timestamp      string             `json:"timestamp"`
	SampleRate     *float64           `json:"sample_rate,omitempty"`
	NavigationType string             `json:"navigation_type,omitempty"`
	Error          *ErrorDetails      `json:"error,omitempty"`
	Fingerprint    []string           `json:"fingerprint,omitempty"`
	Breadcrumbs    []Breadcrumb       `json:"breadcrumbs,omitempty"`
	Metric         *WebVitalMetric    `json:"metric,omitempty"`
	Request        *APIRequest        `json:"request,omitempty"`
	Name           string             `json:"name,omitempty"`
	Attributes     map[string]string  `json:"attributes,omitempty"`
	Measurements   map[string]float64 `json:"measurements,omitempty"`
}

type ErrorDetails struct {
	Name      string `json:"name"`
	Message   string `json:"message"`
	Stack     string `json:"stack,omitempty"`
	Handled   bool   `json:"handled"`
	Mechanism string `json:"mechanism,omitempty"`
}

type Breadcrumb struct {
	Timestamp string            `json:"timestamp"`
	Category  string            `json:"category"`
	Message   string            `json:"message"`
	Level     string            `json:"level,omitempty"`
	Data      map[string]string `json:"data,omitempty"`
}

type WebVitalMetric struct {
	Name           string   `json:"name"`
	Value          float64  `json:"value"`
	Delta          *float64 `json:"delta,omitempty"`
	Rating         string   `json:"rating"`
	NavigationType string   `json:"navigation_type,omitempty"`
}

type APIRequest struct {
	Method       string  `json:"method"`
	URL          string  `json:"url"`
	Status       *int    `json:"status,omitempty"`
	DurationMS   float64 `json:"duration_ms"`
	TransferSize *int64  `json:"transfer_size,omitempty"`
	Failure      string  `json:"failure,omitempty"`
}

func DecodeEnvelopeV1(data []byte) (EnvelopeV1, error) {
	var envelope EnvelopeV1
	if err := json.Unmarshal(data, &envelope); err != nil {
		return EnvelopeV1{}, err
	}
	return envelope, nil
}
