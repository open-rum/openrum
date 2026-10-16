package consumerservice

import (
	"context"
	"errors"
	"reflect"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"

	"openrum/internal/capture"
	"openrum/internal/event"
	"openrum/internal/metadata"
	"openrum/internal/processing"
)

func apiEvent(method, endpoint string) event.CanonicalEvent {
	return event.CanonicalEvent{
		EventID: uuid.New(), EventType: event.EventTypeAPI, APIMethod: method, APIURLNormalized: endpoint,
		APIRequestHeaders:  map[string]string{"x-request-id": "r-1", "accept": "application/json"},
		APIResponseHeaders: map[string]string{"content-type": "application/json", "etag": `"abc"`},
	}
}

func compileCapture(t *testing.T, rules ...capture.Rule) *capture.Compiled {
	t.Helper()
	compiled, err := capture.Compile(capture.Settings{Rules: rules})
	if err != nil {
		t.Fatal(err)
	}
	return compiled
}

func TestApplyAPICaptureClearsEverythingWithoutRules(t *testing.T) {
	for name, compiled := range map[string]*capture.Compiled{"nil": nil, "empty": compileCapture(t)} {
		events := []event.CanonicalEvent{apiEvent("GET", "https://api.example.com/orders/:id")}
		applyAPICapture(events, compiled)
		if events[0].APIRequestHeaders != nil || events[0].APIResponseHeaders != nil {
			t.Fatalf("%s: headers survived without a rule: %+v %+v", name, events[0].APIRequestHeaders, events[0].APIResponseHeaders)
		}
	}
}

func TestApplyAPICaptureKeepsOnlyNamedHeadersOfMatchingEndpoints(t *testing.T) {
	compiled := compileCapture(t, capture.Rule{
		ID: "orders", Method: "GET", Pattern: "https://api.example.com/orders/:id",
		RequestHeaders: []string{"x-request-id"}, ResponseHeaders: []string{"etag"},
	})
	events := []event.CanonicalEvent{
		apiEvent("GET", "https://api.example.com/orders/:id"),
		apiEvent("POST", "https://api.example.com/orders/:id"),
		apiEvent("GET", "https://api.example.com/users/:id"),
		{EventID: uuid.New(), EventType: event.EventTypeCustom, APIRequestHeaders: map[string]string{"x-request-id": "smuggled"}},
	}
	applyAPICapture(events, compiled)

	if !reflect.DeepEqual(events[0].APIRequestHeaders, map[string]string{"x-request-id": "r-1"}) ||
		!reflect.DeepEqual(events[0].APIResponseHeaders, map[string]string{"etag": `"abc"`}) {
		t.Fatalf("opted-in endpoint = %+v %+v", events[0].APIRequestHeaders, events[0].APIResponseHeaders)
	}
	for _, index := range []int{1, 2} {
		if events[index].APIRequestHeaders != nil || events[index].APIResponseHeaders != nil {
			t.Fatalf("event %d is not opted in but kept headers: %+v %+v", index, events[index].APIRequestHeaders, events[index].APIResponseHeaders)
		}
	}
	if events[3].APIRequestHeaders != nil {
		t.Fatalf("headers on a non-API event must be dropped: %+v", events[3].APIRequestHeaders)
	}
}

type fixedProcessingRules struct{ compiled *processing.Compiled }

func (rules fixedProcessingRules) Get(context.Context, uuid.UUID) (*processing.Compiled, error) {
	return rules.compiled, nil
}

type fixedCaptureRules struct {
	compiled *capture.Compiled
	err      error
}

func (rules fixedCaptureRules) Get(context.Context, uuid.UUID) (*capture.Compiled, error) {
	return rules.compiled, rules.err
}

func storedAPIEvent(t *testing.T, consumer *Consumer, events *fakeEventSink) event.CanonicalEvent {
	t.Helper()
	if err := consumer.ConsumeOne(context.Background()); err != nil {
		t.Fatal(err)
	}
	for _, current := range events.events {
		if current.EventType == event.EventTypeAPI {
			return current
		}
	}
	t.Fatalf("no API event was stored: %+v", events.events)
	return event.CanonicalEvent{}
}

func TestConsumerStoresNoHeadersWithoutACaptureProvider(t *testing.T) {
	_, events, _, consumer := testConsumer(t, queuePayloadFrom(t, "valid-api-headers.json"))
	stored := storedAPIEvent(t, consumer, events)
	if stored.APIRequestHeaders != nil || stored.APIResponseHeaders != nil {
		t.Fatalf("a consumer without the feature stored headers: %+v %+v", stored.APIRequestHeaders, stored.APIResponseHeaders)
	}
}

func TestConsumerStoresHeadersOnlyForOptedInEndpoints(t *testing.T) {
	_, events, _, consumer := testConsumer(t, queuePayloadFrom(t, "valid-api-headers.json"))
	consumer.capture = fixedCaptureRules{compiled: compileCapture(t, capture.Rule{
		ID: "order", Method: "POST", Pattern: "https://shop.example.com/api/order/*",
		ResponseHeaders: []string{"etag", "content-type"},
	})}
	stored := storedAPIEvent(t, consumer, events)
	if stored.APIRequestHeaders != nil {
		t.Fatalf("request headers were not opted in: %+v", stored.APIRequestHeaders)
	}
	if !reflect.DeepEqual(stored.APIResponseHeaders, map[string]string{"etag": `"abc"`, "content-type": "application/json"}) {
		t.Fatalf("response headers = %+v", stored.APIResponseHeaders)
	}

	_, events, _, consumer = testConsumer(t, queuePayloadFrom(t, "valid-api-headers.json"))
	consumer.capture = fixedCaptureRules{compiled: compileCapture(t, capture.Rule{
		ID: "other", Method: "GET", Pattern: "https://shop.example.com/api/order/*", ResponseHeaders: []string{"etag"},
	})}
	if stored := storedAPIEvent(t, consumer, events); stored.APIResponseHeaders != nil {
		t.Fatalf("a rule for GET must not capture a POST: %+v", stored.APIResponseHeaders)
	}
}

func TestConsumerMatchesRulesAgainstTheRewrittenEndpoint(t *testing.T) {
	_, events, _, consumer := testConsumer(t, queuePayloadFrom(t, "valid-api-headers.json"))
	consumer.capture = fixedCaptureRules{compiled: compileCapture(t, capture.Rule{
		ID: "rewritten", Method: "POST", Pattern: "https://shop.example.com/api/order/:action", ResponseHeaders: []string{"etag"},
	})}
	// The event arrives as /api/order/submit; the project's URL rule turns that into
	// /api/order/:action, which is the endpoint the capture rule is written against.
	consumer.processing = fixedProcessingRules{compiled: compileProcessing(t, processing.Settings{URL: processing.URLRules{
		Rules: []processing.Rule{{ID: "order", Target: processing.TargetAPI, Pattern: "/api/order/:action"}},
	}})}
	if stored := storedAPIEvent(t, consumer, events); stored.APIResponseHeaders["etag"] == "" {
		t.Fatalf("capture must match the endpoint after URL rules, got %+v", stored.APIResponseHeaders)
	}
}

func TestConsumerDoesNotCommitWhenCaptureRulesCannotBeResolved(t *testing.T) {
	source, events, _, consumer := testConsumer(t, queuePayloadFrom(t, "valid-api-headers.json"))
	consumer.capture = fixedCaptureRules{err: errors.New("database unavailable")}
	if err := consumer.ConsumeOne(context.Background()); err == nil {
		t.Fatal("an unresolved rule set must fail the message so it is retried, not stored")
	}
	if source.commits != 0 || len(events.events) != 0 {
		t.Fatalf("commits=%d events=%d", source.commits, len(events.events))
	}
}

func TestConsumerDropsEventsOfInactiveProjectsWhenResolvingCaptureRules(t *testing.T) {
	source, events, _, consumer := testConsumer(t, queuePayloadFrom(t, "valid-api-headers.json"))
	consumer.capture = fixedCaptureRules{err: metadata.ErrNotFound}
	if err := consumer.ConsumeOne(context.Background()); err != nil || source.commits != 1 || len(events.events) != 0 {
		t.Fatalf("err=%v commits=%d events=%d", err, source.commits, len(events.events))
	}
}

type countingCaptureRepository struct {
	settings capture.Settings
	calls    atomic.Int32
}

func (repository *countingCaptureRepository) Get(context.Context, uuid.UUID) (capture.Settings, error) {
	repository.calls.Add(1)
	return repository.settings, nil
}

func TestCachedAPICaptureProviderCachesWithinTTLAndRefreshesAfter(t *testing.T) {
	repository := &countingCaptureRepository{settings: capture.Settings{Rules: []capture.Rule{{
		ID: "r", Method: "GET", Pattern: "https://api.example.com/*", ResponseHeaders: []string{"etag"},
	}}}}
	provider := NewCachedAPICaptureSettingsProvider(repository, time.Minute)
	now := time.Date(2026, 10, 13, 9, 0, 0, 0, time.UTC)
	provider.now = func() time.Time { return now }
	project := uuid.New()

	first, err := provider.Get(context.Background(), project)
	if err != nil || !first.Active() {
		t.Fatalf("compiled=%v err=%v", first, err)
	}
	if _, err := provider.Get(context.Background(), project); err != nil || repository.calls.Load() != 1 {
		t.Fatalf("a second read inside the TTL must hit the cache, calls=%d err=%v", repository.calls.Load(), err)
	}
	now = now.Add(2 * time.Minute)
	repository.settings = capture.Settings{}
	refreshed, err := provider.Get(context.Background(), project)
	if err != nil || refreshed.Active() || repository.calls.Load() != 2 {
		t.Fatalf("after the TTL the new rules apply: active=%v calls=%d err=%v", refreshed.Active(), repository.calls.Load(), err)
	}
}

func TestCachedAPICaptureProviderFailsClosedOnInvalidStoredRules(t *testing.T) {
	repository := &countingCaptureRepository{settings: capture.Settings{Rules: []capture.Rule{{
		ID: "bad", Method: "GET", Pattern: "https://api.example.com/*", RequestHeaders: []string{"authorization"},
	}}}}
	if compiled, err := NewCachedAPICaptureSettingsProvider(repository, time.Minute).Get(context.Background(), uuid.New()); err == nil {
		t.Fatalf("a stored rule that names a credential header must not compile, got %+v", compiled)
	}
}

func TestApplyAPICaptureKeepsABodyOnlyForTheDirectionTheRuleOpenedIn(t *testing.T) {
	compiled := compileCapture(t,
		capture.Rule{ID: "orders", Method: "POST", Pattern: "https://api.example.com/orders", RequestBody: true},
		capture.Rule{ID: "reads", Method: "GET", Pattern: "https://api.example.com/*", ResponseBody: true},
	)
	withBodies := func(method, endpoint string) event.CanonicalEvent {
		candidate := apiEvent(method, endpoint)
		candidate.APIRequestBody, candidate.APIResponseBody = `{"a":1}`, `{"b":2}`
		return candidate
	}
	events := []event.CanonicalEvent{
		withBodies("POST", "https://api.example.com/orders"),
		withBodies("GET", "https://api.example.com/orders"),
		withBodies("GET", "https://other.example.com/x"),
		{EventID: uuid.New(), EventType: event.EventTypeCustom, APIRequestBody: "smuggled", APIResponseBody: "smuggled"},
	}
	applyAPICapture(events, compiled)

	if events[0].APIRequestBody != `{"a":1}` || events[0].APIResponseBody != "" {
		t.Fatalf("POST rule opted only the request body in: %q / %q", events[0].APIRequestBody, events[0].APIResponseBody)
	}
	if events[1].APIRequestBody != "" || events[1].APIResponseBody != `{"b":2}` {
		t.Fatalf("GET rule opted only the response body in: %q / %q", events[1].APIRequestBody, events[1].APIResponseBody)
	}
	if events[2].APIRequestBody != "" || events[2].APIResponseBody != "" {
		t.Fatalf("an endpoint no rule names kept a body: %q / %q", events[2].APIRequestBody, events[2].APIResponseBody)
	}
	if events[3].APIRequestBody != "" || events[3].APIResponseBody != "" {
		t.Fatalf("a body on a non-API event must be dropped: %q / %q", events[3].APIRequestBody, events[3].APIResponseBody)
	}
}

func TestApplyAPICaptureClearsBodiesWithoutRules(t *testing.T) {
	events := []event.CanonicalEvent{apiEvent("POST", "https://api.example.com/orders")}
	events[0].APIRequestBody, events[0].APIResponseBody = "x", "y"
	applyAPICapture(events, nil)
	if events[0].APIRequestBody != "" || events[0].APIResponseBody != "" {
		t.Fatalf("a body survived without a rule: %q / %q", events[0].APIRequestBody, events[0].APIResponseBody)
	}
}

func TestConsumerStoresRedactedBodiesOnlyForOptedInEndpoints(t *testing.T) {
	_, events, _, consumer := testConsumer(t, queuePayloadFrom(t, "valid-api-bodies.json"))
	consumer.capture = fixedCaptureRules{compiled: compileCapture(t, capture.Rule{
		ID: "order", Method: "*", Pattern: "https://shop.example.com/api/order/*", ResponseBody: true,
	})}
	stored := storedAPIEvent(t, consumer, events)
	if stored.APIRequestBody != "" {
		t.Fatalf("the request body was not opted in: %q", stored.APIRequestBody)
	}
	if stored.APIResponseBody != `{"orderId":"o-1"}` {
		t.Fatalf("response body = %q", stored.APIResponseBody)
	}

	_, events, _, consumer = testConsumer(t, queuePayloadFrom(t, "valid-api-bodies.json"))
	if stored := storedAPIEvent(t, consumer, events); stored.APIRequestBody != "" || stored.APIResponseBody != "" {
		t.Fatalf("a consumer without the feature stored a body: %q / %q", stored.APIRequestBody, stored.APIResponseBody)
	}
}
