package event

import (
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
)

const (
	SyntheticSDKName = "openrum-synthetic"
	SyntheticRoute   = "/__openrum_test__"
)

var ErrInvalidSyntheticEvent = errors.New("invalid synthetic Event input")

// NewSyntheticEnvelope creates a protocol-valid Page View that exercises the
// same Kafka and Consumer path as browser Events. The trusted queue wrapper is
// responsible for marking it synthetic; sample_rate=1 ensures project sampling
// settings cannot suppress an explicitly requested test.
func NewSyntheticEnvelope(environment string, at time.Time) (EnvelopeV1, error) {
	environment = strings.TrimSpace(environment)
	if environment == "" || len(environment) > 64 || at.IsZero() {
		return EnvelopeV1{}, ErrInvalidSyntheticEvent
	}
	at = at.UTC()
	sampleRate := 1.0
	return EnvelopeV1{
		SchemaVersion: "1.0",
		SentAt:        at.Format(time.RFC3339Nano),
		SDK:           SDK{Name: SyntheticSDKName, Version: "1.0"},
		Context: EventContext{
			Environment:     environment,
			SessionID:       uuid.NewString(),
			PageID:          uuid.NewString(),
			AnonymousUserID: "synthetic:" + uuid.NewString(),
			Page: PageContext{
				URL:   "https://openrum.invalid" + SyntheticRoute,
				Route: SyntheticRoute,
				Title: "OpenRUM test Event",
			},
		},
		Events: []EventV1{{
			EventID: uuid.NewString(), Type: EventTypePageView,
			Timestamp: at.Format(time.RFC3339Nano), SampleRate: &sampleRate,
			NavigationType: "navigate",
		}},
	}, nil
}
