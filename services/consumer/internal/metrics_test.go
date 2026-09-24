package consumerservice

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/prometheus/client_golang/prometheus"

	"openrum/internal/event"
)

func TestConsumerMetricsUseBoundedLabelsAndExposeFreshness(t *testing.T) {
	registry := prometheus.NewRegistry()
	metrics, err := NewMetrics(collectorRegisterer{registry}, 7*24*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	metrics.observeFetched(now.Add(-2 * time.Second))
	metrics.observeProcessed([]event.CanonicalEvent{
		{EventID: uuid.New(), EventType: event.EventTypePageView, ReceivedAt: now.Add(-time.Second)},
		{EventID: uuid.New(), EventType: event.EventType("attacker-controlled"), ReceivedAt: now},
	}, []DeadLetter{{Reason: "attacker-controlled"}}, now.Add(-10*time.Millisecond))
	metrics.ObserveClickHouseBatch(2, 5*time.Millisecond, nil)
	families, err := registry.Gather()
	if err != nil {
		t.Fatal(err)
	}
	labels := map[string]bool{}
	names := map[string]bool{}
	for _, family := range families {
		names[family.GetName()] = true
		for _, metric := range family.Metric {
			for _, label := range metric.Label {
				labels[label.GetValue()] = true
			}
		}
	}
	if !names["openrum_consumer_kafka_lag_seconds"] || !names["openrum_consumer_kafka_retention_headroom_seconds"] || !names["openrum_consumer_data_freshness_seconds"] {
		t.Fatalf("metric names=%v", names)
	}
	if !labels["page_view"] || !labels["unknown"] || !labels["OTHER"] || labels["attacker-controlled"] {
		t.Fatalf("labels=%v", labels)
	}
}

type collectorRegisterer struct{ *prometheus.Registry }

func (registerer collectorRegisterer) Register(collectors ...prometheus.Collector) error {
	for _, collector := range collectors {
		if err := registerer.Registry.Register(collector); err != nil {
			return err
		}
	}
	return nil
}
