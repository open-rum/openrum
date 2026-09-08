package event_test

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"openrum/internal/event"
	"openrum/internal/ingest"
)

func TestNormalizeQueuedEnvelopeProducesScrubbedCanonicalEvents(t *testing.T) {
	envelope := fixtureEnvelope(t)
	envelope.Context.Page.URL = "https://shop.example.com/orders/018f4d9c-83a1-76c9-81c2-3020ab667004?token=secret#payment"
	envelope.Context.Page.Route = "/orders/018f4d9c-83a1-76c9-81c2-3020ab667004"
	envelope.Context.Page.Title = "Order for user@example.com"
	envelope.Context.UserID = "user@example.com"
	envelope.Events[1].Error.Message = "card 4242 4242 4242 4242 belongs to user@example.com"
	envelope.Events[3].Request.URL = "https://api.example.com/orders/123456?authorization=secret"
	envelope.Events[4].Attributes["api_token"] = "secret"

	payload := queuedPayload(t, envelope, event.QueueSchemaVersion)
	canonical, failures, err := event.NormalizeQueuedEnvelope(payload)
	if err != nil {
		t.Fatal(err)
	}
	if len(canonical) != 5 || len(failures) != 0 {
		t.Fatalf("canonical=%d failures=%+v", len(canonical), failures)
	}
	page := canonical[0]
	if page.PageURL != "https://shop.example.com/orders/018f4d9c-83a1-76c9-81c2-3020ab667004" || page.PageURLNormalized != "https://shop.example.com/orders/:id" {
		t.Fatalf("page URLs=%q %q", page.PageURL, page.PageURLNormalized)
	}
	if page.Browser != "Chrome" || page.DeviceType != "desktop" || page.OS != "Windows" {
		t.Fatalf("browser=%q os=%q device=%q", page.Browser, page.OS, page.DeviceType)
	}
	if canonical[3].APIURLNormalized != "https://api.example.com/orders/:id" {
		t.Fatalf("API URL=%q", canonical[3].APIURLNormalized)
	}
	encoded, err := json.Marshal(canonical)
	if err != nil {
		t.Fatal(err)
	}
	for _, sensitive := range []string{"user@example.com", "4242 4242", "token=secret", "authorization=secret", "api_token"} {
		if strings.Contains(string(encoded), sensitive) {
			t.Fatalf("canonical data contains %q: %s", sensitive, encoded)
		}
	}
}

func TestNormalizeQueuedEnvelopeSupportsPreviousQueueAndEventSchema(t *testing.T) {
	envelope := fixtureEnvelope(t)
	envelope.SchemaVersion = "0.9"
	payload := queuedPayload(t, envelope, event.PreviousQueueSchemaVersion)
	canonical, failures, err := event.NormalizeQueuedEnvelope(payload)
	if err != nil || len(canonical) != 5 || len(failures) != 0 {
		t.Fatalf("canonical=%d failures=%+v error=%v", len(canonical), failures, err)
	}
}

func TestNormalizeQueuedEnvelopeIsolatesMalformedSibling(t *testing.T) {
	payload := queuedPayload(t, fixtureEnvelope(t), event.QueueSchemaVersion)
	var document map[string]json.RawMessage
	if err := json.Unmarshal(payload, &document); err != nil {
		t.Fatal(err)
	}
	var envelope map[string]json.RawMessage
	if err := json.Unmarshal(document["envelope"], &envelope); err != nil {
		t.Fatal(err)
	}
	var events []json.RawMessage
	if err := json.Unmarshal(envelope["events"], &events); err != nil {
		t.Fatal(err)
	}
	events[1] = json.RawMessage(`{"event_id":"018f4d9c-83a1-76c9-81c2-3020ab667002","type":"error","timestamp":"2026-09-02T10:00:00Z","error":"malformed"}`)
	envelope["events"], _ = json.Marshal(events)
	document["envelope"], _ = json.Marshal(envelope)
	payload, _ = json.Marshal(document)

	canonical, failures, err := event.NormalizeQueuedEnvelope(payload)
	if err != nil || len(canonical) != 4 || len(failures) != 1 || failures[0].EventID == "" {
		t.Fatalf("canonical=%d failures=%+v error=%v", len(canonical), failures, err)
	}
}

func TestNormalizeQueuedEnvelopeRejectsUnsupportedOrIncompleteMetadata(t *testing.T) {
	payload := queuedPayload(t, fixtureEnvelope(t), "future")
	if _, _, err := event.NormalizeQueuedEnvelope(payload); !errors.Is(err, event.ErrInvalidQueueEnvelope) {
		t.Fatalf("error=%v", err)
	}
}

func TestNormalizeFlagsCrawlerAndHeadlessTraffic(t *testing.T) {
	for _, testCase := range []struct {
		name      string
		userAgent string
		wantBot   bool
	}{
		{
			name:      "ordinary browser",
			userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36",
			wantBot:   false,
		},
		{
			name:      "search crawler",
			userAgent: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
			wantBot:   true,
		},
		{
			// Automation reaches the SDK the way a real browser does, which is
			// why it is worth flagging: a crawler that never runs JavaScript
			// would not have produced an event at all.
			name:      "headless browser",
			userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 HeadlessChrome/128.0.0.0 Safari/537.36",
			wantBot:   true,
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			payload := queuedPayloadWithUserAgent(t, fixtureEnvelope(t), "1.0", testCase.userAgent)
			normalized, failures, err := event.NormalizeQueuedEnvelope(payload)
			if err != nil || len(failures) != 0 || len(normalized) == 0 {
				t.Fatalf("normalize: err=%v failures=%v events=%d", err, failures, len(normalized))
			}
			for _, candidate := range normalized {
				if slices.Contains(candidate.IngestFlags, "bot") != testCase.wantBot {
					t.Fatalf("flags = %v, want bot=%v", candidate.IngestFlags, testCase.wantBot)
				}
			}
		})
	}
}

func queuedPayload(t *testing.T, envelope event.EnvelopeV1, queueVersion string) []byte {
	t.Helper()
	return queuedPayloadWithUserAgent(t, envelope, queueVersion,
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36")
}

func queuedPayloadWithUserAgent(t *testing.T, envelope event.EnvelopeV1, queueVersion, userAgent string) []byte {
	t.Helper()
	queued := ingest.QueuedEnvelope{
		QueueSchemaVersion: queueVersion,
		ProjectID:          uuid.New(),
		OrganizationID:     uuid.New(),
		ReceivedAt:         time.Date(2026, 9, 2, 10, 0, 2, 0, time.UTC),
		Origin:             "https://shop.example.com",
		ClientIP:           "203.0.113.10",
		UserAgent:          userAgent,
		Envelope:           envelope,
	}
	payload, err := json.Marshal(queued)
	if err != nil {
		t.Fatal(err)
	}
	return payload
}

func fixtureEnvelope(t *testing.T) event.EnvelopeV1 {
	t.Helper()
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve fixture path")
	}
	payload, err := os.ReadFile(filepath.Join(filepath.Dir(filename), "..", "..", "packages", "protocol", "fixtures", "valid-all-events.json"))
	if err != nil {
		t.Fatal(err)
	}
	envelope, err := event.DecodeEnvelopeV1(payload)
	if err != nil {
		t.Fatal(err)
	}
	return envelope
}
