package main

import (
	"math"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestRealisticDemoDatasetIsRichBoundedAndDeterministic(t *testing.T) {
	projectID := uuid.MustParse("11111111-1111-4111-8111-111111111111")
	now := time.Date(2026, 9, 3, 8, 0, 0, 0, time.UTC)
	events, mappings := buildRealisticDemoDataset(projectID, now, 1_000)
	again, _ := buildRealisticDemoDataset(projectID, now, 1_000)
	if len(events) < 15_000 || len(events) > 22_000 {
		t.Fatalf("unexpected event volume: %d", len(events))
	}
	if events[0].EventID != again[0].EventID || events[len(events)-1].EventID != again[len(again)-1].EventID {
		t.Fatal("dataset event identities are not deterministic")
	}
	types, countries, devices, browsers := map[string]int{}, map[string]int{}, map[string]int{}, map[string]int{}
	unique := make(map[uuid.UUID]struct{}, len(events))
	errorCount := 0
	for _, event := range events {
		if event.Timestamp.Before(now.Add(-14*24*time.Hour)) || event.Timestamp.After(now) {
			t.Fatalf("timestamp outside demo window: %s", event.Timestamp)
		}
		if event.Attributes["openrum_demo_version"] != realisticDemoVersion {
			t.Fatalf("missing dataset version on %s", event.EventID)
		}
		if _, exists := unique[event.EventID]; exists {
			t.Fatalf("duplicate event id: %s", event.EventID)
		}
		unique[event.EventID] = struct{}{}
		types[event.EventType]++
		countries[event.Country]++
		devices[event.DeviceType]++
		browsers[event.Browser]++
		if strings.HasPrefix(event.Route, "/products/") && event.Route != "/products/:id" {
			t.Fatalf("product route is not normalized: %s", event.Route)
		}
		if event.EventType == "error" {
			errorCount++
		}
	}
	for _, eventType := range []string{"page_view", "custom", "api", "web_vital", "error"} {
		if types[eventType] == 0 {
			t.Fatalf("missing event type %s", eventType)
		}
	}
	if len(countries) < 8 || len(devices) < 3 || len(browsers) < 4 {
		t.Fatalf("dimensions too narrow: countries=%d devices=%d browsers=%d", len(countries), len(devices), len(browsers))
	}
	if errorCount != len(mappings) || errorCount == 0 {
		t.Fatalf("errors=%d mappings=%d", errorCount, len(mappings))
	}
}

// The API workspace separates failures from client errors, ranks by quantiles
// with a sample threshold and reports response size independently of latency.
// The dataset has to exercise each of those to be worth browsing.
func TestRealisticDemoAPIEventsCoverTheWorkspaceDimensions(t *testing.T) {
	projectID := uuid.MustParse("11111111-1111-4111-8111-111111111111")
	now := time.Date(2026, 9, 3, 8, 0, 0, 0, time.UTC)
	events, _ := buildRealisticDemoDataset(projectID, now, 6_000)

	endpoints, methods, statuses := map[string]int{}, map[string]int{}, map[uint16]int{}
	allowedFailures := map[string]struct{}{"http": {}, "network": {}, "timeout": {}, "abort": {}}
	sizeByDuration := map[float64]map[uint64]struct{}{}
	for _, event := range events {
		if event.EventType != "api" {
			continue
		}
		endpoints[event.APIMethod+" "+event.APIURL]++
		methods[event.APIMethod]++
		statuses[event.APIStatus]++
		if event.APIFailure != "" {
			if _, ok := allowedFailures[event.APIFailure]; !ok {
				t.Fatalf("unknown failure %q on %s", event.APIFailure, event.APIURL)
			}
		}
		// The SDK flags only 5xx, so a 4xx must stay unflagged. Otherwise the
		// demo cannot show that client errors leave the failure rate alone.
		if event.APIStatus >= 400 && event.APIStatus < 500 && event.APIFailure != "" {
			t.Fatalf("4xx on %s carries failure %q", event.APIURL, event.APIFailure)
		}
		if event.APIStatus >= 500 && event.APIFailure != "http" {
			t.Fatalf("5xx on %s carries failure %q", event.APIURL, event.APIFailure)
		}
		if event.APIStatus >= 200 && event.APIStatus < 400 && event.TransferSize == 0 {
			t.Fatalf("successful %s reports no transfer size", event.APIURL)
		}
		if bucket := math.Round(event.DurationMS); event.TransferSize > 0 {
			if sizeByDuration[bucket] == nil {
				sizeByDuration[bucket] = map[uint64]struct{}{}
			}
			sizeByDuration[bucket][event.TransferSize] = struct{}{}
		}
	}

	if len(endpoints) < 25 {
		t.Fatalf("endpoint catalogue too small: %d", len(endpoints))
	}
	for _, method := range []string{"GET", "POST", "PATCH", "DELETE"} {
		if methods[method] == 0 {
			t.Fatalf("no %s requests", method)
		}
	}
	for _, status := range []uint16{200, 401, 403, 404, 429, 500, 502, 503, 504, 0} {
		if statuses[status] == 0 {
			t.Fatalf("status %d never generated", status)
		}
	}

	// Response size must not be a function of duration, or the payload panel
	// cannot tell a large response apart from a slow one.
	spread := 0
	for _, sizes := range sizeByDuration {
		if len(sizes) > 1 {
			spread++
		}
	}
	if spread == 0 {
		t.Fatal("transfer size is fully determined by duration")
	}

	// A sparse endpoint has to stay under the quantile sample threshold and a
	// hot one has to stay well above it, so the workspace has both to label.
	if count := endpoints["GET /api/admin/inventory/export"]; count == 0 || count >= 75 {
		t.Fatalf("sparse endpoint sample count=%d, want 1..74", count)
	}
	if endpoints["GET /api/products/:id"] < 75 {
		t.Fatalf("hot endpoint is below the sample threshold: %d", endpoints["GET /api/products/:id"])
	}
}

// The dimension drill-down and the release comparison only prove their worth
// when the data actually contains a regression to find.
func TestRealisticDemoAPIPlantsBrowserAndReleaseRegressions(t *testing.T) {
	projectID := uuid.MustParse("11111111-1111-4111-8111-111111111111")
	now := time.Date(2026, 9, 3, 8, 0, 0, 0, time.UTC)
	events, _ := buildRealisticDemoDataset(projectID, now, 6_000)

	var safariTotal, safariCount, otherTotal, otherCount float64
	regressedFailures, regressedTotal := 0, 0
	baselineFailures, baselineTotal := 0, 0
	for _, event := range events {
		switch {
		case event.EventType != "api":
			continue
		case event.APIURL == "/api/products/:id/recommendations":
			if event.Browser == "Safari" {
				safariTotal, safariCount = safariTotal+event.DurationMS, safariCount+1
			} else {
				otherTotal, otherCount = otherTotal+event.DurationMS, otherCount+1
			}
		case event.APIURL == "/api/payments/intent":
			failed := event.APIFailure != "" || event.APIStatus >= 500
			if event.Release == "web@2026.09.3" {
				regressedTotal++
				if failed {
					regressedFailures++
				}
			} else {
				baselineTotal++
				if failed {
					baselineFailures++
				}
			}
		}
	}

	if safariCount == 0 || otherCount == 0 {
		t.Fatalf("recommendation samples missing: safari=%v other=%v", safariCount, otherCount)
	}
	if safariMean, otherMean := safariTotal/safariCount, otherTotal/otherCount; safariMean < otherMean*1.5 {
		t.Fatalf("Safari regression too weak to notice: safari=%.0fms other=%.0fms", safariMean, otherMean)
	}
	if regressedTotal == 0 || baselineTotal == 0 {
		t.Fatalf("payment samples missing: regressed=%d baseline=%d", regressedTotal, baselineTotal)
	}
	regressedRate := float64(regressedFailures) / float64(regressedTotal)
	baselineRate := float64(baselineFailures) / float64(baselineTotal)
	if regressedRate < baselineRate*1.8 {
		t.Fatalf("release regression too weak: regressed=%.3f baseline=%.3f", regressedRate, baselineRate)
	}
}
