package query

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestNormalizePerformanceFilters(t *testing.T) {
	from := time.Date(2026, 9, 1, 0, 0, 0, 0, time.FixedZone("Asia/Shanghai", 8*60*60))
	filters, err := NormalizePerformanceFilters(PerformanceFilters{ProjectID: uuid.New(), From: from, To: from.Add(24 * time.Hour), Metric: "inp", Route: " /checkout ", Country: " cn ", DeviceType: " MOBILE ", Percentile: " P95 "})
	if err != nil || filters.Metric != "INP" || filters.Route != "/checkout" || filters.From.Location() != time.UTC {
		t.Fatalf("filters=%+v err=%v", filters, err)
	}
	if filters.Country != "CN" || filters.DeviceType != "mobile" || filters.Percentile != "p95" {
		t.Fatalf("dimensions=%+v", filters)
	}
	for _, invalid := range []PerformanceFilters{
		{ProjectID: uuid.Nil, From: from, To: from.Add(time.Hour)},
		{ProjectID: uuid.New(), From: from, To: from.Add(31 * 24 * time.Hour)},
		{ProjectID: uuid.New(), From: from, To: from.Add(time.Hour), Metric: "FID"},
		{ProjectID: uuid.New(), From: from, To: from.Add(time.Hour), Route: "/bad\nroute"},
		{ProjectID: uuid.New(), From: from, To: from.Add(time.Hour), Percentile: "p95); DROP TABLE rum_events"},
		{ProjectID: uuid.New(), From: from, To: from.Add(time.Hour), Country: "China"},
		{ProjectID: uuid.New(), From: from, To: from.Add(time.Hour), Browser: "Chr\nome"},
	} {
		if _, err := NormalizePerformanceFilters(invalid); err == nil {
			t.Fatalf("invalid filters accepted: %+v", invalid)
		}
	}
}

func TestPerformanceIntervalsAndLowSampleLabel(t *testing.T) {
	if performanceInterval(6*time.Hour) != "1 MINUTE" || performanceInterval(7*time.Hour) != "15 MINUTE" || performanceInterval(3*24*time.Hour) != "1 HOUR" || performanceInterval(20*24*time.Hour) != "6 HOUR" {
		t.Fatal("unexpected performance interval")
	}
	value := finalizeMetric(1250, 74)
	if value.P75 == nil || value.Sufficient {
		t.Fatalf("low sample metric=%+v", value)
	}
	if !finalizeMetric(1250, 75).Sufficient {
		t.Fatal("75 samples should be sufficient")
	}
}

func TestAuxiliaryPerformanceMetrics(t *testing.T) {
	from := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	for _, name := range []string{"FCP", "TTFB"} {
		filters, err := NormalizePerformanceFilters(PerformanceFilters{ProjectID: uuid.New(), From: from, To: from.Add(time.Hour), Metric: name})
		if err != nil || filters.Metric != name {
			t.Fatalf("metric %s: %+v %v", name, filters, err)
		}
		if got := performanceMetricPredicate(name); got != "event_type='web_vital' AND metric_name='"+name+"' AND isFinite(metric_value) AND metric_value>=0" {
			t.Fatalf("predicate for %s: %s", name, got)
		}
	}
}
