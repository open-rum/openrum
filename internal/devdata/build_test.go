package devdata

import (
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"testing"
	"time"

	"openrum/internal/event"
)

func testWindow() (time.Time, time.Time) {
	to := time.Date(2026, 9, 5, 12, 0, 0, 0, time.UTC)
	return to.Add(-24 * time.Hour), to
}

// Every generated envelope has to pass the same schema the ingest endpoint
// applies. Without this the generator could produce data that only fails once
// it is already halfway through a manual test.
func TestBuildProducesEnvelopesTheProtocolSchemaAccepts(t *testing.T) {
	from, to := testWindow()
	for _, preset := range Presets() {
		t.Run(preset.ID, func(t *testing.T) {
			scenario := PresetScenario(preset.ID, from, to)
			scenario.Environment = "production"
			scenario.BaseURL = "https://shop.example.com"
			scenario.Sessions = 25

			batches, summary, err := Build(scenario)
			if err != nil {
				t.Fatalf("build: %v", err)
			}
			if len(batches) == 0 || summary.Events == 0 {
				t.Fatalf("batches=%d summary=%+v", len(batches), summary)
			}
			for index, batch := range batches {
				if len(batch.Envelope.Events) > MaxEventsPerEnvelope {
					t.Fatalf("batch %d carries %d events, over the protocol limit", index, len(batch.Envelope.Events))
				}
				if batch.UserAgent == "" {
					t.Fatalf("batch %d has no user agent, so browser and device would be unknown", index)
				}
				encoded, marshalErr := json.Marshal(batch.Envelope)
				if marshalErr != nil {
					t.Fatalf("batch %d marshal: %v", index, marshalErr)
				}
				if validateErr := event.ValidateEnvelopeV1(encoded); validateErr != nil {
					t.Fatalf("batch %d rejected by the protocol schema: %v\n%s", index, validateErr, encoded)
				}
			}
		})
	}
}

func TestBuildIsDeterministicForASeed(t *testing.T) {
	from, to := testWindow()
	scenario := PresetScenario("storefront", from, to)
	scenario.Environment = "production"
	scenario.BaseURL = "https://shop.example.com"
	scenario.Sessions = 40
	scenario.Seed = 99

	first, firstSummary, err := Build(scenario)
	if err != nil {
		t.Fatalf("first build: %v", err)
	}
	second, secondSummary, err := Build(scenario)
	if err != nil {
		t.Fatalf("second build: %v", err)
	}
	if firstSummary.Events != secondSummary.Events || len(first) != len(second) {
		t.Fatalf("summaries diverged: %+v vs %+v", firstSummary, secondSummary)
	}
	// Identifiers are random per run by design, so the comparison covers the
	// measured shape: which client, which endpoint, which latency.
	for index := range first {
		if first[index].UserAgent != second[index].UserAgent || first[index].Country != second[index].Country {
			t.Fatalf("batch %d client diverged", index)
		}
		for eventIndex, current := range first[index].Envelope.Events {
			other := second[index].Envelope.Events[eventIndex]
			if current.Type != other.Type {
				t.Fatalf("batch %d event %d type diverged", index, eventIndex)
			}
			if current.Request != nil && describeRequest(current.Request) != describeRequest(other.Request) {
				t.Fatalf("batch %d event %d request diverged:\n%s\n%s",
					index, eventIndex, describeRequest(current.Request), describeRequest(other.Request))
			}
		}
	}
}

func TestBuildClassifiesFailuresTheWayTheBrowserSDKDoes(t *testing.T) {
	batches := buildSurface(t, 400)
	sawClientError, sawServerError, sawTransportFailure := false, false, false
	for _, batch := range batches {
		for _, current := range batch.Envelope.Events {
			if current.Request == nil {
				continue
			}
			request := current.Request
			switch {
			case request.Status != nil && *request.Status >= 400 && *request.Status < 500:
				sawClientError = true
				// A 4xx is a deliberate answer, not a failed request. Flagging
				// it would inflate every failure rate on the dashboard.
				if request.Failure != "" {
					t.Fatalf("status %d carries failure %q", *request.Status, request.Failure)
				}
			case request.Status != nil && *request.Status >= 500:
				sawServerError = true
				if request.Failure != "http" {
					t.Fatalf("status %d carries failure %q, want http", *request.Status, request.Failure)
				}
			case request.Failure != "":
				sawTransportFailure = true
				// A transport failure never produced a response, so it must not
				// claim a status or a body size.
				if request.Status != nil && *request.Status != 0 {
					t.Fatalf("failure %q carries status %d", request.Failure, *request.Status)
				}
				if request.TransferSize != nil {
					t.Fatalf("failure %q carries a transfer size", request.Failure)
				}
			}
		}
	}
	if !sawClientError || !sawServerError || !sawTransportFailure {
		t.Fatalf("client=%v server=%v transport=%v, want every kind represented", sawClientError, sawServerError, sawTransportFailure)
	}
}

func TestBuildReportsSizeIndependentlyOfLatency(t *testing.T) {
	batches := buildSurface(t, 300)
	samples := make([]sample, 0, 512)
	for _, batch := range batches {
		for _, current := range batch.Envelope.Events {
			if current.Request == nil || current.Request.TransferSize == nil {
				continue
			}
			samples = append(samples, sample{duration: current.Request.DurationMS, size: float64(*current.Request.TransferSize)})
			if *current.Request.TransferSize <= 0 {
				t.Fatal("a delivered response reported zero bytes")
			}
		}
	}
	if len(samples) < 100 {
		t.Fatalf("only %d sized responses, too few to judge", len(samples))
	}
	// If size were derived from latency the two would correlate almost
	// perfectly, and any "slow because large" investigation would be circular.
	if correlation := pearson(samples); correlation > 0.5 {
		t.Fatalf("duration and size correlate at %.2f, want them drawn independently", correlation)
	}
}

func TestBuildPlantsTheBrowserAndReleaseRegressions(t *testing.T) {
	batches := buildSurface(t, 900)

	safari, other := newLatency(), newLatency()
	failedByRelease, totalByRelease := map[string]int{}, map[string]int{}
	for _, batch := range batches {
		release := batch.Envelope.Context.Release
		for _, current := range batch.Envelope.Events {
			if current.Request == nil {
				continue
			}
			if strings.HasSuffix(current.Request.URL, "/recommendations") {
				if batch.UserAgent != "" && strings.Contains(batch.UserAgent, "Safari/605") {
					safari.add(current.Request.DurationMS)
				} else {
					other.add(current.Request.DurationMS)
				}
			}
			if strings.HasSuffix(current.Request.URL, "/api/payments/intent") {
				totalByRelease[release]++
				if current.Request.Failure != "" {
					failedByRelease[release]++
				}
			}
		}
	}
	if safari.count < 20 || other.count < 20 {
		t.Fatalf("recommendation samples: safari=%d other=%d", safari.count, other.count)
	}
	if safari.mean() < other.mean()*2 {
		t.Fatalf("safari mean %.0fms vs %.0fms, want the planted regression to stand out", safari.mean(), other.mean())
	}

	regressed := failureRate(failedByRelease["web@2026.09.3"], totalByRelease["web@2026.09.3"])
	baseline := failureRate(failedByRelease["web@2026.09.2"], totalByRelease["web@2026.09.2"])
	if totalByRelease["web@2026.09.3"] < 20 || totalByRelease["web@2026.09.2"] < 20 {
		t.Fatalf("payment samples per release: %+v", totalByRelease)
	}
	if regressed < baseline*3 {
		t.Fatalf("regressed release fails at %.3f vs baseline %.3f, want a clear regression", regressed, baseline)
	}
}

func TestVitalRatingsFollowTheDocumentedThresholds(t *testing.T) {
	for _, testCase := range []struct {
		name  string
		value float64
		want  string
	}{
		{name: "LCP", value: 2_500, want: "good"},
		{name: "LCP", value: 2_501, want: "needs-improvement"},
		{name: "LCP", value: 4_001, want: "poor"},
		{name: "CLS", value: 0.1, want: "good"},
		{name: "CLS", value: 0.26, want: "poor"},
		{name: "INP", value: 200, want: "good"},
		{name: "TTFB", value: 1_801, want: "poor"},
		{name: "FCP", value: 1_800, want: "good"},
	} {
		if got := vitalRating(testCase.name, testCase.value); got != testCase.want {
			t.Fatalf("vitalRating(%s, %v)=%q, want %q", testCase.name, testCase.value, got, testCase.want)
		}
	}
}

func TestParseOutcomeSeparatesClientErrorsFromFailures(t *testing.T) {
	for candidate, want := range map[string]outcome{
		"200":       {status: 200},
		"204":       {status: 204},
		"401":       {status: 401},
		"429":       {status: 429},
		"500":       {status: 500, failure: "http"},
		"503":       {status: 503, failure: "http"},
		"0:network": {status: 0, failure: "network"},
		"0:timeout": {status: 0, failure: "timeout"},
		"0:abort":   {status: 0, failure: "abort"},
		// A transport failure cannot also have delivered a status.
		"200:network": {status: 0, failure: "network"},
	} {
		if got := parseOutcome(candidate); got != want {
			t.Fatalf("parseOutcome(%q)=%+v, want %+v", candidate, got, want)
		}
	}
}

func TestValidateReportsEveryProblemAtOnce(t *testing.T) {
	scenario := Scenario{
		Sessions: 0, Environment: "", BaseURL: "shop.example.com",
		Journeys: []Journey{{Name: "bad", Pages: []Page{{
			Path: "products", APIs: []API{{Method: "FETCH", Path: "api/x"}}, Vitals: []Vital{{Name: "TBT"}},
		}}}},
	}
	err := scenario.Validate()
	if err == nil {
		t.Fatal("an invalid scenario was accepted")
	}
	for _, fragment := range []string{"sessions", "environment", "baseUrl", "client", "path must start with /", "FETCH", "TBT", "to must be after from"} {
		if !strings.Contains(err.Error(), fragment) {
			t.Fatalf("error %q does not mention %q", err.Error(), fragment)
		}
	}
}

func TestValidateRejectsSessionCountsBeyondTheCap(t *testing.T) {
	from, to := testWindow()
	scenario := PresetScenario("storefront", from, to)
	scenario.Environment = "production"
	scenario.BaseURL = "https://shop.example.com"
	scenario.Sessions = MaxSessions + 1
	if err := scenario.Validate(); err == nil {
		t.Fatal("a session count over the cap was accepted")
	}
}

func buildSurface(t *testing.T, sessions int) []Batch {
	t.Helper()
	from, to := testWindow()
	scenario := PresetScenario("api-surface", from, to)
	scenario.Environment = "production"
	scenario.BaseURL = "https://shop.example.com"
	scenario.Sessions = sessions
	scenario.Seed = 7
	batches, _, err := Build(scenario)
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	return batches
}

type latency struct {
	count int
	total float64
}

func newLatency() *latency { return &latency{} }

func (accumulator *latency) add(value float64) {
	accumulator.count++
	accumulator.total += value
}

func (accumulator *latency) mean() float64 {
	if accumulator.count == 0 {
		return 0
	}
	return accumulator.total / float64(accumulator.count)
}

func failureRate(failed, total int) float64 {
	if total == 0 {
		return 0
	}
	return float64(failed) / float64(total)
}

// describeRequest renders the values behind the optional fields, because
// comparing APIRequest directly would compare pointer addresses.
func describeRequest(request *event.APIRequest) string {
	if request == nil {
		return "<nil>"
	}
	status, size := -1, int64(-1)
	if request.Status != nil {
		status = *request.Status
	}
	if request.TransferSize != nil {
		size = *request.TransferSize
	}
	return fmt.Sprintf("%s %s status=%d duration=%.1f size=%d failure=%s",
		request.Method, request.URL, status, request.DurationMS, size, request.Failure)
}

type sample struct{ duration, size float64 }

func pearson(samples []sample) float64 {
	count := float64(len(samples))
	sumX, sumY := 0.0, 0.0
	for _, sample := range samples {
		sumX += sample.duration
		sumY += sample.size
	}
	meanX, meanY := sumX/count, sumY/count
	covariance, varianceX, varianceY := 0.0, 0.0, 0.0
	for _, sample := range samples {
		deltaX, deltaY := sample.duration-meanX, sample.size-meanY
		covariance += deltaX * deltaY
		varianceX += deltaX * deltaX
		varianceY += deltaY * deltaY
	}
	if varianceX == 0 || varianceY == 0 {
		return 0
	}
	return covariance / math.Sqrt(varianceX*varianceY)
}
