package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"math/rand"
	"time"

	"github.com/google/uuid"
)

const (
	realisticDemoVersion  = "4"
	realisticDemoSessions = 30_000
	// realisticDemoInsertBatch keeps one INSERT body to a size ClickHouse
	// accepts comfortably. The dataset is large enough that a single statement
	// would hold hundreds of megabytes of JSON in memory.
	realisticDemoInsertBatch = 40_000
)

var realisticDemoNamespace = uuid.MustParse("7d9d324d-38c4-4fba-b271-6c4c0f5169ec")

type realisticEventRow struct {
	ProjectID         uuid.UUID          `json:"project_id"`
	EventID           uuid.UUID          `json:"event_id"`
	EventType         string             `json:"event_type"`
	Timestamp         time.Time          `json:"timestamp"`
	ReceivedAt        time.Time          `json:"received_at"`
	Environment       string             `json:"environment"`
	Release           string             `json:"release"`
	Dist              string             `json:"dist"`
	SessionID         uuid.UUID          `json:"session_id"`
	AnonymousUserID   string             `json:"anonymous_user_id"`
	UserID            string             `json:"user_id"`
	PageID            uuid.UUID          `json:"page_id"`
	PageURL           string             `json:"page_url"`
	PageURLNormalized string             `json:"page_url_normalized"`
	Route             string             `json:"route"`
	Referrer          string             `json:"referrer"`
	Title             string             `json:"title"`
	NavigationType    string             `json:"navigation_type"`
	SDKName           string             `json:"sdk_name"`
	SDKVersion        string             `json:"sdk_version"`
	SchemaVersion     string             `json:"schema_version"`
	SampleRate        float64            `json:"sample_rate"`
	Browser           string             `json:"browser"`
	BrowserVersion    string             `json:"browser_version"`
	OS                string             `json:"os"`
	OSVersion         string             `json:"os_version"`
	DeviceType        string             `json:"device_type"`
	Country           string             `json:"country"`
	TraceID           string             `json:"trace_id"`
	SpanID            string             `json:"span_id"`
	ErrorType         string             `json:"error_type"`
	ErrorMessage      string             `json:"error_message"`
	ErrorStack        string             `json:"error_stack"`
	ErrorMechanism    string             `json:"error_mechanism"`
	Fingerprint       string             `json:"fingerprint"`
	FingerprintVer    uint16             `json:"fingerprint_version"`
	Handled           bool               `json:"handled"`
	APIMethod         string             `json:"api_method"`
	APIURL            string             `json:"api_url_normalized"`
	APIStatus         uint16             `json:"api_status"`
	APIFailure        string             `json:"api_failure"`
	DurationMS        float64            `json:"duration_ms"`
	TransferSize      uint64             `json:"transfer_size"`
	MetricName        string             `json:"metric_name"`
	MetricValue       float64            `json:"metric_value"`
	MetricDelta       float64            `json:"metric_delta"`
	MetricRating      string             `json:"metric_rating"`
	CustomName        string             `json:"custom_name"`
	Attributes        map[string]string  `json:"attributes"`
	Measurements      map[string]float64 `json:"measurements"`
	Breadcrumbs       []string           `json:"breadcrumbs"`
	IngestFlags       []string           `json:"ingest_flags"`
}

type realisticStackMapping struct {
	ProjectID uuid.UUID `json:"project_id"`
	EventID   uuid.UUID `json:"event_id"`
	Status    string    `json:"status"`
	Failure   string    `json:"failure_code"`
	Mapped    string    `json:"mapped_stack"`
	MappedAt  time.Time `json:"mapped_at"`
}

type visitorProfile struct {
	country, device, browser, browserVersion, operatingSystem, osVersion string
}

type errorProfile struct {
	errorType, message, fingerprint, source, function string
	line, column                                      int
}

func ensureRealisticDemoEvents(ctx context.Context, database *sql.DB, projectID uuid.UUID) error {
	var complete uint64
	if err := database.QueryRowContext(ctx, `SELECT count() FROM rum_events
		WHERE project_id=? AND attributes['openrum_demo_version']=? AND attributes['dataset_complete']='true'`,
		projectID, realisticDemoVersion).Scan(&complete); err != nil {
		return err
	}
	if complete > 0 {
		return nil
	}

	now := time.Now().UTC().Truncate(time.Minute)
	events, mappings := buildRealisticDemoDataset(projectID, now, realisticDemoSessions)
	if err := insertJSONEachRow(ctx, database, "event_stack_mappings", mappings); err != nil {
		return fmt.Errorf("insert realistic demo stack mappings: %w", err)
	}
	if err := insertJSONEachRow(ctx, database, "rum_events", events); err != nil {
		return fmt.Errorf("insert realistic demo events: %w", err)
	}
	fmt.Printf("realistic demo dataset: %d sessions, %d events, %d mapped errors\n", realisticDemoSessions, len(events), len(mappings))
	return nil
}

func buildRealisticDemoDataset(projectID uuid.UUID, now time.Time, sessionCount int) ([]realisticEventRow, []realisticStackMapping) {
	random := rand.New(rand.NewSource(20260903)) //nolint:gosec -- deterministic demo fixtures, not security material
	events := make([]realisticEventRow, 0, sessionCount*10)
	mappings := make([]realisticStackMapping, 0, sessionCount/40)
	dayWeights := make([]float64, 14)
	for dayAgo := range dayWeights {
		day := now.AddDate(0, 0, -dayAgo)
		weight := 1.18 - float64(dayAgo)*0.018
		if day.Weekday() == time.Saturday || day.Weekday() == time.Sunday {
			weight *= 0.72
		}
		dayWeights[dayAgo] = weight
	}
	hourWeights := []float64{0.18, 0.10, 0.07, 0.06, 0.08, 0.16, 0.42, 0.82, 1.35, 1.72, 1.95, 1.82, 1.38, 1.26, 1.48, 1.66, 1.72, 1.58, 1.44, 1.72, 1.98, 1.86, 1.12, 0.54}

	for sessionIndex := 0; sessionIndex < sessionCount; sessionIndex++ {
		dayAgo := chooseWeighted(random, dayWeights)
		latestStart := now.Add(-5 * time.Minute)
		if dayAgo == 0 && startOfUTCDay(latestStart).Before(startOfUTCDay(now)) {
			dayAgo = 1
		}
		availableHourWeights := hourWeights
		if dayAgo == 0 {
			availableHourWeights = append([]float64(nil), hourWeights...)
			for hourIndex := latestStart.Hour() + 1; hourIndex < len(availableHourWeights); hourIndex++ {
				availableHourWeights[hourIndex] = 0
			}
		}
		hour := chooseWeighted(random, availableHourWeights)
		minuteLimit := 60
		if dayAgo == 0 && hour == latestStart.Hour() {
			minuteLimit = latestStart.Minute() + 1
		}
		startedAt := startOfUTCDay(now.AddDate(0, 0, -dayAgo)).Add(time.Duration(hour)*time.Hour +
			time.Duration(random.Intn(minuteLimit))*time.Minute + time.Duration(random.Intn(60))*time.Second)
		if startedAt.After(latestStart) {
			startedAt = latestStart.Add(-time.Duration(random.Intn(60)) * time.Second)
		}
		sessionID := deterministicDemoUUID(sessionIndex, "session", 0)
		anonymousID := fmt.Sprintf("demo-v3-user-%05d", (sessionIndex*7919)%12_000)
		userID := ""
		if sessionIndex%100 < 38 {
			userID = fmt.Sprintf("member-%05d", (sessionIndex*3571)%4_800)
		}
		profile := pickVisitorProfile(random)
		referrer, channel, campaign := pickAcquisition(random)
		category := pickWeightedString(random, []weightedString{{"数码", 30}, {"家居", 24}, {"服饰", 21}, {"运动", 15}, {"美妆", 10}})
		memberTier := pickWeightedString(random, []weightedString{{"guest", 44}, {"standard", 34}, {"silver", 14}, {"gold", 8}})
		release := releaseForDay(dayAgo)
		sequence := 0
		pageID := deterministicDemoUUID(sessionIndex, "page", 0)
		baseAttributes := map[string]string{
			"openrum_demo_version": realisticDemoVersion,
			"dataset":              "commerce",
		}
		add := func(row realisticEventRow) uuid.UUID {
			sequence++
			row.ProjectID = projectID
			row.EventID = deterministicDemoUUID(sessionIndex, row.EventType+":"+row.CustomName+":"+row.MetricName, sequence)
			row.Timestamp = startedAt.Add(time.Duration(sequence*7+random.Intn(5)) * time.Second)
			row.ReceivedAt = row.Timestamp.Add(time.Duration(40+random.Intn(860)) * time.Millisecond)
			row.Environment = "production"
			row.Release = release
			row.Dist = "browser"
			row.SessionID = sessionID
			row.AnonymousUserID = anonymousID
			row.UserID = userID
			row.PageID = pageID
			row.SDKName = "@openrum/browser"
			row.SDKVersion = "0.2.0"
			row.SchemaVersion = "1"
			row.SampleRate = 1
			row.Browser = profile.browser
			row.BrowserVersion = profile.browserVersion
			row.OS = profile.operatingSystem
			row.OSVersion = profile.osVersion
			row.DeviceType = profile.device
			row.Country = profile.country
			if row.Attributes == nil {
				row.Attributes = cloneAttributes(baseAttributes)
			} else {
				for key, value := range baseAttributes {
					row.Attributes[key] = value
				}
			}
			if row.Measurements == nil {
				row.Measurements = map[string]float64{}
			}
			if row.Breadcrumbs == nil {
				row.Breadcrumbs = []string{}
			}
			if row.IngestFlags == nil {
				row.IngestFlags = []string{}
			}
			events = append(events, row)
			return row.EventID
		}

		landingRoute := "/"
		if channel == "search" || channel == "campaign" {
			landingRoute = "/category/" + categorySlug(category)
		}
		add(pageEvent(landingRoute, referrer, "navigate"))
		// Keep route cardinality bounded like a production router. The concrete
		// product identifier belongs in the URL/custom attributes, not the route.
		productRoute := "/products/:id"
		pageID = deterministicDemoUUID(sessionIndex, "page", 1)
		add(pageEvent(productRoute, "https://shop.demo"+landingRoute, "route_change"))
		customAttributes := map[string]string{"category": category, "channel": channel, "campaign": campaign, "member_tier": memberTier, "currency": "CNY"}
		add(customEvent(productRoute, "product_viewed", customAttributes))
		add(customEvent(productRoute, "ui.click", map[string]string{"target": "加入购物车", "category": category, "channel": channel}))
		productStatus, productFailure := apiOutcome(random, 0.012, 0.004, notFound)
		productAPI := apiEvent(productRoute, "GET", "/api/products/:id", productStatus, 95+math.Abs(random.NormFloat64()*85))
		productAPI.APIFailure = productFailure
		if productStatus >= 200 && productStatus < 400 {
			productAPI.TransferSize = responseBytes(random, 12_000, 3_500)
		}
		add(productAPI)

		apiRoutes := map[string]string{"landing": landingRoute, "product": productRoute, "checkout": "/checkout"}
		emitAPIEndpoints(random, apiBrowseEndpoints, apiRoutes, profile, release, func(row realisticEventRow) { add(row) })

		devicePenalty := 0.0
		if profile.device == "mobile" {
			devicePenalty = 620
		}
		if profile.browser == "Safari" {
			devicePenalty += 180
		}
		lcp := clamp(1450+devicePenalty+random.NormFloat64()*420, 520, 6100)
		inp := clamp(105+devicePenalty/8+random.NormFloat64()*55, 35, 980)
		cls := clamp(0.045+math.Abs(random.NormFloat64())*0.045+devicePenalty/15_000, 0.005, 0.62)
		add(vitalEvent(productRoute, "LCP", lcp, vitalRating("LCP", lcp)))
		add(vitalEvent(productRoute, "INP", inp, vitalRating("INP", inp)))
		add(vitalEvent(productRoute, "CLS", cls, vitalRating("CLS", cls)))

		addedToCart := random.Float64() < conversionProbability(0.64, profile, channel)
		startedCheckout := addedToCart && random.Float64() < conversionProbability(0.61, profile, channel)
		if addedToCart {
			add(customEvent(productRoute, "add_to_cart", customAttributes))
		}
		if startedCheckout {
			pageID = deterministicDemoUUID(sessionIndex, "page", 2)
			add(pageEvent("/checkout", "https://shop.demo"+productRoute, "route_change"))
			add(customEvent("/checkout", "checkout_started", customAttributes))
			emitAPIEndpoints(random, apiCheckoutEndpoints, apiRoutes, profile, release, func(row realisticEventRow) { add(row) })
			status, failure := apiOutcome(random, checkoutFailureRate(profile), 0.009, []weightedStatus{{409, 68}, {400, 32}})
			traceID := fmt.Sprintf("%032x", sessionIndex+1)
			api := apiEvent("/checkout", "POST", "/api/orders", status, 260+devicePenalty/3+math.Abs(random.NormFloat64()*330))
			api.APIFailure = failure
			api.TraceID = traceID
			api.SpanID = fmt.Sprintf("%016x", sessionIndex+1)
			if status >= 200 && status < 400 {
				api.TransferSize = responseBytes(random, 2_800, 820)
			}
			add(api)
			if status == 200 {
				add(customEvent("/checkout/success", "order_completed", customAttributes))
			} else {
				profile := errorProfile{"CheckoutError", "提交订单失败：库存服务暂时不可用", "v1:demo-v3-checkout", "src/checkout/submit.ts", "submitOrder", 42, 11}
				errorID := add(errorEvent("/checkout", profile, traceID, startedAt))
				mappings = append(mappings, stackMapping(projectID, errorID, profile, startedAt))
			}
		}

		if random.Float64() < 0.009 {
			profile := errorProfile{"TypeError", "Cannot read properties of undefined (reading 'price')", "v1:demo-v3-product-price", "src/product/price.ts", "formatPrice", 18, 23}
			errorID := add(errorEvent(productRoute, profile, "", startedAt))
			mappings = append(mappings, stackMapping(projectID, errorID, profile, startedAt))
		}
		if random.Float64() < 0.005 {
			profile := errorProfile{"ChunkLoadError", "Loading chunk checkout failed", "v1:demo-v3-chunk", "src/router/lazy.ts", "loadCheckout", 27, 9}
			errorID := add(errorEvent(productRoute, profile, "", startedAt))
			mappings = append(mappings, stackMapping(projectID, errorID, profile, startedAt))
		}
	}

	marker := realisticEventRow{
		ProjectID: projectID, EventID: uuid.NewSHA1(realisticDemoNamespace, []byte("dataset-complete-v4")),
		EventType: "custom", Timestamp: now.Add(-time.Second), ReceivedAt: now, Environment: "production",
		Release: "web@2026.09.3", SessionID: uuid.NewSHA1(realisticDemoNamespace, []byte("marker-session")),
		AnonymousUserID: "demo-dataset", PageID: uuid.NewSHA1(realisticDemoNamespace, []byte("marker-page")),
		PageURL: "https://shop.demo/", PageURLNormalized: "https://shop.demo/", Route: "/", SDKName: "@openrum/browser",
		SDKVersion: "0.2.0", SchemaVersion: "1", SampleRate: 1, Browser: "Chrome", BrowserVersion: "128",
		OS: "macOS", OSVersion: "15", DeviceType: "desktop", Country: "CN", CustomName: "demo_dataset_ready",
		Attributes:   map[string]string{"openrum_demo_version": realisticDemoVersion, "dataset": "commerce", "dataset_complete": "true"},
		Measurements: map[string]float64{}, Breadcrumbs: []string{}, IngestFlags: []string{"synthetic"},
	}
	events = append(events, marker)
	return events, mappings
}

func insertJSONEachRow[T any](ctx context.Context, database *sql.DB, table string, rows []T) error {
	for start := 0; start < len(rows); start += realisticDemoInsertBatch {
		end := min(start+realisticDemoInsertBatch, len(rows))
		var body bytes.Buffer
		for index := start; index < end; index++ {
			encoded, err := json.Marshal(rows[index])
			if err != nil {
				return err
			}
			body.Write(encoded)
			body.WriteByte('\n')
		}
		query := fmt.Sprintf("INSERT INTO %s SETTINGS insert_distributed_sync=1,date_time_input_format='best_effort' FORMAT JSONEachRow\n%s", table, body.String())
		if _, err := database.ExecContext(ctx, query); err != nil {
			return err
		}
	}
	return nil
}

func deterministicDemoUUID(sessionIndex int, kind string, sequence int) uuid.UUID {
	return uuid.NewSHA1(realisticDemoNamespace, []byte(fmt.Sprintf("v%s:%d:%s:%d", realisticDemoVersion, sessionIndex, kind, sequence)))
}

func pageEvent(route, referrer, navigation string) realisticEventRow {
	return realisticEventRow{EventType: "page_view", Route: route, PageURL: "https://shop.demo" + route,
		PageURLNormalized: "https://shop.demo" + route, Referrer: referrer, Title: titleForRoute(route), NavigationType: navigation}
}

func customEvent(route, name string, attributes map[string]string) realisticEventRow {
	return realisticEventRow{EventType: "custom", Route: route, PageURL: "https://shop.demo" + route,
		PageURLNormalized: "https://shop.demo" + route, Title: titleForRoute(route), CustomName: name, Attributes: cloneAttributes(attributes)}
}

// apiEvent leaves the failure flag and the transfer size to the caller. The SDK
// only flags status 500 and above, and response size is a property of the
// endpoint rather than of how long the call took.
func apiEvent(route, method, endpoint string, status uint16, duration float64) realisticEventRow {
	return realisticEventRow{EventType: "api", Route: route, PageURL: "https://shop.demo" + route,
		PageURLNormalized: "https://shop.demo" + route, APIMethod: method, APIURL: endpoint, APIStatus: status,
		DurationMS: duration}
}

func vitalEvent(route, name string, value float64, rating string) realisticEventRow {
	return realisticEventRow{EventType: "web_vital", Route: route, PageURL: "https://shop.demo" + route,
		PageURLNormalized: "https://shop.demo" + route, MetricName: name, MetricValue: value, MetricDelta: value,
		MetricRating: rating}
}

func errorEvent(route string, profile errorProfile, traceID string, startedAt time.Time) realisticEventRow {
	stack := fmt.Sprintf("%s: %s\n    at %s (https://shop.demo/assets/app.js:1:482)", profile.errorType, profile.message, profile.function)
	return realisticEventRow{EventType: "error", Route: route, PageURL: "https://shop.demo" + route,
		PageURLNormalized: "https://shop.demo" + route, ErrorType: profile.errorType, ErrorMessage: profile.message,
		ErrorStack: stack, ErrorMechanism: "onerror", Fingerprint: profile.fingerprint, FingerprintVer: 1,
		TraceID: traceID, Breadcrumbs: []string{
			breadcrumb("navigation", "进入商品详情", startedAt),
			breadcrumb("ui.click", "点击加入购物车", startedAt.Add(10*time.Second)),
			breadcrumb("http", "POST /api/orders", startedAt.Add(20*time.Second)),
		}}
}

func stackMapping(projectID, eventID uuid.UUID, profile errorProfile, at time.Time) realisticStackMapping {
	raw := fmt.Sprintf("at %s (https://shop.demo/assets/app.js:1:482)", profile.function)
	mapped := map[string]any{"raw": raw, "status": "mapped", "frames": []any{map[string]any{
		"function": profile.function, "url": "https://shop.demo/assets/app.js", "line": 1, "column": 482,
		"original": map[string]any{"source": profile.source, "function": profile.function, "line": profile.line, "column": profile.column},
	}}}
	contents, _ := json.Marshal(mapped)
	return realisticStackMapping{ProjectID: projectID, EventID: eventID, Status: "mapped", Mapped: string(contents), MappedAt: at}
}

func breadcrumb(category, message string, at time.Time) string {
	contents, _ := json.Marshal(map[string]any{"category": category, "message": message, "timestamp": at.Format(time.RFC3339Nano)})
	return string(contents)
}

type weightedString struct {
	value  string
	weight float64
}

func pickVisitorProfile(random *rand.Rand) visitorProfile {
	country := pickWeightedString(random, []weightedString{{"CN", 45}, {"US", 15}, {"JP", 10}, {"SG", 8}, {"DE", 6}, {"GB", 5}, {"AU", 4}, {"IN", 4}, {"BR", 3}})
	device := pickWeightedString(random, []weightedString{{"mobile", 63}, {"desktop", 35}, {"tablet", 2}})
	if device == "mobile" || device == "tablet" {
		browser := pickWeightedString(random, []weightedString{{"Chrome", 55}, {"Safari", 39}, {"Firefox", 4}, {"Edge", 2}})
		if browser == "Safari" {
			return visitorProfile{country, device, browser, "18", "iOS", "18"}
		}
		return visitorProfile{country, device, browser, "128", "Android", "15"}
	}
	browser := pickWeightedString(random, []weightedString{{"Chrome", 67}, {"Edge", 17}, {"Safari", 10}, {"Firefox", 6}})
	if browser == "Safari" {
		return visitorProfile{country, device, browser, "18", "macOS", "15"}
	}
	os := pickWeightedString(random, []weightedString{{"Windows", 64}, {"macOS", 30}, {"Linux", 6}})
	return visitorProfile{country, device, browser, "128", os, map[string]string{"Windows": "11", "macOS": "15", "Linux": "6.8"}[os]}
}

func pickAcquisition(random *rand.Rand) (referrer, channel, campaign string) {
	choice := pickWeightedString(random, []weightedString{{"direct", 34}, {"search", 33}, {"social", 14}, {"campaign", 13}, {"partner", 6}})
	switch choice {
	case "search":
		return pickWeightedString(random, []weightedString{{"https://www.baidu.com/", 58}, {"https://www.google.com/", 42}}), choice, "organic"
	case "social":
		return "https://weixin.qq.com/", choice, "social-autumn"
	case "campaign":
		return "https://campaign.example/", choice, pickWeightedString(random, []weightedString{{"autumn-sale", 55}, {"new-user", 30}, {"member-day", 15}})
	case "partner":
		return "https://partner.example/", choice, "affiliate"
	default:
		return "", choice, "none"
	}
}

func chooseWeighted(random *rand.Rand, weights []float64) int {
	total := 0.0
	for _, weight := range weights {
		total += weight
	}
	target := random.Float64() * total
	for index, weight := range weights {
		target -= weight
		if target <= 0 {
			return index
		}
	}
	return len(weights) - 1
}

func pickWeightedString(random *rand.Rand, values []weightedString) string {
	weights := make([]float64, len(values))
	for index := range values {
		weights[index] = values[index].weight
	}
	return values[chooseWeighted(random, weights)].value
}

// apiEndpointProfile describes one backend endpoint the storefront talks to.
// Latency, payload size and the error mix are per endpoint on purpose: a single
// shared distribution makes response size a function of duration, which hides
// the difference between an endpoint that is slow because its payload is huge
// and one that is slow because the call is failing.
type apiEndpointProfile struct {
	method, url string
	// routeKey attributes the call to a page the session actually visited.
	routeKey string
	// calls is the expected number of calls per eligible session. Values below
	// one act as a probability, which is how the long tail stays sparse enough
	// to fall under the quantile sample threshold.
	calls                  float64
	baseMS, spreadMS       float64
	baseBytes, spreadBytes float64
	// serverRate covers 5xx and transport failures, the outcomes the SDK flags.
	serverRate float64
	// clientRate covers 4xx, which the SDK deliberately does not flag. These
	// requests raise the client-error count without moving the failure rate.
	clientRate     float64
	clientStatuses []weightedStatus
	// safariPenaltyMS and the regressed release fields plant the regressions the
	// dimension drill-down exists to surface.
	safariPenaltyMS  float64
	regressedRelease string
	regressedRate    float64
}

type weightedStatus struct {
	status uint16
	weight float64
}

var (
	unauthorized = []weightedStatus{{401, 76}, {403, 24}}
	notFound     = []weightedStatus{{404, 100}}

	// apiBrowseEndpoints fire while the visitor browses.
	apiBrowseEndpoints = []apiEndpointProfile{
		{method: "GET", url: "/api/config/feature-flags", routeKey: "landing", calls: 0.95,
			baseMS: 28, spreadMS: 12, baseBytes: 420, spreadBytes: 120, serverRate: 0.001},
		{method: "GET", url: "/api/categories", routeKey: "landing", calls: 0.38,
			baseMS: 70, spreadMS: 28, baseBytes: 5_200, spreadBytes: 900, serverRate: 0.004},
		{method: "GET", url: "/api/search", routeKey: "landing", calls: 0.33,
			baseMS: 320, spreadMS: 240, baseBytes: 46_000, spreadBytes: 18_000, serverRate: 0.014},
		{method: "POST", url: "/api/auth/login", routeKey: "landing", calls: 0.16,
			baseMS: 240, spreadMS: 110, baseBytes: 1_100, spreadBytes: 240,
			serverRate: 0.006, clientRate: 0.14, clientStatuses: unauthorized},
		{method: "POST", url: "/api/auth/refresh", routeKey: "landing", calls: 0.44,
			baseMS: 96, spreadMS: 45, baseBytes: 900, spreadBytes: 180,
			serverRate: 0.003, clientRate: 0.05, clientStatuses: unauthorized},
		{method: "POST", url: "/api/auth/logout", routeKey: "landing", calls: 0.05,
			baseMS: 88, spreadMS: 30, baseBytes: 180, spreadBytes: 40},
		{method: "GET", url: "/api/users/me", routeKey: "landing", calls: 0.42,
			baseMS: 90, spreadMS: 42, baseBytes: 1_800, spreadBytes: 400,
			serverRate: 0.005, clientRate: 0.06, clientStatuses: unauthorized},
		{method: "PATCH", url: "/api/users/me", routeKey: "landing", calls: 0.03,
			baseMS: 165, spreadMS: 70, baseBytes: 1_850, spreadBytes: 420, serverRate: 0.007},
		{method: "GET", url: "/api/products/:id/recommendations", routeKey: "product", calls: 0.72,
			baseMS: 180, spreadMS: 120, baseBytes: 28_000, spreadBytes: 9_000,
			serverRate: 0.008, safariPenaltyMS: 900},
		{method: "GET", url: "/api/products/:id/reviews", routeKey: "product", calls: 0.41,
			baseMS: 140, spreadMS: 90, baseBytes: 34_000, spreadBytes: 12_000, serverRate: 0.006},
		{method: "GET", url: "/api/inventory/:id", routeKey: "product", calls: 0.66,
			baseMS: 62, spreadMS: 30, baseBytes: 260, spreadBytes: 60, serverRate: 0.01},
		{method: "GET", url: "/api/cart", routeKey: "product", calls: 0.58,
			baseMS: 84, spreadMS: 40, baseBytes: 3_400, spreadBytes: 1_100, serverRate: 0.009},
		{method: "POST", url: "/api/cart/items", routeKey: "product", calls: 0.34,
			baseMS: 150, spreadMS: 80, baseBytes: 3_600, spreadBytes: 1_200,
			serverRate: 0.013, clientRate: 0.006, clientStatuses: []weightedStatus{{409, 100}}},
		{method: "PATCH", url: "/api/cart/items/:id", routeKey: "product", calls: 0.09,
			baseMS: 130, spreadMS: 60, baseBytes: 3_500, spreadBytes: 1_100, serverRate: 0.011},
		{method: "DELETE", url: "/api/cart/items/:id", routeKey: "product", calls: 0.07,
			baseMS: 118, spreadMS: 55, baseBytes: 240, spreadBytes: 70, serverRate: 0.009},
		{method: "POST", url: "/api/analytics/collect", routeKey: "product", calls: 0.7,
			baseMS: 34, spreadMS: 14, baseBytes: 120, spreadBytes: 30, serverRate: 0.002},
		{method: "GET", url: "/api/orders", routeKey: "landing", calls: 0.07,
			baseMS: 210, spreadMS: 95, baseBytes: 18_000, spreadBytes: 5_000, serverRate: 0.008},
		{method: "GET", url: "/api/notifications", routeKey: "landing", calls: 0.05,
			baseMS: 92, spreadMS: 40, baseBytes: 2_100, spreadBytes: 600, serverRate: 0.006},
		{method: "GET", url: "/api/wishlist", routeKey: "landing", calls: 0.04,
			baseMS: 88, spreadMS: 36, baseBytes: 2_600, spreadBytes: 800, serverRate: 0.005},
		{method: "POST", url: "/api/wishlist/items", routeKey: "landing", calls: 0.02,
			baseMS: 128, spreadMS: 55, baseBytes: 2_650, spreadBytes: 820, serverRate: 0.006},
		// Back-office endpoints stay deliberately sparse so the workspace has
		// endpoints below the quantile sample threshold to label.
		{method: "GET", url: "/api/admin/reports/sales", routeKey: "landing", calls: 0.0018,
			baseMS: 2_400, spreadMS: 900, baseBytes: 240_000, spreadBytes: 80_000, serverRate: 0.05},
		{method: "GET", url: "/api/admin/inventory/export", routeKey: "landing", calls: 0.0012,
			baseMS: 4_200, spreadMS: 1_600, baseBytes: 900_000, spreadBytes: 300_000, serverRate: 0.08},
		{method: "POST", url: "/api/support/tickets", routeKey: "landing", calls: 0.0016,
			baseMS: 320, spreadMS: 140, baseBytes: 780, spreadBytes: 200, serverRate: 0.02},
	}

	// apiCheckoutEndpoints fire only once a session reaches checkout, which is
	// what makes their volume much lower than the browse path without making
	// their samples too sparse to rank.
	apiCheckoutEndpoints = []apiEndpointProfile{
		{method: "GET", url: "/api/users/me/addresses", routeKey: "checkout", calls: 0.92,
			baseMS: 110, spreadMS: 50, baseBytes: 2_400, spreadBytes: 700, serverRate: 0.007},
		{method: "GET", url: "/api/shipping/quotes", routeKey: "checkout", calls: 0.88,
			baseMS: 480, spreadMS: 320, baseBytes: 6_800, spreadBytes: 2_100, serverRate: 0.02},
		{method: "GET", url: "/api/coupons/:code", routeKey: "checkout", calls: 0.31,
			baseMS: 105, spreadMS: 48, baseBytes: 380, spreadBytes: 90,
			serverRate: 0.005, clientRate: 0.22, clientStatuses: notFound},
		{method: "POST", url: "/api/coupons/validate", routeKey: "checkout", calls: 0.24,
			baseMS: 140, spreadMS: 60, baseBytes: 420, spreadBytes: 100,
			serverRate: 0.006, clientRate: 0.18, clientStatuses: []weightedStatus{{400, 62}, {404, 38}}},
		{method: "POST", url: "/api/payments/intent", routeKey: "checkout", calls: 0.95,
			baseMS: 620, spreadMS: 380, baseBytes: 1_400, spreadBytes: 300, serverRate: 0.035,
			regressedRelease: "web@2026.09.3", regressedRate: 0.09},
		{method: "GET", url: "/api/payments/:id/status", routeKey: "checkout", calls: 0.9,
			baseMS: 180, spreadMS: 90, baseBytes: 620, spreadBytes: 140, serverRate: 0.012},
		{method: "GET", url: "/api/orders/:id", routeKey: "checkout", calls: 0.62,
			baseMS: 150, spreadMS: 70, baseBytes: 8_400, spreadBytes: 2_200, serverRate: 0.009},
	}
)

// apiOutcome mirrors the browser SDK, which flags a request as an "http"
// failure only at status 500 and above. A 4xx therefore stays unflagged and
// lands in the client-error count without inflating the failure rate.
func apiOutcome(random *rand.Rand, serverRate, clientRate float64, clientStatuses []weightedStatus) (uint16, string) {
	if roll := random.Float64(); roll < serverRate {
		switch choice := random.Float64(); {
		case choice < 0.16:
			return 0, "network"
		case choice < 0.26:
			return 0, "timeout"
		case choice < 0.30:
			return 0, "abort"
		case choice < 0.62:
			return 503, "http"
		case choice < 0.82:
			return 502, "http"
		case choice < 0.94:
			return 500, "http"
		default:
			return 504, "http"
		}
	}
	if clientRate > 0 && random.Float64() < clientRate {
		if len(clientStatuses) == 0 {
			return 400, ""
		}
		weights := make([]float64, len(clientStatuses))
		for index := range clientStatuses {
			weights[index] = clientStatuses[index].weight
		}
		return clientStatuses[chooseWeighted(random, weights)].status, ""
	}
	if random.Float64() < 0.004 {
		return 429, ""
	}
	return 200, ""
}

// emitAPIEndpoints plays one endpoint group for a session.
func emitAPIEndpoints(random *rand.Rand, profiles []apiEndpointProfile, routes map[string]string,
	visitor visitorProfile, release string, emit func(realisticEventRow)) {
	for _, profile := range profiles {
		for call := 0; call < plannedAPICalls(random, profile.calls); call++ {
			serverRate := profile.serverRate
			if profile.regressedRelease != "" && profile.regressedRelease == release {
				serverRate += profile.regressedRate
			}
			status, failure := apiOutcome(random, serverRate, profile.clientRate, profile.clientStatuses)
			duration := profile.baseMS + math.Abs(random.NormFloat64()*profile.spreadMS)
			if visitor.device == "mobile" {
				duration *= 1.35
			}
			if visitor.browser == "Safari" {
				duration += profile.safariPenaltyMS
			}
			// A timed-out request reports the client's own deadline rather than
			// server time, so these cluster near the limit with some jitter
			// instead of landing on one flat value.
			if failure == "timeout" {
				duration = 9_600 + math.Abs(random.NormFloat64()*1_400)
			}
			row := apiEvent(routes[profile.routeKey], profile.method, profile.url, status, duration)
			row.APIFailure = failure
			// Failed responses carry no body worth reporting.
			if status >= 200 && status < 400 {
				row.TransferSize = responseBytes(random, profile.baseBytes, profile.spreadBytes)
			}
			emit(row)
		}
	}
}

// responseBytes keeps a body from shrinking to nothing on the low tail. A
// served JSON response always has a payload, and a zero would read as a
// missing measurement rather than a small one.
func responseBytes(random *rand.Rand, base, spread float64) uint64 {
	return uint64(math.Max(base*0.15, base+random.NormFloat64()*spread))
}

// plannedAPICalls turns an expected call count into a whole number of calls,
// treating the fractional part as a probability so sparse endpoints stay sparse.
func plannedAPICalls(random *rand.Rand, expected float64) int {
	calls := int(expected)
	if remainder := expected - float64(calls); remainder > 0 && random.Float64() < remainder {
		calls++
	}
	return calls
}

func checkoutFailureRate(profile visitorProfile) float64 {
	rate := 0.045
	if profile.device == "mobile" {
		rate += 0.018
	}
	if profile.browser == "Safari" {
		rate += 0.012
	}
	return rate
}

func conversionProbability(base float64, profile visitorProfile, channel string) float64 {
	if profile.device == "mobile" {
		base -= 0.045
	}
	if channel == "campaign" {
		base += 0.055
	}
	if channel == "social" {
		base -= 0.035
	}
	return clamp(base, 0.05, 0.95)
}

func vitalRating(name string, value float64) string {
	switch name {
	case "LCP":
		if value <= 2500 {
			return "good"
		}
		if value <= 4000 {
			return "needs-improvement"
		}
	case "INP":
		if value <= 200 {
			return "good"
		}
		if value <= 500 {
			return "needs-improvement"
		}
	case "CLS":
		if value <= 0.1 {
			return "good"
		}
		if value <= 0.25 {
			return "needs-improvement"
		}
	}
	return "poor"
}

func releaseForDay(dayAgo int) string {
	if dayAgo <= 2 {
		return "web@2026.09.3"
	}
	if dayAgo <= 7 {
		return "web@2026.08.28"
	}
	return "web@2026.08.20"
}

func titleForRoute(route string) string {
	if route == "/" {
		return "OpenRUM Demo Store"
	}
	if len(route) >= len("/checkout") && route[:len("/checkout")] == "/checkout" {
		return "结算"
	}
	if len(route) >= len("/category/") && route[:len("/category/")] == "/category/" {
		return "商品分类"
	}
	return "商品详情"
}

func categorySlug(category string) string {
	return map[string]string{"数码": "digital", "家居": "home", "服饰": "fashion", "运动": "sports", "美妆": "beauty"}[category]
}

func cloneAttributes(source map[string]string) map[string]string {
	result := make(map[string]string, len(source)+2)
	for key, value := range source {
		result[key] = value
	}
	return result
}

func startOfUTCDay(value time.Time) time.Time {
	return time.Date(value.Year(), value.Month(), value.Day(), 0, 0, 0, 0, time.UTC)
}

func clamp(value, minimum, maximum float64) float64 {
	return math.Min(maximum, math.Max(minimum, value))
}
