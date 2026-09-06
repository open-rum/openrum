package consumerservice

import (
	"openrum/internal/event"
	"openrum/internal/fingerprint"
)

type errorFingerprinter func(fingerprint.Input) (fingerprint.Result, error)

func enrichErrorEvents(events []event.CanonicalEvent, compute errorFingerprinter) {
	for index := range events {
		current := &events[index]
		if current.EventType != event.EventTypeError {
			continue
		}
		input := fingerprint.Input{
			ErrorType: current.ErrorType,
			Message:   current.ErrorMessage,
			Stack:     current.ErrorStack,
			Custom:    current.CustomFingerprint,
		}
		result, err := compute(input)
		if err != nil && len(input.Custom) > 0 {
			input.Custom = nil
			result, err = compute(input)
			current.IngestFlags = appendEventFlag(current.IngestFlags, "fingerprint_fallback")
		}
		if err != nil {
			current.IngestFlags = appendEventFlag(current.IngestFlags, "fingerprint_failed")
			continue
		}
		current.Fingerprint = result.Value
		current.FingerprintVersion = result.Version
	}
}

func appendEventFlag(flags []string, value string) []string {
	for _, flag := range flags {
		if flag == value {
			return flags
		}
	}
	return append(flags, value)
}
