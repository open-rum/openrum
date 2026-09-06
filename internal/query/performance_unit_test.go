package query

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestNormalizePerformanceFilters(t *testing.T) {
	from := time.Date(2026, 9, 1, 0, 0, 0, 0, time.FixedZone("Asia/Shanghai", 8*60*60))
	filters, err := NormalizePerformanceFilters(PerformanceFilters{ProjectID: uuid.New(), From: from, To: from.Add(24 * time.Hour), Metric: "inp", Route: " /checkout "})
	if err != nil || filters.Metric != "INP" || filters.Route != "/checkout" || filters.From.Location() != time.UTC {
		t.Fatalf("filters=%+v err=%v", filters, err)
	}
	for _, invalid := range []PerformanceFilters{
		{ProjectID: uuid.Nil, From: from, To: from.Add(time.Hour)},
		{ProjectID: uuid.New(), From: from, To: from.Add(31 * 24 * time.Hour)},
		{ProjectID: uuid.New(), From: from, To: from.Add(time.Hour), Metric: "FID"},
		{ProjectID: uuid.New(), From: from, To: from.Add(time.Hour), Route: "/bad\nroute"},
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
