package devdata

import (
	"encoding/hex"
	"fmt"
	"math/rand"
	"strings"
	"time"

	"github.com/google/uuid"

	"openrum/internal/event"
)

// SDKName identifies envelopes this package produced. It is a real SDK name
// rather than a synthetic marker, because envelopes flagged synthetic are
// excluded from the aggregate tables and would never reach a dashboard.
const SDKName = "openrum-devdata"

// SDKVersion tracks the shape of the generated data.
const SDKVersion = "1.0.0"

// Batch is one envelope plus the transport metadata that cannot travel inside
// it. The pipeline derives browser, OS and device from UserAgent and country
// from the trusted country header, so the sender has to set both per batch.
type Batch struct {
	Envelope  event.EnvelopeV1
	UserAgent string
	Country   string
}

// Summary counts what a build produced, so a caller can report the shape of a
// dataset without walking every envelope again.
type Summary struct {
	Sessions  int            `json:"sessions"`
	Envelopes int            `json:"envelopes"`
	Events    int            `json:"events"`
	ByType    map[string]int `json:"byType"`
}

// Build turns a scenario into envelopes. The result is deterministic for a
// given scenario: the same seed replays the same dataset, which is what makes a
// bug found against generated data reproducible.
func Build(scenario Scenario) ([]Batch, Summary, error) {
	if err := scenario.Validate(); err != nil {
		return nil, Summary{}, err
	}
	random := rand.New(rand.NewSource(scenario.Seed))
	clients := newPicker(scenario.Clients, func(client Client) int { return client.Weight })
	journeys := newPicker(scenario.Journeys, func(journey Journey) int { return journey.Weight })
	releases := newPicker(scenario.Releases, func(release Weight) int { return release.Weight })

	batches := make([]Batch, 0, scenario.Sessions)
	summary := Summary{Sessions: scenario.Sessions, ByType: map[string]int{}}
	span := scenario.To.Sub(scenario.From)
	for index := 0; index < scenario.Sessions; index++ {
		session := sessionSeed{
			client:  clients.pick(random),
			journey: journeys.pick(random),
			// Sessions are spread across the window instead of clustered at one
			// instant, so per-minute rollups and trend charts have a shape.
			startedAt: scenario.From.Add(time.Duration(random.Float64() * float64(span))),
			sessionID: uuid.NewString(),
			anonymous: uuid.NewString(),
		}
		if releases.total > 0 {
			session.release = releases.pick(random).Value
		}
		built := buildSession(scenario, session, random)
		fitSessionWindow(built, scenario.From, scenario.To)
		batches = append(batches, built...)
	}
	for _, batch := range batches {
		summary.Envelopes++
		for _, current := range batch.Envelope.Events {
			summary.Events++
			summary.ByType[string(current.Type)]++
		}
	}
	return batches, summary, nil
}

// A journey can last longer than the space remaining in the selected window.
// Shift it back when possible, otherwise compress it, preserving event order.
func fitSessionWindow(batches []Batch, from, to time.Time) {
	var first, last time.Time
	for _, batch := range batches {
		for _, ev := range batch.Envelope.Events {
			at, _ := time.Parse(time.RFC3339Nano, ev.Timestamp)
			if first.IsZero() || at.Before(first) {
				first = at
			}
			if last.IsZero() || at.After(last) {
				last = at
			}
		}
	}
	end := to.Add(-time.Millisecond)
	if !last.After(end) {
		return
	}
	start := end.Add(-last.Sub(first))
	scale := 1.0
	if start.Before(from) {
		start = from
		scale = float64(end.Sub(from)) / float64(last.Sub(first))
	}
	for i := range batches {
		for j := range batches[i].Envelope.Events {
			ev := &batches[i].Envelope.Events[j]
			at, _ := time.Parse(time.RFC3339Nano, ev.Timestamp)
			ev.Timestamp = timestamp(start.Add(time.Duration(float64(at.Sub(first)) * scale)))
		}
		batches[i].Envelope.SentAt = timestamp(end)
	}
}

type sessionSeed struct {
	client    Client
	journey   Journey
	release   string
	startedAt time.Time
	sessionID string
	anonymous string
}

func buildSession(scenario Scenario, session sessionSeed, random *rand.Rand) []Batch {
	batches := make([]Batch, 0, len(session.journey.Pages))
	at := session.startedAt
	referrer := ""
	for pageIndex, page := range session.journey.Pages {
		pageURL := strings.TrimSuffix(scenario.BaseURL, "/") + page.Path
		events := make([]event.EventV1, 0, 8)
		navigation := "navigate"
		if pageIndex > 0 {
			navigation = "route_change"
		}
		events = append(events, event.EventV1{
			EventID: uuid.NewString(), Type: event.EventTypePageView,
			Timestamp: timestamp(at), NavigationType: navigation,
		})
		events = append(events, pageVitals(page, at, navigation, random)...)
		events = append(events, pageAPIs(page, session, at, scenario.BaseURL, random)...)
		events = append(events, pageErrors(page, at, random)...)
		events = append(events, pageCustom(page, at, random)...)
		for _, log := range page.Logs {
			if !occurs(log.Odds, random) {
				continue
			}
			events = append(events, event.EventV1{EventID: uuid.NewString(), Type: event.EventTypeLog, Timestamp: timestamp(at.Add(time.Duration(random.Intn(6000)) * time.Millisecond)), Level: log.Level, Message: log.Message, Logger: log.Logger, Attributes: log.Attributes})
		}

		context := event.EventContext{
			Environment: scenario.Environment, Release: session.release,
			SessionID: session.sessionID, PageID: uuid.NewString(), AnonymousUserID: session.anonymous,
			Page: event.PageContext{URL: pageURL, Route: page.Route, Title: page.Title, Referrer: referrer},
			// A trace per page view is what a browser SDK propagating context
			// would produce, and it gives the API samples something to link to.
			Trace: &event.TraceContext{TraceID: traceID(random), SpanID: spanID(random)},
			Tags:  map[string]string{"devdata.journey": session.journey.Name},
		}
		for _, chunk := range chunkEvents(events) {
			batches = append(batches, Batch{
				Envelope: event.EnvelopeV1{
					SchemaVersion: "1.0", SentAt: timestamp(at),
					SDK: event.SDK{Name: SDKName, Version: SDKVersion}, Context: context, Events: chunk,
				},
				UserAgent: session.client.UserAgent,
				Country:   session.client.Country,
			})
		}
		referrer = pageURL
		// Advance far enough that consecutive pages land in different seconds
		// without the session outgrowing a plausible visit.
		at = at.Add(time.Duration(4_000+random.Intn(26_000)) * time.Millisecond)
	}
	return batches
}

func pageVitals(page Page, at time.Time, navigation string, random *rand.Rand) []event.EventV1 {
	events := make([]event.EventV1, 0, len(page.Vitals))
	for _, vital := range page.Vitals {
		if !occurs(vital.Odds, random) {
			continue
		}
		value := vital.Value.draw(random)
		metric := event.WebVitalMetric{
			Name: vital.Name, Value: value, Rating: vitalRating(vital.Name, value), NavigationType: navigation,
		}
		events = append(events, event.EventV1{
			EventID: uuid.NewString(), Type: event.EventTypeWebVital,
			Timestamp: timestamp(at.Add(time.Duration(random.Intn(2_500)) * time.Millisecond)), Metric: &metric,
		})
	}
	return events
}

func pageAPIs(page Page, session sessionSeed, at time.Time, baseURL string, random *rand.Rand) []event.EventV1 {
	events := make([]event.EventV1, 0, len(page.APIs))
	for _, api := range page.APIs {
		if !occurs(api.Odds, random) {
			continue
		}
		repeat := 1
		if api.Repeat.Max > 0 {
			repeat = int(api.Repeat.draw(random))
		}
		for call := 0; call < repeat; call++ {
			request := apiRequest(api, session, baseURL, random)
			events = append(events, event.EventV1{
				EventID: uuid.NewString(), Type: event.EventTypeAPI,
				Timestamp: timestamp(at.Add(time.Duration(random.Intn(6_000)) * time.Millisecond)), Request: &request,
			})
		}
	}
	return events
}

func apiRequest(api API, session sessionSeed, baseURL string, random *rand.Rand) event.APIRequest {
	outcomes := api.Outcomes
	if replacement, found := api.FailingReleases[session.release]; found && len(replacement) > 0 {
		outcomes = replacement
	}
	outcome := parseOutcome(pickWeighted(outcomes, random))
	latency := api.LatencyMS.draw(random)
	if multiplier, found := api.SlowClients[session.client.Name]; found && multiplier > 0 {
		latency *= multiplier
	}
	if outcome.failure == "timeout" {
		// A timeout is reported when the client gives up, so its duration
		// clusters just under the deadline instead of tracking the endpoint.
		latency = 9_600 + float64(random.Intn(1_400))
	}
	request := event.APIRequest{
		Method: api.Method, URL: strings.TrimSuffix(baseURL, "/") + api.Path,
		DurationMS: round(latency, 1), Failure: outcome.failure,
	}
	if outcome.status > 0 {
		status := outcome.status
		request.Status = &status
	}
	// A transport failure never delivers a body, so reporting a size for one
	// would be a shape the browser SDK cannot produce.
	if outcome.status >= 200 && outcome.status < 400 {
		size := int64(api.TransferSize.draw(random))
		if size < 1 {
			size = 1
		}
		request.TransferSize = &size
	}
	return request
}

func pageErrors(page Page, at time.Time, random *rand.Rand) []event.EventV1 {
	events := make([]event.EventV1, 0, len(page.Errors))
	for _, failure := range page.Errors {
		if !occurs(failure.Odds, random) {
			continue
		}
		details := event.ErrorDetails{
			Name: failure.Name, Message: failure.Message, Stack: failure.Stack,
			Handled: failure.Handled, Mechanism: failure.Mechanism,
		}
		events = append(events, event.EventV1{
			EventID: uuid.NewString(), Type: event.EventTypeError,
			Timestamp: timestamp(at.Add(time.Duration(random.Intn(9_000)) * time.Millisecond)), Error: &details,
			Breadcrumbs: []event.Breadcrumb{{
				Timestamp: timestamp(at), Category: "navigation", Message: "opened " + page.Path, Level: "info",
			}},
		})
	}
	return events
}

func pageCustom(page Page, at time.Time, random *rand.Rand) []event.EventV1 {
	events := make([]event.EventV1, 0, len(page.Custom))
	for _, custom := range page.Custom {
		if !occurs(custom.Odds, random) {
			continue
		}
		events = append(events, event.EventV1{
			EventID: uuid.NewString(), Type: event.EventTypeCustom,
			Timestamp: timestamp(at.Add(time.Duration(random.Intn(11_000)) * time.Millisecond)),
			Name:      custom.Name, Attributes: custom.Attributes, Measurements: custom.Measurements,
		})
	}
	return events
}

type outcome struct {
	status  int
	failure string
}

// parseOutcome reads an outcome written as "status" or "status:failure", for
// example "200", "404" or "0:network". The failure classification is the
// browser SDK's: only a 5xx counts as an http failure, so a 401 stays a client
// error and does not inflate the failure rate.
func parseOutcome(value string) outcome {
	status, failure, hasFailure := strings.Cut(strings.TrimSpace(value), ":")
	result := outcome{}
	if parsed, err := parseInt(status); err == nil {
		result.status = parsed
	}
	switch {
	case hasFailure:
		result.failure = strings.TrimSpace(failure)
	case result.status >= 500:
		result.failure = "http"
	}
	if result.failure == "network" || result.failure == "timeout" || result.failure == "abort" {
		result.status = 0
	}
	return result
}

func chunkEvents(events []event.EventV1) [][]event.EventV1 {
	if len(events) == 0 {
		return nil
	}
	chunks := make([][]event.EventV1, 0, 1)
	for start := 0; start < len(events); start += MaxEventsPerEnvelope {
		end := min(start+MaxEventsPerEnvelope, len(events))
		chunks = append(chunks, events[start:end])
	}
	return chunks
}

// vitalRating applies the published Core Web Vitals thresholds so a generated
// sample is rated the way a browser would rate it.
func vitalRating(name string, value float64) string {
	good, poor := 0.0, 0.0
	switch name {
	case "LCP":
		good, poor = 2_500, 4_000
	case "INP":
		good, poor = 200, 500
	case "CLS":
		good, poor = 0.1, 0.25
	case "FCP":
		good, poor = 1_800, 3_000
	case "TTFB":
		good, poor = 800, 1_800
	}
	switch {
	case value <= good:
		return "good"
	case value <= poor:
		return "needs-improvement"
	default:
		return "poor"
	}
}

func (span Range) draw(random *rand.Rand) float64 {
	if span.Max <= span.Min {
		return span.Min
	}
	return span.Min + random.Float64()*(span.Max-span.Min)
}

func occurs(odds float64, random *rand.Rand) bool {
	if odds <= 0 {
		return false
	}
	if odds >= 1 {
		return true
	}
	return random.Float64() < odds
}

type picker[T any] struct {
	items  []T
	weight func(T) int
	total  int
}

func newPicker[T any](items []T, weight func(T) int) picker[T] {
	result := picker[T]{items: items, weight: weight}
	for _, item := range items {
		if value := weight(item); value > 0 {
			result.total += value
		}
	}
	return result
}

// pick draws by weight, falling back to a uniform draw when a scenario left
// every weight at zero so an omitted weight does not silently drop the item.
func (source picker[T]) pick(random *rand.Rand) T {
	var zero T
	if len(source.items) == 0 {
		return zero
	}
	if source.total <= 0 {
		return source.items[random.Intn(len(source.items))]
	}
	draw := random.Intn(source.total)
	for _, item := range source.items {
		weight := source.weight(item)
		if weight <= 0 {
			continue
		}
		if draw < weight {
			return item
		}
		draw -= weight
	}
	return source.items[len(source.items)-1]
}

func pickWeighted(weights []Weight, random *rand.Rand) string {
	return newPicker(weights, func(item Weight) int { return item.Weight }).pick(random).Value
}

func timestamp(at time.Time) string {
	return at.UTC().Format(time.RFC3339Nano)
}

func round(value float64, places int) float64 {
	scale := 1.0
	for index := 0; index < places; index++ {
		scale *= 10
	}
	return float64(int64(value*scale+0.5)) / scale
}

func parseInt(value string) (int, error) {
	result := 0
	value = strings.TrimSpace(value)
	if value == "" {
		return 0, fmt.Errorf("empty status")
	}
	for index := 0; index < len(value); index++ {
		if value[index] < '0' || value[index] > '9' {
			return 0, fmt.Errorf("status %q is not a number", value)
		}
		result = result*10 + int(value[index]-'0')
	}
	return result, nil
}

// traceID and spanID produce the fixed-width hex the protocol requires.
func traceID(random *rand.Rand) string { return randomHex(random, 16) }

func spanID(random *rand.Rand) string { return randomHex(random, 8) }

func randomHex(random *rand.Rand, bytes int) string {
	buffer := make([]byte, bytes)
	random.Read(buffer)
	return hex.EncodeToString(buffer)
}
