package consumerservice

import (
	"time"

	"github.com/prometheus/client_golang/prometheus"

	"openrum/internal/event"
)

type Metrics struct {
	messages       *prometheus.CounterVec
	events         *prometheus.CounterVec
	deadLetters    *prometheus.CounterVec
	kafkaLag       prometheus.Gauge
	dataFreshness  prometheus.Gauge
	processingTime prometheus.Histogram
	insertBatches  *prometheus.CounterVec
	insertRows     prometheus.Histogram
	insertDuration prometheus.Histogram
}

func NewMetrics(registerer interface {
	Register(...prometheus.Collector) error
}) (*Metrics, error) {
	messages := prometheus.NewCounterVec(prometheus.CounterOpts{
		Namespace: "openrum", Subsystem: "consumer", Name: "messages_total", Help: "Kafka messages by processing outcome.",
	}, []string{"outcome"})
	events := prometheus.NewCounterVec(prometheus.CounterOpts{
		Namespace: "openrum", Subsystem: "consumer", Name: "events_total", Help: "Canonical events by bounded event type.",
	}, []string{"event_type"})
	deadLetters := prometheus.NewCounterVec(prometheus.CounterOpts{
		Namespace: "openrum", Subsystem: "consumer", Name: "dead_letters_total", Help: "Dead letters by bounded reason.",
	}, []string{"reason"})
	kafkaLag := prometheus.NewGauge(prometheus.GaugeOpts{
		Namespace: "openrum", Subsystem: "consumer", Name: "kafka_lag_seconds", Help: "Age of the latest fetched Kafka message.",
	})
	dataFreshness := prometheus.NewGauge(prometheus.GaugeOpts{
		Namespace: "openrum", Subsystem: "consumer", Name: "data_freshness_seconds", Help: "Age of the newest event durably written to ClickHouse.",
	})
	processingTime := prometheus.NewHistogram(prometheus.HistogramOpts{
		Namespace: "openrum", Subsystem: "consumer", Name: "message_duration_seconds", Help: "End-to-end processing time for one Kafka message.",
		Buckets: prometheus.DefBuckets,
	})
	insertBatches := prometheus.NewCounterVec(prometheus.CounterOpts{
		Namespace: "openrum", Subsystem: "consumer", Name: "clickhouse_batches_total", Help: "ClickHouse insert batches by outcome.",
	}, []string{"outcome"})
	insertRows := prometheus.NewHistogram(prometheus.HistogramOpts{
		Namespace: "openrum", Subsystem: "consumer", Name: "clickhouse_batch_rows", Help: "Rows per ClickHouse insert batch.",
		Buckets: []float64{1, 5, 10, 25, 50, 100, 250, 500, 1_000},
	})
	insertDuration := prometheus.NewHistogram(prometheus.HistogramOpts{
		Namespace: "openrum", Subsystem: "consumer", Name: "clickhouse_insert_duration_seconds", Help: "ClickHouse insert duration including retry.",
		Buckets: []float64{0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5},
	})
	if err := registerer.Register(messages, events, deadLetters, kafkaLag, dataFreshness, processingTime, insertBatches, insertRows, insertDuration); err != nil {
		return nil, err
	}
	return &Metrics{
		messages: messages, events: events, deadLetters: deadLetters, kafkaLag: kafkaLag, dataFreshness: dataFreshness,
		processingTime: processingTime, insertBatches: insertBatches, insertRows: insertRows, insertDuration: insertDuration,
	}, nil
}

func (metrics *Metrics) observeFetched(messageTime time.Time) {
	if !messageTime.IsZero() {
		metrics.kafkaLag.Set(max(0, time.Since(messageTime).Seconds()))
	}
}

func (metrics *Metrics) observeProcessed(events []event.CanonicalEvent, deadLetters []DeadLetter, started time.Time) {
	metrics.messages.WithLabelValues("committed").Inc()
	metrics.processingTime.Observe(time.Since(started).Seconds())
	newest := time.Time{}
	for _, current := range events {
		metrics.events.WithLabelValues(boundedCanonicalEventType(current.EventType)).Inc()
		if current.ReceivedAt.After(newest) {
			newest = current.ReceivedAt
		}
	}
	if !newest.IsZero() {
		metrics.dataFreshness.Set(max(0, time.Since(newest).Seconds()))
	}
	for _, letter := range deadLetters {
		metrics.deadLetters.WithLabelValues(boundedReason(letter.Reason)).Inc()
	}
}

func (metrics *Metrics) observeRetry() { metrics.messages.WithLabelValues("retry").Inc() }

func (metrics *Metrics) ObserveClickHouseBatch(rows int, duration time.Duration, err error) {
	outcome := "success"
	if err != nil {
		outcome = "error"
	}
	metrics.insertBatches.WithLabelValues(outcome).Inc()
	metrics.insertRows.Observe(float64(rows))
	metrics.insertDuration.Observe(duration.Seconds())
}

func boundedCanonicalEventType(value event.EventType) string {
	switch value {
	case event.EventTypePageView, event.EventTypeError, event.EventTypeWebVital, event.EventTypeAPI, event.EventTypeCustom:
		return string(value)
	default:
		return "unknown"
	}
}
