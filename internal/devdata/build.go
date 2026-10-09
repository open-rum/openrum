package devdata

import (
	"encoding/hex"
	"fmt"
	"math"
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

	referrers := newPicker(scenario.Referrers, func(referrer Weight) int { return referrer.Weight })
	visitors := newVisitorPool(scenario, clients, random)

	batches := make([]Batch, 0, scenario.Sessions)
	summary := Summary{Sessions: scenario.Sessions, ByType: map[string]int{}}
	for index := 0; index < scenario.Sessions; index++ {
		visitor := visitors.next(index, random)
		session := sessionSeed{
			client:  visitor.client,
			journey: journeys.pick(random),
			// Sessions are spread across the window instead of clustered at one
			// instant, so per-minute rollups and trend charts have a shape; a daily
			// rhythm makes that shape follow when people actually shop.
			startedAt: sessionStart(scenario, random),
			sessionID: uuid.NewString(),
			anonymous: visitor.anonymous,
			userID:    visitor.userID,
		}
		if releases.total > 0 {
			session.release = releases.pick(random).Value
		}
		if referrers.total > 0 || len(scenario.Referrers) > 0 {
			session.referrer = referrers.pick(random).Value
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
	referrer  string
	startedAt time.Time
	sessionID string
	anonymous string
	userID    string
}

type visitor struct {
	client    Client
	anonymous string
	userID    string
}

// visitorPool hands out returning visitors: each keeps its device and, when signed
// in, its business user ID across sessions, so UV is lower than sessions and a user
// can be followed through several visits.
type visitorPool struct {
	visitors []visitor
	clients  picker[Client]
}

func newVisitorPool(scenario Scenario, clients picker[Client], random *rand.Rand) visitorPool {
	pool := visitorPool{clients: clients}
	users := scenario.Users
	if users == nil || users.Visitors <= 0 {
		return pool
	}
	prefix := users.Prefix
	if prefix == "" {
		prefix = "user_"
	}
	signedIn := 0
	pool.visitors = make([]visitor, users.Visitors)
	for index := range pool.visitors {
		current := visitor{client: clients.pick(random), anonymous: uuid.NewString()}
		if occurs(users.SignedIn, random) {
			if len(users.IDs) > 0 {
				current.userID = strings.TrimSpace(users.IDs[signedIn%len(users.IDs)])
			} else {
				current.userID = fmt.Sprintf("%s%d", prefix, 10_001+signedIn)
			}
			signedIn++
		}
		pool.visitors[index] = current
	}
	return pool
}

// next picks the visitor for a session. Activity is skewed so a few loyal visitors
// return often while most come once or twice, as in real storefront traffic.
func (pool visitorPool) next(index int, random *rand.Rand) visitor {
	if len(pool.visitors) == 0 {
		return visitor{client: pool.clients.pick(random), anonymous: uuid.NewString()}
	}
	if index < len(pool.visitors) {
		return pool.visitors[index]
	}
	skewed := math.Pow(random.Float64(), 1.8)
	return pool.visitors[int(skewed*float64(len(pool.visitors)))%len(pool.visitors)]
}

// sessionStart draws a start time, following the daily rhythm when one is set.
func sessionStart(scenario Scenario, random *rand.Rand) time.Time {
	span := float64(scenario.To.Sub(scenario.From))
	uniform := func() time.Time { return scenario.From.Add(time.Duration(random.Float64() * span)) }
	rhythm := scenario.DailyRhythm
	if rhythm == nil || len(rhythm.Hourly) != 24 {
		return uniform()
	}
	location, err := time.LoadLocation(rhythm.TimeZone)
	if err != nil {
		return uniform()
	}
	peak := 0.0
	for _, weight := range rhythm.Hourly {
		peak = math.Max(peak, weight)
	}
	// Rejection sampling keeps every draw inside the window while bending the
	// density towards busy hours; the bound keeps a flat-zero curve from looping.
	for attempt := 0; attempt < 64; attempt++ {
		candidate := uniform()
		hour := candidate.In(location).Hour()
		next := rhythm.Hourly[(hour+1)%24]
		minute := float64(candidate.In(location).Minute()) / 60
		weight := rhythm.Hourly[hour]*(1-minute) + next*minute
		if random.Float64()*peak <= weight {
			return candidate
		}
	}
	return uniform()
}

// incidentAt returns the error and failure multipliers in effect at a moment.
func incidentAt(scenario Scenario, at time.Time) (float64, float64) {
	errors, failures := 1.0, 1.0
	span := float64(scenario.To.Sub(scenario.From))
	if span <= 0 {
		return errors, failures
	}
	position := float64(at.Sub(scenario.From)) / span
	for _, incident := range scenario.Incidents {
		if position >= incident.Start && position < incident.End {
			errors = math.Max(errors, incident.ErrorMultiplier)
			failures = math.Max(failures, incident.FailureMultiplier)
		}
	}
	return errors, failures
}

func buildSession(scenario Scenario, session sessionSeed, random *rand.Rand) []Batch {
	batches := make([]Batch, 0, len(session.journey.Pages))
	at := session.startedAt
	referrer := ""
	referrer = session.referrer
	for pageIndex, page := range session.journey.Pages {
		path := page.Path
		if len(page.Paths) > 0 {
			path = page.Paths[random.Intn(len(page.Paths))]
		}
		errorBoost, failureBoost := incidentAt(scenario, at)
		pageURL := strings.TrimSuffix(scenario.BaseURL, "/") + path
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
		events = append(events, pageAPIs(page, session, at, scenario.BaseURL, failureBoost, random)...)
		events = append(events, pageErrors(page, path, at, errorBoost, random)...)
		events = append(events, pageCustom(page, at, random)...)
		events = append(events, pageClicks(page, at, random)...)
		for _, log := range page.Logs {
			if !occurs(log.Odds, random) {
				continue
			}
			events = append(events, event.EventV1{EventID: uuid.NewString(), Type: event.EventTypeLog, Timestamp: timestamp(at.Add(time.Duration(random.Intn(6000)) * time.Millisecond)), Level: log.Level, Message: log.Message, Logger: log.Logger, Attributes: log.Attributes})
		}

		context := event.EventContext{
			Environment: scenario.Environment, Release: session.release,
			SessionID: session.sessionID, PageID: uuid.NewString(), AnonymousUserID: session.anonymous,
			UserID: session.userID,
			Page:   event.PageContext{URL: pageURL, Route: page.Route, Title: page.Title, Referrer: referrer},
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
		if occurs(page.Exit, random) {
			break
		}
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

func pageAPIs(page Page, session sessionSeed, at time.Time, baseURL string, failureBoost float64, random *rand.Rand) []event.EventV1 {
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
			request := apiRequest(api, session, baseURL, failureBoost, random)
			events = append(events, event.EventV1{
				EventID: uuid.NewString(), Type: event.EventTypeAPI,
				Timestamp: timestamp(at.Add(time.Duration(random.Intn(6_000)) * time.Millisecond)), Request: &request,
			})
		}
	}
	return events
}

func apiRequest(api API, session sessionSeed, baseURL string, failureBoost float64, random *rand.Rand) event.APIRequest {
	outcomes := api.Outcomes
	if replacement, found := api.FailingReleases[session.release]; found && len(replacement) > 0 {
		outcomes = replacement
	}
	if failureBoost > 1 {
		outcomes = boostFailures(outcomes, failureBoost)
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

// boostFailures scales the weight of every failing outcome, leaving successes as
// they are, so an incident raises the failure rate without inventing new statuses.
func boostFailures(outcomes []Weight, factor float64) []Weight {
	boosted := make([]Weight, len(outcomes))
	for index, item := range outcomes {
		boosted[index] = item
		if parsed := parseOutcome(item.Value); parsed.failure != "" {
			boosted[index].Weight = int(math.Round(float64(item.Weight) * factor))
		}
	}
	return boosted
}

func pageErrors(page Page, path string, at time.Time, boost float64, random *rand.Rand) []event.EventV1 {
	events := make([]event.EventV1, 0, len(page.Errors))
	for _, failure := range page.Errors {
		if !occurs(math.Min(1, failure.Odds*boost), random) {
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
				Timestamp: timestamp(at), Category: "navigation", Message: "opened " + path, Level: "info",
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
		measurements := custom.Measurements
		if len(custom.MeasurementRanges) > 0 {
			measurements = make(map[string]float64, len(custom.Measurements)+len(custom.MeasurementRanges))
			for key, value := range custom.Measurements {
				measurements[key] = value
			}
			for key, span := range custom.MeasurementRanges {
				measurements[key] = round(span.draw(random), 2)
			}
		}
		events = append(events, event.EventV1{
			EventID: uuid.NewString(), Type: event.EventTypeCustom,
			Timestamp: timestamp(at.Add(time.Duration(random.Intn(11_000)) * time.Millisecond)),
			Name:      custom.Name, Attributes: custom.Attributes, Measurements: measurements,
		})
	}
	return events
}

// pageClicks emits the automatic SDK click behavior event, so paths, heatmap-style
// click rankings and session timelines have interactions between page views.
func pageClicks(page Page, at time.Time, random *rand.Rand) []event.EventV1 {
	events := make([]event.EventV1, 0, len(page.Clicks))
	for _, click := range page.Clicks {
		if !occurs(click.Odds, random) {
			continue
		}
		attributes := map[string]string{"element": strings.ToLower(click.Element), "name": click.Name}
		if click.Role != "" {
			attributes["role"] = click.Role
		}
		events = append(events, event.EventV1{
			EventID: uuid.NewString(), Type: event.EventTypeCustom,
			Timestamp: timestamp(at.Add(time.Duration(1_000+random.Intn(9_000)) * time.Millisecond)),
			Name:      event.BehaviorEventClick, Attributes: attributes,
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
	draw := random.Float64()
	if span.Skew > 1 {
		draw = math.Pow(draw, span.Skew)
	}
	return span.Min + draw*(span.Max-span.Min)
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
