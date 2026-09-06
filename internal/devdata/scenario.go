// Package devdata synthesizes protocol-valid event envelopes for local
// development.
//
// The output is deliberately expressed as EnvelopeV1 batches rather than
// ClickHouse rows. Sending them through the real ingest endpoint means the data
// under inspection has passed the same validation, URL normalization,
// fingerprinting and aggregation as production traffic, so a query that looks
// right against this data is right.
package devdata

import (
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"
)

// Scenario is the declarative description of a dataset. Every field that
// influences randomness is captured here, so a Seed plus a Scenario always
// reproduces the same events.
type Scenario struct {
	Seed int64 `json:"seed"`
	// Environment must match the project's environment or ingest rejects the
	// envelope. Callers that leave it empty get it filled from the project.
	Environment string `json:"environment"`
	// BaseURL is the site origin page URLs are built on. It has to be an origin
	// the project allows, because ingest enforces its CORS allowlist.
	BaseURL  string    `json:"baseUrl"`
	Sessions int       `json:"sessions"`
	From     time.Time `json:"from"`
	To       time.Time `json:"to"`
	Releases []Weight  `json:"releases"`
	Clients  []Client  `json:"clients"`
	Journeys []Journey `json:"journeys"`
}

// Weight gives a value a relative share of the sessions. Weights need no
// particular scale; they are summed and compared against a draw.
type Weight struct {
	Value  string `json:"value"`
	Weight int    `json:"weight"`
}

// Client is a device the pipeline can only learn about from request headers.
// Browser, OS and device type come from parsing UserAgent; Country comes from
// the trusted country header. Nothing here travels inside the envelope.
type Client struct {
	Name      string `json:"name"`
	UserAgent string `json:"userAgent"`
	Country   string `json:"country"`
	Weight    int    `json:"weight"`
}

// Journey is one plausible path through the product, visited by a share of
// sessions proportional to its weight.
type Journey struct {
	Name   string `json:"name"`
	Weight int    `json:"weight"`
	Pages  []Page `json:"pages"`
}

// Page is a single page view plus everything recorded while it was open.
type Page struct {
	// Route is the normalized template, for example /products/:id. Path is the
	// concrete URL path. Keeping both lets a scenario exercise the difference
	// between a raw URL and its route.
	Route  string  `json:"route"`
	Path   string  `json:"path"`
	Title  string  `json:"title"`
	Vitals []Vital `json:"vitals"`
	APIs   []API   `json:"apis"`
	Errors []Error `json:"errors"`
	Custom []Event `json:"custom"`
}

// Vital is a Web Vital sample. The rating is derived from the value using the
// documented thresholds, so a scenario cannot state a value and a rating that
// contradict each other.
type Vital struct {
	Name  string  `json:"name"`
	Value Range   `json:"value"`
	Odds  float64 `json:"odds"`
}

// API is a request issued from the page. Latency and size are drawn
// independently, because in real traffic a slow request is not necessarily a
// large one and conflating them hides regressions.
type API struct {
	Method       string   `json:"method"`
	Path         string   `json:"path"`
	Odds         float64  `json:"odds"`
	Repeat       Range    `json:"repeat"`
	LatencyMS    Range    `json:"latencyMs"`
	TransferSize Range    `json:"transferSize"`
	Outcomes     []Weight `json:"outcomes"`
	// SlowClients multiplies latency for the named clients, which is how a
	// browser-specific regression is planted.
	SlowClients map[string]float64 `json:"slowClients"`
	// FailingReleases replaces the outcome mix for the named releases, which is
	// how a release-specific regression is planted.
	FailingReleases map[string][]Weight `json:"failingReleases"`
}

// Error is an exception recorded on the page.
type Error struct {
	Name      string  `json:"name"`
	Message   string  `json:"message"`
	Stack     string  `json:"stack"`
	Mechanism string  `json:"mechanism"`
	Handled   bool    `json:"handled"`
	Odds      float64 `json:"odds"`
}

// Event is a custom event, including the behavioural events the funnels are
// built from.
type Event struct {
	Name         string             `json:"name"`
	Odds         float64            `json:"odds"`
	Attributes   map[string]string  `json:"attributes"`
	Measurements map[string]float64 `json:"measurements"`
}

// Range is an inclusive draw interval. Min equal to Max makes a constant.
type Range struct {
	Min float64 `json:"min"`
	Max float64 `json:"max"`
}

// MaxSessions caps a single request. The generator holds every envelope in
// memory before sending, and a dev box should not be asked to buffer more than
// a few minutes of work.
const MaxSessions = 5_000

// MaxEventsPerEnvelope mirrors the protocol limit; the builder chunks pages
// that record more events than this.
const MaxEventsPerEnvelope = 100

// Validate reports every problem it can find at once, because this scenario
// usually arrives as hand-edited JSON and fixing one error at a time is slow.
func (scenario *Scenario) Validate() error {
	problems := make([]error, 0)
	if scenario.Sessions <= 0 || scenario.Sessions > MaxSessions {
		problems = append(problems, fmt.Errorf("sessions must be between 1 and %d, got %d", MaxSessions, scenario.Sessions))
	}
	if strings.TrimSpace(scenario.Environment) == "" {
		problems = append(problems, errors.New("environment is required"))
	}
	if err := validateBaseURL(scenario.BaseURL); err != nil {
		problems = append(problems, err)
	}
	if !scenario.To.After(scenario.From) {
		problems = append(problems, errors.New("to must be after from"))
	}
	if len(scenario.Clients) == 0 {
		problems = append(problems, errors.New("at least one client is required"))
	}
	for index, client := range scenario.Clients {
		if strings.TrimSpace(client.UserAgent) == "" {
			problems = append(problems, fmt.Errorf("clients[%d].userAgent is required", index))
		}
		if client.Weight < 0 {
			problems = append(problems, fmt.Errorf("clients[%d].weight must not be negative", index))
		}
	}
	if len(scenario.Journeys) == 0 {
		problems = append(problems, errors.New("at least one journey is required"))
	}
	for index, journey := range scenario.Journeys {
		problems = append(problems, journey.validate(index)...)
	}
	return errors.Join(problems...)
}

func (journey *Journey) validate(index int) []error {
	problems := make([]error, 0)
	if len(journey.Pages) == 0 {
		problems = append(problems, fmt.Errorf("journeys[%d] needs at least one page", index))
	}
	if journey.Weight < 0 {
		problems = append(problems, fmt.Errorf("journeys[%d].weight must not be negative", index))
	}
	for pageIndex, page := range journey.Pages {
		label := fmt.Sprintf("journeys[%d].pages[%d]", index, pageIndex)
		if !strings.HasPrefix(page.Path, "/") {
			problems = append(problems, fmt.Errorf("%s.path must start with /", label))
		}
		for apiIndex, api := range page.APIs {
			if !strings.HasPrefix(api.Path, "/") {
				problems = append(problems, fmt.Errorf("%s.apis[%d].path must start with /", label, apiIndex))
			}
			if !supportedMethods[api.Method] {
				problems = append(problems, fmt.Errorf("%s.apis[%d].method %q is not in the protocol", label, apiIndex, api.Method))
			}
		}
		for vitalIndex, vital := range page.Vitals {
			if !supportedVitals[vital.Name] {
				problems = append(problems, fmt.Errorf("%s.vitals[%d].name %q is not in the protocol", label, vitalIndex, vital.Name))
			}
		}
	}
	return problems
}

func validateBaseURL(candidate string) error {
	if strings.TrimSpace(candidate) == "" {
		return errors.New("baseUrl is required")
	}
	parsed, err := url.Parse(candidate)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return fmt.Errorf("baseUrl must be an absolute http(s) origin, got %q", candidate)
	}
	if parsed.Path != "" && parsed.Path != "/" {
		return fmt.Errorf("baseUrl must not carry a path, got %q", candidate)
	}
	return nil
}

var supportedMethods = map[string]bool{
	"GET": true, "POST": true, "PUT": true, "PATCH": true, "DELETE": true, "HEAD": true, "OPTIONS": true,
}

var supportedVitals = map[string]bool{"LCP": true, "INP": true, "CLS": true, "FCP": true, "TTFB": true}
