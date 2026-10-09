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
	"math"
	"net/url"
	"openrum/internal/event"
	"strings"
	"time"
	"unicode/utf8"
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
	// Users makes visitors return across sessions and lets a share sign in with a
	// business user ID. Nil keeps one anonymous visitor per session.
	Users *UserPool `json:"users,omitempty"`
	// Referrers set the first page's referrer per session; an empty value is direct
	// traffic. The pipeline derives the traffic source from the referrer's domain.
	Referrers []Weight `json:"referrers,omitempty"`
	// DailyRhythm weights session start times by local hour so trends have a day and
	// night shape. Nil spreads sessions evenly.
	DailyRhythm *DailyRhythm `json:"dailyRhythm,omitempty"`
	// Incidents raise error and server-failure odds inside part of the window, the
	// way a bad deploy or an upstream outage shows up in real traffic.
	Incidents []Incident `json:"incidents,omitempty"`
}

// UserPool describes who the sessions belong to.
type UserPool struct {
	// Visitors is the number of distinct browsers; sessions reuse them, so a
	// smaller pool means more returning visitors. Zero means one per session.
	Visitors int `json:"visitors"`
	// SignedIn is the share of visitors who are signed in, between 0 and 1.
	SignedIn float64 `json:"signedIn"`
	// IDs are the business user IDs given to signed-in visitors, reused in order
	// when there are more signed-in visitors than IDs. Empty generates IDs from Prefix.
	IDs []string `json:"ids,omitempty"`
	// Prefix starts generated user IDs, for example "cust_" gives cust_10001.
	Prefix string `json:"prefix,omitempty"`
}

// DailyRhythm is a 24-hour activity curve in one time zone.
type DailyRhythm struct {
	TimeZone string `json:"timeZone"`
	// Hourly holds 24 relative weights, hour 0 first.
	Hourly []float64 `json:"hourly"`
}

// Incident is a stretch of the window, given as fractions from 0 (From) to 1 (To),
// where errors and failing API responses become more likely.
type Incident struct {
	Start             float64 `json:"start"`
	End               float64 `json:"end"`
	ErrorMultiplier   float64 `json:"errorMultiplier"`
	FailureMultiplier float64 `json:"failureMultiplier"`
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
	Route string `json:"route"`
	Path  string `json:"path"`
	// Paths are alternative concrete paths for the same route, one drawn per visit,
	// so a route aggregates several real URLs. Empty uses Path.
	Paths []string `json:"paths,omitempty"`
	Title string   `json:"title"`
	// Exit is the probability the session ends after this page, which is how a
	// funnel loses visitors step by step. Zero always continues.
	Exit   float64 `json:"exit,omitempty"`
	Clicks []Click `json:"clicks,omitempty"`
	Vitals []Vital `json:"vitals"`
	APIs   []API   `json:"apis"`
	Errors []Error `json:"errors"`
	Custom []Event `json:"custom"`
	Logs   []Log   `json:"logs,omitempty"`
}

type Log struct {
	Level      string            `json:"level"`
	Message    string            `json:"message"`
	Logger     string            `json:"logger,omitempty"`
	Attributes map[string]string `json:"attributes,omitempty"`
	Odds       float64           `json:"odds"`
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
	// MeasurementRanges draw a value per event, such as a varying order amount.
	MeasurementRanges map[string]Range `json:"measurementRanges,omitempty"`
}

// Click is an automatic SDK click behavior event (ui.click) on a named element.
type Click struct {
	Name    string  `json:"name"`
	Element string  `json:"element"`
	Role    string  `json:"role,omitempty"`
	Odds    float64 `json:"odds"`
}

// Range is an inclusive draw interval. Min equal to Max makes a constant.
type Range struct {
	Min float64 `json:"min"`
	Max float64 `json:"max"`
	// Skew bends the draw towards Min: 0 or 1 is uniform, 2 makes most values fast
	// with a long slow tail, the shape real timings and Web Vitals have.
	Skew float64 `json:"skew,omitempty"`
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
	problems = append(problems, scenario.validateTraffic()...)
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
		for _, path := range page.Paths {
			if !strings.HasPrefix(path, "/") {
				problems = append(problems, fmt.Errorf("%s.paths must start with /", label))
				break
			}
		}
		if math.IsNaN(page.Exit) || page.Exit < 0 || page.Exit > 1 {
			problems = append(problems, fmt.Errorf("%s.exit must be between 0 and 1", label))
		}
		for _, click := range page.Clicks {
			if strings.TrimSpace(click.Name) == "" || !allowedClickElements[strings.ToLower(click.Element)] {
				problems = append(problems, fmt.Errorf("%s.clicks need a name and an element of a, button, input, select, textarea, summary or custom", label))
				break
			}
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
		if len(page.Logs) > 100 {
			problems = append(problems, fmt.Errorf("%s.logs allows at most 100 templates", label))
		}
		for _, log := range page.Logs {
			if !event.ValidLogLevel(log.Level) || strings.TrimSpace(log.Message) == "" || utf8.RuneCountInString(log.Message) > 4096 || utf8.RuneCountInString(log.Logger) > 80 || math.IsNaN(log.Odds) || log.Odds < 0 || log.Odds > 1 || len(log.Attributes) > 20 {
				problems = append(problems, fmt.Errorf("%s.logs has an invalid level, message, attributes or probability", label))
			}
			for key, value := range log.Attributes {
				if len(key) == 0 || utf8.RuneCountInString(key) > 64 || utf8.RuneCountInString(value) > 512 {
					problems = append(problems, fmt.Errorf("%s.logs has an oversized attribute", label))
				}
			}
		}
	}
	return problems
}

func (scenario *Scenario) validateTraffic() []error {
	problems := make([]error, 0)
	if users := scenario.Users; users != nil {
		if users.Visitors < 0 || math.IsNaN(users.SignedIn) || users.SignedIn < 0 || users.SignedIn > 1 {
			problems = append(problems, errors.New("users.visitors must not be negative and users.signedIn must be between 0 and 1"))
		}
		if len(users.IDs) > MaxSessions || utf8.RuneCountInString(users.Prefix) > 32 {
			problems = append(problems, fmt.Errorf("users allows at most %d IDs and a prefix of 32 characters", MaxSessions))
		}
		for _, id := range users.IDs {
			if strings.TrimSpace(id) == "" || utf8.RuneCountInString(id) > 128 {
				problems = append(problems, errors.New("users.ids must be non-empty and at most 128 characters"))
				break
			}
		}
	}
	for index, referrer := range scenario.Referrers {
		if referrer.Value == "" {
			continue
		}
		if parsed, err := url.Parse(referrer.Value); err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
			problems = append(problems, fmt.Errorf("referrers[%d] must be an absolute http(s) URL or empty for direct traffic", index))
		}
	}
	if rhythm := scenario.DailyRhythm; rhythm != nil {
		if _, err := time.LoadLocation(rhythm.TimeZone); err != nil || len(rhythm.Hourly) != 24 {
			problems = append(problems, errors.New("dailyRhythm needs a valid timeZone and 24 hourly weights"))
		}
		positive := false
		for _, weight := range rhythm.Hourly {
			if math.IsNaN(weight) || weight < 0 {
				problems = append(problems, errors.New("dailyRhythm.hourly weights must not be negative"))
				break
			}
			positive = positive || weight > 0
		}
		if !positive {
			problems = append(problems, errors.New("dailyRhythm.hourly needs at least one positive weight"))
		}
	}
	for index, incident := range scenario.Incidents {
		if incident.Start < 0 || incident.End > 1 || incident.End <= incident.Start || incident.ErrorMultiplier < 0 || incident.FailureMultiplier < 0 {
			problems = append(problems, fmt.Errorf("incidents[%d] needs 0 <= start < end <= 1 and non-negative multipliers", index))
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

var allowedClickElements = map[string]bool{
	"a": true, "button": true, "input": true, "select": true, "textarea": true, "summary": true, "custom": true,
}
