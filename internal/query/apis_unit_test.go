package query

import (
	"database/sql"
	"encoding/json"
	"math"
	"testing"
	"time"

	"github.com/google/uuid"
)

// Merging a quantile state over a range with no rows yields NaN, which would
// abort JSON encoding halfway and hand the client a truncated response.
func TestNullableFloatDropsValuesJSONCannotEncode(t *testing.T) {
	for _, value := range []float64{math.NaN(), math.Inf(1), math.Inf(-1)} {
		if result := nullableFloat(sql.NullFloat64{Float64: value, Valid: true}); result != nil {
			t.Fatalf("nullableFloat(%v)=%v, want nil", value, *result)
		}
	}
	if result := nullableFloat(sql.NullFloat64{Float64: 0, Valid: true}); result == nil || *result != 0 {
		t.Fatalf("nullableFloat(0)=%v, want 0", result)
	}
	summary := APISummary{P50: nullableFloat(sql.NullFloat64{Float64: math.NaN(), Valid: true})}
	if _, err := json.Marshal(summary); err != nil {
		t.Fatalf("marshal summary from an empty range: %v", err)
	}
}

func TestNormalizeAPIFiltersSanitizesURLAndRequiresEndpointPair(t *testing.T) {
	from := time.Date(2026, 9, 3, 0, 0, 0, 0, time.UTC)
	filters, err := NormalizeAPIFilters(APIFilters{
		ProjectID: uuid.New(), From: from, To: from.Add(time.Hour), Method: " post ",
		URL: "https://user:secret@api.example/orders/42?token=secret#fragment", Sort: "p95",
	})
	if err != nil || filters.Method != "POST" || filters.URL != "https://api.example/orders/42" {
		t.Fatalf("filters=%+v err=%v", filters, err)
	}
	if _, err := NormalizeAPIFilters(APIFilters{ProjectID: uuid.New(), From: from, To: from.Add(time.Hour), Method: "GET"}); err == nil {
		t.Fatal("unpaired method was accepted")
	}
	if _, err := NormalizeAPIFilters(APIFilters{ProjectID: uuid.New(), From: from, To: from.Add(31 * 24 * time.Hour)}); err == nil {
		t.Fatal("31-day query was accepted")
	}
}

func TestScanAPIEndpointMarksQuantilesBelowTheSampleThreshold(t *testing.T) {
	for _, testCase := range []struct {
		requests   uint64
		sufficient bool
	}{{minimumAPISamples - 1, false}, {minimumAPISamples, true}} {
		endpoint, err := scanAPIEndpoint(stubEndpointScanner{requests: testCase.requests})
		if err != nil {
			t.Fatal(err)
		}
		if endpoint.Sufficient != testCase.sufficient {
			t.Fatalf("requests=%d sufficient=%v want %v", testCase.requests, endpoint.Sufficient, testCase.sufficient)
		}
		if endpoint.URL != "https://api.example/orders" {
			t.Fatalf("url=%q", endpoint.URL)
		}
	}
}

func TestLatencyBucketsCoverEveryDurationExactlyOnce(t *testing.T) {
	expression := latencyBucketExpression()
	want := "multiIf(duration_ms<100,0,duration_ms<300,100,duration_ms<500,300,duration_ms<1000,500,duration_ms<3000,1000,3000)"
	if expression != want {
		t.Fatalf("expression=%q", expression)
	}
	seen := map[float64]bool{}
	for _, lower := range append([]float64{0}, apiLatencyEdges...) {
		if seen[lower] {
			t.Fatalf("duplicate bucket lower bound %g", lower)
		}
		seen[lower] = true
		upper := latencyBucketUpperBound(lower)
		if lower == apiLatencyEdges[len(apiLatencyEdges)-1] {
			if upper != nil {
				t.Fatalf("slowest bucket is bounded at %g", *upper)
			}
			continue
		}
		if upper == nil || *upper <= lower {
			t.Fatalf("bucket %g has upper bound %v", lower, upper)
		}
	}
}

type stubEndpointScanner struct{ requests uint64 }

func (scanner stubEndpointScanner) Scan(destinations ...any) error {
	*destinations[0].(*string) = "GET"
	*destinations[1].(*string) = "https://api.example/orders?token=secret"
	*destinations[2].(*uint64) = scanner.requests
	*destinations[3].(*float64) = float64(scanner.requests) * 5
	for _, index := range []int{4, 5, 6, 7} {
		*destinations[index].(*uint64) = 0
	}
	for _, index := range []int{8, 9, 10} {
		*destinations[index].(*sql.NullFloat64) = sql.NullFloat64{Float64: 120, Valid: true}
	}
	return nil
}

func TestSanitizeAPIURLNeverReturnsCredentialsQueryOrFragment(t *testing.T) {
	value := sanitizeAPIURL("https://alice:password@example.com/orders?card=4111#secret")
	if value != "https://example.com/orders" {
		t.Fatalf("sanitized=%q", value)
	}
}
