package devdata

import "time"

// Preset is a named starting point. Presets exist so the common case — "give me
// something to look at on this page" — needs no scenario authoring, while the
// full Scenario stays available for a specific reproduction.
type Preset struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

// Presets lists every preset, in the order a UI should offer them.
func Presets() []Preset {
	return []Preset{
		{ID: "storefront", Name: "Storefront browsing and checkout",
			Description: "A broad mix across browse and checkout: page views, vitals, a wide API surface, errors and funnel events."},
		{ID: "api-surface", Name: "Wide API surface",
			Description: "Many endpoints, methods and status codes, including a browser regression and a release regression."},
		{ID: "failing-release", Name: "Failing release",
			Description: "One release fails checkout far more often than its predecessor, for testing release comparisons."},
		{ID: "web-vitals", Name: "Web Vitals spread",
			Description: "Page views and vitals only, spread across good, needs-improvement and poor ratings."},
		{ID: "error-burst", Name: "Error burst",
			Description: "A narrow window dominated by a handful of recurring exceptions, for testing issue grouping."},
		{ID: "logs", Name: "结构化应用日志", Description: "六种日志级别、支付排查属性，以及会话、Trace、设备与国家上下文。"},
	}
}

// PresetScenario builds a preset over the given window. An unknown id falls
// back to the storefront preset so a stale UI cannot produce an error the user
// cannot act on.
func PresetScenario(id string, from, to time.Time) Scenario {
	scenario := Scenario{
		Seed: from.UnixNano(), Sessions: 300, From: from, To: to,
		Releases: []Weight{{Value: "web@2026.09.1", Weight: 20}, {Value: "web@2026.09.2", Weight: 45}, {Value: "web@2026.09.3", Weight: 35}},
		Clients:  defaultClients(),
	}
	switch id {
	case "logs":
		scenario.Journeys = []Journey{{Name: "log-investigation", Weight: 1, Pages: []Page{
			{Route: "/checkout", Path: "/checkout", Title: "Checkout", Logs: []Log{
				{Level: "trace", Message: "checkout render started", Logger: "checkout", Odds: 0.7},
				{Level: "debug", Message: "cart cache hit", Logger: "cart", Odds: 0.8, Attributes: map[string]string{"cache.hit": "true", "cart.items": "3"}},
				{Level: "info", Message: "checkout started", Logger: "checkout", Odds: 1, Attributes: map[string]string{"order.id": "order-demo-123", "payment.provider": "demo", "currency": "CNY"}},
				{Level: "warn", Message: "payment retry scheduled", Logger: "payment", Odds: 0.35, Attributes: map[string]string{"retry.attempt": "2", "payment.provider": "demo"}},
				{Level: "error", Message: "payment failed: upstream timeout", Logger: "payment", Odds: 0.2, Attributes: map[string]string{"order.id": "order-demo-123", "error.code": "UPSTREAM_TIMEOUT"}},
				{Level: "fatal", Message: "checkout initialization failed", Logger: "checkout", Odds: 0.04, Attributes: map[string]string{"error.code": "CONFIG_UNAVAILABLE"}},
			}},
		}}}
	case "api-surface":
		scenario.Journeys = []Journey{{Name: "api-surface", Weight: 1, Pages: apiSurfacePages()}}
	case "failing-release":
		scenario.Journeys = []Journey{{Name: "checkout", Weight: 1, Pages: checkoutPages()}}
	case "web-vitals":
		scenario.Journeys = []Journey{{Name: "vitals", Weight: 1, Pages: vitalsPages()}}
	case "error-burst":
		scenario.Sessions = 150
		scenario.Journeys = []Journey{{Name: "error-burst", Weight: 1, Pages: errorBurstPages()}}
	default:
		scenario.Journeys = []Journey{
			{Name: "browse", Weight: 65, Pages: browsePages()},
			{Name: "checkout", Weight: 35, Pages: checkoutPages()},
		}
	}
	return scenario
}

// defaultClients spans the browser, OS, device and country combinations the
// dashboards break down by. Safari is present in enough volume to make the
// browser regression planted below visible rather than noise.
func defaultClients() []Client {
	return []Client{
		{Name: "chrome-desktop", Weight: 40, Country: "CN",
			UserAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"},
		{Name: "safari-desktop", Weight: 18, Country: "US",
			UserAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"},
		{Name: "safari-mobile", Weight: 16, Country: "JP",
			UserAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"},
		{Name: "chrome-android", Weight: 15, Country: "IN",
			UserAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36"},
		{Name: "firefox-desktop", Weight: 7, Country: "DE",
			UserAgent: "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0"},
		{Name: "edge-desktop", Weight: 4, Country: "GB",
			UserAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0"},
	}
}

func browsePages() []Page {
	return []Page{
		{Route: "/", Path: "/", Title: "Home",
			Vitals: standardVitals(),
			APIs: []API{
				{Method: "GET", Path: "/api/home/feed", Odds: 1, LatencyMS: Range{Min: 40, Max: 260}, TransferSize: Range{Min: 8_000, Max: 42_000},
					Outcomes: []Weight{{Value: "200", Weight: 985}, {Value: "500", Weight: 8}, {Value: "0:network", Weight: 7}}},
				{Method: "GET", Path: "/api/promotions", Odds: 0.8, LatencyMS: Range{Min: 25, Max: 120}, TransferSize: Range{Min: 1_200, Max: 6_000},
					Outcomes: []Weight{{Value: "200", Weight: 995}, {Value: "503", Weight: 5}}},
			},
			Custom: []Event{{Name: "home_viewed", Odds: 1}},
		},
		{Route: "/search", Path: "/search?q=running+shoes", Title: "Search",
			Vitals: standardVitals(),
			APIs: []API{
				{Method: "GET", Path: "/api/search", Odds: 1, Repeat: Range{Min: 1, Max: 3}, LatencyMS: Range{Min: 90, Max: 620}, TransferSize: Range{Min: 4_000, Max: 60_000},
					Outcomes: []Weight{{Value: "200", Weight: 960}, {Value: "429", Weight: 25}, {Value: "500", Weight: 10}, {Value: "0:timeout", Weight: 5}}},
				{Method: "GET", Path: "/api/search/suggestions", Odds: 0.7, LatencyMS: Range{Min: 15, Max: 90}, TransferSize: Range{Min: 400, Max: 2_400},
					Outcomes: []Weight{{Value: "200", Weight: 970}, {Value: "0:abort", Weight: 30}}},
			},
			Custom: []Event{{Name: "search_performed", Odds: 1, Attributes: map[string]string{"query": "running shoes"}}},
		},
		{Route: "/products/:id", Path: "/products/8f3a-runner-pro", Title: "Runner Pro",
			Vitals: standardVitals(),
			APIs: []API{
				{Method: "GET", Path: "/api/products/8f3a-runner-pro", Odds: 1, LatencyMS: Range{Min: 35, Max: 210}, TransferSize: Range{Min: 6_000, Max: 24_000},
					Outcomes: []Weight{{Value: "200", Weight: 975}, {Value: "404", Weight: 15}, {Value: "500", Weight: 10}}},
				{Method: "GET", Path: "/api/products/8f3a-runner-pro/reviews", Odds: 0.75, LatencyMS: Range{Min: 60, Max: 340}, TransferSize: Range{Min: 3_000, Max: 90_000},
					Outcomes: []Weight{{Value: "200", Weight: 990}, {Value: "500", Weight: 10}}},
				// Safari pays a large latency penalty here, which is the browser
				// regression the dimension drill-down is meant to surface.
				{Method: "GET", Path: "/api/products/8f3a-runner-pro/recommendations", Odds: 0.6,
					LatencyMS: Range{Min: 80, Max: 300}, TransferSize: Range{Min: 2_000, Max: 12_000},
					SlowClients: map[string]float64{"safari-desktop": 3.4, "safari-mobile": 3.8},
					Outcomes:    []Weight{{Value: "200", Weight: 992}, {Value: "503", Weight: 8}}},
				{Method: "POST", Path: "/api/cart/items", Odds: 0.35, LatencyMS: Range{Min: 70, Max: 280}, TransferSize: Range{Min: 300, Max: 1_800},
					Outcomes: []Weight{{Value: "201", Weight: 950}, {Value: "409", Weight: 30}, {Value: "401", Weight: 12}, {Value: "500", Weight: 8}}},
			},
			Errors: []Error{{
				Name: "TypeError", Message: "Cannot read properties of undefined (reading 'variant')",
				Stack:     "TypeError: Cannot read properties of undefined (reading 'variant')\n    at renderVariant (product-detail.js:184:22)\n    at ProductDetail (product-detail.js:96:5)",
				Mechanism: "onerror", Odds: 0.04,
			}},
			Custom: []Event{{Name: "product_viewed", Odds: 1}, {Name: "add_to_cart", Odds: 0.35, Measurements: map[string]float64{"price": 129.9}}},
		},
	}
}

func checkoutPages() []Page {
	return []Page{
		{Route: "/cart", Path: "/cart", Title: "Cart",
			Vitals: standardVitals(),
			APIs: []API{
				{Method: "GET", Path: "/api/cart", Odds: 1, LatencyMS: Range{Min: 30, Max: 160}, TransferSize: Range{Min: 800, Max: 5_000},
					Outcomes: []Weight{{Value: "200", Weight: 985}, {Value: "401", Weight: 10}, {Value: "500", Weight: 5}}},
				{Method: "PATCH", Path: "/api/cart/items/quantity", Odds: 0.4, LatencyMS: Range{Min: 50, Max: 220}, TransferSize: Range{Min: 300, Max: 1_200},
					Outcomes: []Weight{{Value: "200", Weight: 960}, {Value: "409", Weight: 30}, {Value: "500", Weight: 10}}},
				{Method: "DELETE", Path: "/api/cart/items/9c21", Odds: 0.18, LatencyMS: Range{Min: 40, Max: 180}, TransferSize: Range{Min: 200, Max: 700},
					Outcomes: []Weight{{Value: "204", Weight: 985}, {Value: "404", Weight: 15}}},
			},
			Custom: []Event{{Name: "cart_viewed", Odds: 1}, {Name: "checkout_started", Odds: 0.7}},
		},
		{Route: "/checkout", Path: "/checkout", Title: "Checkout",
			Vitals: standardVitals(),
			APIs: []API{
				{Method: "GET", Path: "/api/checkout/session", Odds: 1, LatencyMS: Range{Min: 60, Max: 300}, TransferSize: Range{Min: 1_500, Max: 9_000},
					Outcomes: []Weight{{Value: "200", Weight: 975}, {Value: "401", Weight: 15}, {Value: "500", Weight: 10}}},
				{Method: "POST", Path: "/api/checkout/shipping", Odds: 0.9, LatencyMS: Range{Min: 120, Max: 700}, TransferSize: Range{Min: 600, Max: 3_000},
					Outcomes: []Weight{{Value: "200", Weight: 950}, {Value: "422", Weight: 35}, {Value: "500", Weight: 10}, {Value: "0:timeout", Weight: 5}}},
				// The newest release fails payment intents far more often, which
				// is the release regression the comparison view should catch.
				{Method: "POST", Path: "/api/payments/intent", Odds: 0.8,
					LatencyMS: Range{Min: 180, Max: 900}, TransferSize: Range{Min: 700, Max: 2_600},
					Outcomes: []Weight{{Value: "201", Weight: 960}, {Value: "402", Weight: 25}, {Value: "500", Weight: 10}, {Value: "0:network", Weight: 5}},
					FailingReleases: map[string][]Weight{
						"web@2026.09.3": {{Value: "201", Weight: 780}, {Value: "402", Weight: 30}, {Value: "500", Weight: 140}, {Value: "502", Weight: 30}, {Value: "0:timeout", Weight: 20}},
					}},
				{Method: "POST", Path: "/api/orders", Odds: 0.6, LatencyMS: Range{Min: 220, Max: 1_400}, TransferSize: Range{Min: 900, Max: 4_000},
					Outcomes: []Weight{{Value: "201", Weight: 955}, {Value: "409", Weight: 25}, {Value: "500", Weight: 15}, {Value: "504", Weight: 5}}},
				// Deliberately rare, so the endpoint stays under the sample
				// threshold and renders as insufficient rather than as a
				// confident but meaningless percentile.
				{Method: "POST", Path: "/api/admin/inventory/export", Odds: 0.01, LatencyMS: Range{Min: 900, Max: 4_000}, TransferSize: Range{Min: 40_000, Max: 400_000},
					Outcomes: []Weight{{Value: "202", Weight: 900}, {Value: "403", Weight: 60}, {Value: "500", Weight: 40}}},
			},
			Errors: []Error{{
				Name: "PaymentDeclinedError", Message: "The payment provider declined the intent",
				Stack:     "PaymentDeclinedError: The payment provider declined the intent\n    at confirmIntent (checkout/payment.js:212:17)\n    at submitOrder (checkout/index.js:88:9)",
				Mechanism: "handled", Handled: true, Odds: 0.06,
			}},
			Custom: []Event{{Name: "payment_submitted", Odds: 0.8}, {Name: "order_completed", Odds: 0.55, Measurements: map[string]float64{"revenue": 258.4}}},
		},
	}
}

func apiSurfacePages() []Page {
	pages := browsePages()
	return append(pages, checkoutPages()...)
}

func vitalsPages() []Page {
	return []Page{
		{Route: "/", Path: "/", Title: "Home", Vitals: standardVitals()},
		{Route: "/products/:id", Path: "/products/8f3a-runner-pro", Title: "Runner Pro", Vitals: slowVitals()},
		{Route: "/checkout", Path: "/checkout", Title: "Checkout", Vitals: slowVitals()},
	}
}

func errorBurstPages() []Page {
	return []Page{
		{Route: "/checkout", Path: "/checkout", Title: "Checkout",
			Errors: []Error{
				{Name: "TypeError", Message: "undefined is not a function", Odds: 0.8, Mechanism: "onerror",
					Stack: "TypeError: undefined is not a function\n    at applyCoupon (checkout/coupon.js:44:12)"},
				{Name: "NetworkError", Message: "Failed to fetch", Odds: 0.5, Mechanism: "onunhandledrejection",
					Stack: "NetworkError: Failed to fetch\n    at postIntent (checkout/payment.js:120:9)"},
				{Name: "RangeError", Message: "Invalid array length", Odds: 0.2, Handled: true, Mechanism: "handled",
					Stack: "RangeError: Invalid array length\n    at buildLineItems (checkout/cart.js:76:20)"},
			}},
	}
}

// standardVitals spans the rating bands: the ranges are wide enough that a
// single run produces good, needs-improvement and poor samples.
func standardVitals() []Vital {
	return []Vital{
		{Name: "LCP", Odds: 1, Value: Range{Min: 900, Max: 4_800}},
		{Name: "FCP", Odds: 1, Value: Range{Min: 500, Max: 3_200}},
		{Name: "TTFB", Odds: 1, Value: Range{Min: 120, Max: 1_900}},
		{Name: "INP", Odds: 0.8, Value: Range{Min: 40, Max: 620}},
		{Name: "CLS", Odds: 0.8, Value: Range{Min: 0, Max: 0.34}},
	}
}

func slowVitals() []Vital {
	return []Vital{
		{Name: "LCP", Odds: 1, Value: Range{Min: 2_600, Max: 7_400}},
		{Name: "FCP", Odds: 1, Value: Range{Min: 1_700, Max: 4_600}},
		{Name: "TTFB", Odds: 1, Value: Range{Min: 700, Max: 2_800}},
		{Name: "INP", Odds: 0.9, Value: Range{Min: 180, Max: 940}},
		{Name: "CLS", Odds: 0.9, Value: Range{Min: 0.08, Max: 0.52}},
	}
}
