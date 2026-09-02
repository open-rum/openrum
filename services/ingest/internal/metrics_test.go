package ingestservice

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/prometheus/client_golang/prometheus"

	"openrum/internal/event"
)

func TestMetricsExposeOnlyBoundedLabels(t *testing.T) {
	registry := prometheus.NewRegistry()
	metrics, err := NewMetrics(prometheusRegisterer{registry})
	if err != nil {
		t.Fatal(err)
	}
	metrics.observeAccepted(AcceptedEnvelope{
		Raw: []byte("payload"),
		Envelope: event.EnvelopeV1{Events: []event.EventV1{
			{EventID: uuid.NewString(), Type: event.EventTypePageView},
			{EventID: uuid.NewString(), Type: event.EventType("attacker-controlled")},
		}},
		Rejected: []Rejection{{EventID: uuid.NewString(), Code: "ATTACKER_CONTROLLED"}},
	}, 20*time.Millisecond)
	metrics.observeEnvelopeRejected("attacker-envelope-reason")
	families, err := registry.Gather()
	if err != nil {
		t.Fatal(err)
	}
	labels := make(map[string]bool)
	for _, family := range families {
		for _, metric := range family.Metric {
			for _, label := range metric.Label {
				labels[label.GetValue()] = true
			}
		}
	}
	if !labels["page_view"] || !labels["unknown"] || !labels["OTHER"] || labels["attacker-controlled"] || labels["ATTACKER_CONTROLLED"] || labels["attacker-envelope-reason"] {
		t.Fatalf("labels=%v", labels)
	}
}

type prometheusRegisterer struct {
	*prometheus.Registry
}

func (registerer prometheusRegisterer) Register(collectors ...prometheus.Collector) error {
	for _, collector := range collectors {
		if err := registerer.Registry.Register(collector); err != nil {
			return err
		}
	}
	return nil
}
