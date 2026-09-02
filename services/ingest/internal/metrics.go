package ingestservice

import (
	"time"

	"github.com/prometheus/client_golang/prometheus"

	"openrum/internal/event"
)

type Metrics struct {
	acceptedEvents    *prometheus.CounterVec
	rejectedEvents    *prometheus.CounterVec
	rejectedEnvelopes *prometheus.CounterVec
	envelopes         *prometheus.CounterVec
	kafkaDuration     prometheus.Observer
	acceptedBytes     prometheus.Counter
}

func NewMetrics(registerer interface {
	Register(...prometheus.Collector) error
}) (*Metrics, error) {
	acceptedEvents := prometheus.NewCounterVec(prometheus.CounterOpts{
		Namespace: "openrum", Subsystem: "ingest", Name: "accepted_events_total",
		Help: "Events durably accepted by event type.",
	}, []string{"event_type"})
	rejectedEvents := prometheus.NewCounterVec(prometheus.CounterOpts{
		Namespace: "openrum", Subsystem: "ingest", Name: "rejected_events_total",
		Help: "Events rejected by a bounded reason code.",
	}, []string{"reason"})
	rejectedEnvelopes := prometheus.NewCounterVec(prometheus.CounterOpts{
		Namespace: "openrum", Subsystem: "ingest", Name: "rejected_envelopes_total",
		Help: "Envelopes rejected before durable acceptance by a bounded reason code.",
	}, []string{"reason"})
	envelopes := prometheus.NewCounterVec(prometheus.CounterOpts{
		Namespace: "openrum", Subsystem: "ingest", Name: "envelopes_total",
		Help: "Ingest envelopes by durable acceptance outcome.",
	}, []string{"outcome"})
	kafkaDuration := prometheus.NewHistogram(prometheus.HistogramOpts{
		Namespace: "openrum", Subsystem: "ingest", Name: "kafka_ack_duration_seconds",
		Help:    "Time spent waiting for the Kafka durability acknowledgement.",
		Buckets: []float64{0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5},
	})
	acceptedBytes := prometheus.NewCounter(prometheus.CounterOpts{
		Namespace: "openrum", Subsystem: "ingest", Name: "accepted_bytes_total",
		Help: "Uncompressed envelope bytes durably accepted by Kafka.",
	})
	if err := registerer.Register(acceptedEvents, rejectedEvents, rejectedEnvelopes, envelopes, kafkaDuration, acceptedBytes); err != nil {
		return nil, err
	}
	return &Metrics{
		acceptedEvents:    acceptedEvents,
		rejectedEvents:    rejectedEvents,
		rejectedEnvelopes: rejectedEnvelopes,
		envelopes:         envelopes,
		kafkaDuration:     kafkaDuration,
		acceptedBytes:     acceptedBytes,
	}, nil
}

func (metrics *Metrics) observeAccepted(envelope AcceptedEnvelope, duration time.Duration) {
	metrics.kafkaDuration.Observe(duration.Seconds())
	metrics.acceptedBytes.Add(float64(len(envelope.Raw)))
	for _, current := range envelope.Envelope.Events {
		metrics.acceptedEvents.WithLabelValues(boundedEventType(current.Type)).Inc()
	}
	for _, rejection := range envelope.Rejected {
		metrics.rejectedEvents.WithLabelValues(boundedRejectReason(rejection.Code)).Inc()
	}
	outcome := "accepted"
	if len(envelope.Rejected) > 0 {
		outcome = "partial"
	}
	metrics.envelopes.WithLabelValues(outcome).Inc()
}

func (metrics *Metrics) observeRejectedOnly(rejections []Rejection) {
	for _, rejection := range rejections {
		metrics.rejectedEvents.WithLabelValues(boundedRejectReason(rejection.Code)).Inc()
	}
	metrics.envelopes.WithLabelValues("rejected").Inc()
	metrics.rejectedEnvelopes.WithLabelValues("INVALID_EVENT").Inc()
}

func (metrics *Metrics) observeUnavailable(duration time.Duration) {
	metrics.kafkaDuration.Observe(duration.Seconds())
	metrics.envelopes.WithLabelValues("unavailable").Inc()
	metrics.rejectedEnvelopes.WithLabelValues("INGEST_UNAVAILABLE").Inc()
}

func (metrics *Metrics) observeEnvelopeRejected(reason string) {
	metrics.envelopes.WithLabelValues("rejected").Inc()
	metrics.rejectedEnvelopes.WithLabelValues(boundedEnvelopeRejectReason(reason)).Inc()
}

func boundedEventType(value event.EventType) string {
	switch value {
	case event.EventTypePageView, event.EventTypeError, event.EventTypeWebVital, event.EventTypeAPI, event.EventTypeCustom:
		return string(value)
	default:
		return "unknown"
	}
}

func boundedRejectReason(value string) string {
	switch value {
	case "INVALID_EVENT":
		return value
	default:
		return "OTHER"
	}
}

func boundedEnvelopeRejectReason(value string) string {
	switch value {
	case "INVALID_KEY", "ORIGIN_REJECTED", "RATE_LIMITED", "PAYLOAD_TOO_LARGE",
		"UNSUPPORTED_ENCODING", "UNSUPPORTED_MEDIA_TYPE", "INVALID_COMPRESSION",
		"INVALID_BODY", "INVALID_ENVELOPE", "ENVIRONMENT_MISMATCH", "INGEST_UNAVAILABLE",
		"INVALID_EVENT":
		return value
	default:
		return "OTHER"
	}
}
