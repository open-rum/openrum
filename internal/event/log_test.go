package event_test

import (
	"encoding/json"
	"openrum/internal/event"
	"strings"
	"testing"
)

func TestLogProtocolAndNormalization(t *testing.T) {
	for _, level := range []string{"trace", "debug", "info", "warn", "error", "fatal"} {
		envelope := fixtureEnvelope(t)
		log := envelope.Events[0]
		log.Type = event.EventTypeLog
		log.NavigationType = ""
		log.Level = level
		log.Message = "payment failed person@example.com Bearer private"
		log.Logger = "checkout"
		log.Attributes = map[string]string{"order.id": "123", "password": "private"}
		envelope.Events = []event.EventV1{log}
		encoded, _ := json.Marshal(envelope)
		if err := event.ValidateEnvelopeV1(encoded); err != nil {
			t.Fatal(err)
		}
		canonical, failures, err := event.NormalizeQueuedEnvelope(queuedPayload(t, envelope, event.QueueSchemaVersion))
		if err != nil || len(failures) != 0 || len(canonical) != 1 {
			t.Fatalf("%v %v", err, failures)
		}
		if canonical[0].LogLevel != level || canonical[0].LogLogger != "checkout" || canonical[0].Fingerprint != "" {
			t.Fatalf("unexpected log: %+v", canonical[0])
		}
		data, _ := json.Marshal(canonical)
		if strings.Contains(string(data), "person@example.com") || strings.Contains(string(data), "private") {
			t.Fatal("log not scrubbed")
		}
		for _, message := range []string{"", strings.Repeat("x", 4097)} {
			envelope.Events[0].Message = message
			encoded, _ = json.Marshal(envelope)
			if event.ValidateEnvelopeV1(encoded) == nil {
				t.Fatal("invalid log message accepted")
			}
		}
		envelope.Events[0].Message = "valid"
		envelope.Events[0].Level = "unknown"
		encoded, _ = json.Marshal(envelope)
		if event.ValidateEnvelopeV1(encoded) == nil {
			t.Fatal("invalid severity accepted")
		}
	}
}
