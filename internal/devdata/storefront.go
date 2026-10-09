package devdata

// The storefront preset is the one-run, full-coverage dataset: every event type the
// Console reads (page views, all five Web Vitals, APIs, errors, logs, click behavior
// and business events), returning visitors with signed-in business users, traffic
// sources, a daily rhythm, funnel drop-off and one planted incident. It keeps the
// regressions the other presets plant, so every page has something to find.

func storefrontScenario(scenario Scenario) Scenario {
	scenario.Sessions = 1_200
	scenario.Clients = storefrontClients()
	scenario.Releases = []Weight{
		{Value: "web@2026.09.1", Weight: 15}, {Value: "web@2026.09.2", Weight: 45}, {Value: "web@2026.09.3", Weight: 40},
	}
	scenario.Users = &UserPool{Visitors: 700, SignedIn: 0.45, Prefix: "cust_"}
	scenario.Referrers = []Weight{
		{Value: "", Weight: 30},
		{Value: "https://www.google.com/", Weight: 20},
		{Value: "https://www.baidu.com/", Weight: 14},
		{Value: "https://weixin.qq.com/", Weight: 11},
		{Value: "https://www.xiaohongshu.com/", Weight: 7},
		{Value: "https://www.bing.com/", Weight: 5},
		{Value: "https://ads.example-network.com/", Weight: 7},
		{Value: "https://mail.example.com/", Weight: 6},
	}
	scenario.DailyRhythm = &DailyRhythm{TimeZone: "Asia/Shanghai", Hourly: []float64{
		// Night trough, a morning climb, a lunch bump and the evening shopping peak.
		0.45, 0.28, 0.18, 0.12, 0.1, 0.12, 0.22, 0.42, 0.66, 0.82, 0.9, 0.92,
		0.98, 0.9, 0.82, 0.8, 0.84, 0.88, 0.94, 1, 1, 0.96, 0.82, 0.62,
	}}
	// A short payment-provider incident: errors and server failures spike, so the
	// error trend, API failure rate and alerts have something real to show.
	scenario.Incidents = []Incident{{Start: 0.71, End: 0.75, ErrorMultiplier: 5, FailureMultiplier: 7}}
	scenario.Journeys = []Journey{
		{Name: "browse", Weight: 34, Pages: []Page{storeHome(0.32), storeCategory(0.38), storeProduct(0.55)}},
		{Name: "purchase", Weight: 28, Pages: []Page{storeHome(0.06), storeProduct(0.12), storeCart(0.18), storeCheckout(0.12), storeOrderComplete()}},
		{Name: "search", Weight: 18, Pages: []Page{storeSearch(0.22), storeProduct(0.4), storeCart(0.5)}},
		{Name: "account", Weight: 12, Pages: []Page{storeLogin(0.08), storeOrders(0.3), storeOrderDetail()}},
		{Name: "support", Weight: 8, Pages: []Page{storeHelp(0.45), storeContact()}},
	}
	return scenario
}

// storefrontClients spans browsers, systems, device types and countries, weighted
// towards the mainland China traffic a storefront like this mostly receives.
func storefrontClients() []Client {
	return []Client{
		{Name: "chrome-desktop", Weight: 26, Country: "CN",
			UserAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"},
		{Name: "chrome-mac", Weight: 9, Country: "CN",
			UserAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"},
		{Name: "safari-mobile", Weight: 17, Country: "CN",
			UserAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"},
		{Name: "wechat-android", Weight: 10, Country: "CN",
			UserAgent: "Mozilla/5.0 (Linux; Android 14; V2309A) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/122.0.6261.120 Mobile Safari/537.36 MicroMessenger/8.0.50"},
		{Name: "chrome-android", Weight: 9, Country: "IN",
			UserAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36"},
		{Name: "safari-desktop", Weight: 8, Country: "US",
			UserAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"},
		{Name: "safari-ipad", Weight: 4, Country: "JP",
			UserAgent: "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"},
		{Name: "samsung-android", Weight: 4, Country: "KR",
			UserAgent: "Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36"},
		{Name: "edge-desktop", Weight: 5, Country: "SG",
			UserAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0"},
		{Name: "firefox-desktop", Weight: 4, Country: "DE",
			UserAgent: "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0"},
		{Name: "chrome-uk", Weight: 2, Country: "GB",
			UserAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"},
		{Name: "safari-au", Weight: 2, Country: "AU",
			UserAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1"},
	}
}

var storeProducts = []string{
	"/products/runner-pro-2", "/products/trail-x-gtx", "/products/city-knit-lite",
	"/products/court-classic", "/products/aero-sock-3pack", "/products/summit-shell-jacket",
}

func ok(weight int, failures ...Weight) []Weight {
	return append([]Weight{{Value: "200", Weight: weight}}, failures...)
}

func storeHome(exit float64) Page {
	return Page{Route: "/", Path: "/", Title: "首页 · Stride Store", Exit: exit, Vitals: storeVitals(1),
		APIs: []API{
			{Method: "GET", Path: "/api/home/feed", Odds: 1, LatencyMS: Range{Min: 45, Max: 240, Skew: 1.8}, TransferSize: Range{Min: 9_000, Max: 46_000},
				Outcomes: ok(988, Weight{Value: "500", Weight: 7}, Weight{Value: "0:network", Weight: 5})},
			{Method: "GET", Path: "/api/promotions", Odds: 0.85, LatencyMS: Range{Min: 25, Max: 110, Skew: 1.8}, TransferSize: Range{Min: 1_200, Max: 6_000},
				Outcomes: ok(995, Weight{Value: "503", Weight: 5})},
			{Method: "GET", Path: "/api/user/profile", Odds: 0.5, LatencyMS: Range{Min: 30, Max: 140, Skew: 1.8}, TransferSize: Range{Min: 600, Max: 2_000},
				Outcomes: ok(960, Weight{Value: "401", Weight: 40})},
		},
		Clicks: []Click{{Name: "hero-banner", Element: "a", Odds: 0.35}, {Name: "nav-category", Element: "a", Role: "link", Odds: 0.5}},
		Custom: []Event{{Name: "home_viewed", Odds: 1}},
		Logs:   []Log{{Level: "info", Message: "home feed rendered", Logger: "home", Odds: 0.3, Attributes: map[string]string{"feed.items": "24"}}},
	}
}

func storeCategory(exit float64) Page {
	return Page{Route: "/category/:slug", Path: "/category/running",
		Paths: []string{"/category/running", "/category/trail", "/category/lifestyle", "/category/apparel"},
		Title: "分类 · Stride Store", Exit: exit, Vitals: storeVitals(1.1),
		APIs: []API{
			{Method: "GET", Path: "/api/catalog/products", Odds: 1, Repeat: Range{Min: 1, Max: 3}, LatencyMS: Range{Min: 70, Max: 420, Skew: 1.8}, TransferSize: Range{Min: 12_000, Max: 80_000},
				Outcomes: ok(975, Weight{Value: "500", Weight: 12}, Weight{Value: "0:timeout", Weight: 4})},
			{Method: "GET", Path: "/api/catalog/filters", Odds: 0.7, LatencyMS: Range{Min: 20, Max: 90, Skew: 1.8}, TransferSize: Range{Min: 800, Max: 3_200},
				Outcomes: ok(997, Weight{Value: "500", Weight: 3})},
		},
		Clicks: []Click{{Name: "filter-size", Element: "button", Odds: 0.45}, {Name: "sort-price", Element: "select", Odds: 0.25}, {Name: "product-card", Element: "a", Odds: 0.7}},
		Custom: []Event{{Name: "view_item_list", Odds: 1}},
	}
}

func storeSearch(exit float64) Page {
	return Page{Route: "/search", Path: "/search?q=running+shoes",
		Paths: []string{"/search?q=running+shoes", "/search?q=waterproof+jacket", "/search?q=socks", "/search?q=trail"},
		Title: "搜索 · Stride Store", Exit: exit, Vitals: storeVitals(1.05),
		APIs: []API{
			{Method: "GET", Path: "/api/search", Odds: 1, Repeat: Range{Min: 1, Max: 4}, LatencyMS: Range{Min: 90, Max: 640, Skew: 1.8}, TransferSize: Range{Min: 4_000, Max: 60_000},
				Outcomes: ok(955, Weight{Value: "429", Weight: 25}, Weight{Value: "500", Weight: 12}, Weight{Value: "0:timeout", Weight: 8})},
			{Method: "GET", Path: "/api/search/suggestions", Odds: 0.8, Repeat: Range{Min: 1, Max: 5}, LatencyMS: Range{Min: 12, Max: 80, Skew: 1.8}, TransferSize: Range{Min: 400, Max: 2_400},
				Outcomes: ok(965, Weight{Value: "0:abort", Weight: 35})},
		},
		Clicks: []Click{{Name: "search-submit", Element: "button", Odds: 0.8}, {Name: "suggestion", Element: "a", Role: "menuitem", Odds: 0.4}},
		Errors: []Error{{Name: "AbortError", Message: "The user aborted a request.", Mechanism: "onunhandledrejection", Odds: 0.02,
			Stack: "AbortError: The user aborted a request.\n    at fetchSuggestions (search/suggest.ts:41:11)"}},
		Custom: []Event{{Name: "search", Odds: 1, Attributes: map[string]string{"results": "many"}}},
	}
}

func storeProduct(exit float64) Page {
	return Page{Route: "/products/:id", Path: storeProducts[0], Paths: storeProducts,
		Title: "商品详情 · Stride Store", Exit: exit, Vitals: storeVitals(1.25),
		APIs: []API{
			{Method: "GET", Path: "/api/products/runner-pro-2", Odds: 1, LatencyMS: Range{Min: 35, Max: 210, Skew: 1.8}, TransferSize: Range{Min: 6_000, Max: 24_000},
				Outcomes: ok(978, Weight{Value: "404", Weight: 14}, Weight{Value: "500", Weight: 8})},
			{Method: "GET", Path: "/api/products/runner-pro-2/reviews", Odds: 0.75, LatencyMS: Range{Min: 60, Max: 340, Skew: 1.8}, TransferSize: Range{Min: 3_000, Max: 90_000},
				Outcomes: ok(990, Weight{Value: "500", Weight: 10})},
			// Safari pays a large latency penalty here: the browser regression the
			// API dimension drill-down is meant to surface.
			{Method: "GET", Path: "/api/products/runner-pro-2/recommendations", Odds: 0.6,
				LatencyMS: Range{Min: 80, Max: 300, Skew: 1.8}, TransferSize: Range{Min: 2_000, Max: 12_000},
				SlowClients: map[string]float64{"safari-desktop": 3.4, "safari-mobile": 3.8, "safari-ipad": 3.2, "safari-au": 3.6},
				Outcomes:    ok(992, Weight{Value: "503", Weight: 8})},
			{Method: "GET", Path: "/api/inventory/availability", Odds: 0.9, LatencyMS: Range{Min: 25, Max: 160, Skew: 1.8}, TransferSize: Range{Min: 300, Max: 1_400},
				Outcomes: ok(985, Weight{Value: "500", Weight: 10}, Weight{Value: "0:network", Weight: 5})},
			{Method: "POST", Path: "/api/cart/items", Odds: 0.38, LatencyMS: Range{Min: 70, Max: 280, Skew: 1.8}, TransferSize: Range{Min: 300, Max: 1_800},
				Outcomes: []Weight{{Value: "201", Weight: 952}, {Value: "409", Weight: 28}, {Value: "401", Weight: 12}, {Value: "500", Weight: 8}}},
		},
		Clicks: []Click{
			{Name: "size-picker", Element: "button", Odds: 0.7}, {Name: "color-swatch", Element: "button", Odds: 0.45},
			{Name: "add-to-cart", Element: "button", Odds: 0.4}, {Name: "reviews-tab", Element: "button", Role: "tab", Odds: 0.3},
		},
		Errors: []Error{
			{Name: "TypeError", Message: "Cannot read properties of undefined (reading 'variant')", Mechanism: "onerror", Odds: 0.03,
				Stack: "TypeError: Cannot read properties of undefined (reading 'variant')\n    at renderVariant (assets/product-detail.js:184:22)\n    at ProductDetail (assets/product-detail.js:96:5)"},
			{Name: "ChunkLoadError", Message: "Loading chunk 812 failed.", Mechanism: "onunhandledrejection", Odds: 0.008,
				Stack: "ChunkLoadError: Loading chunk 812 failed.\n    at __webpack_require__.f.j (assets/runtime.js:1:9821)"},
		},
		Custom: []Event{
			{Name: "view_item", Odds: 1},
			{Name: "add_to_cart", Odds: 0.36, MeasurementRanges: map[string]Range{"price": {Min: 39, Max: 899}}},
		},
		Logs: []Log{{Level: "debug", Message: "inventory cache hit", Logger: "inventory", Odds: 0.25, Attributes: map[string]string{"cache.hit": "true"}}},
	}
}

func storeCart(exit float64) Page {
	return Page{Route: "/cart", Path: "/cart", Title: "购物车 · Stride Store", Exit: exit, Vitals: storeVitals(0.95),
		APIs: []API{
			{Method: "GET", Path: "/api/cart", Odds: 1, LatencyMS: Range{Min: 30, Max: 160, Skew: 1.8}, TransferSize: Range{Min: 800, Max: 5_000},
				Outcomes: ok(985, Weight{Value: "401", Weight: 10}, Weight{Value: "500", Weight: 5})},
			{Method: "PATCH", Path: "/api/cart/items/quantity", Odds: 0.4, LatencyMS: Range{Min: 50, Max: 220, Skew: 1.8}, TransferSize: Range{Min: 300, Max: 1_200},
				Outcomes: ok(962, Weight{Value: "409", Weight: 28}, Weight{Value: "500", Weight: 10})},
			{Method: "POST", Path: "/api/coupons/apply", Odds: 0.22, LatencyMS: Range{Min: 60, Max: 260, Skew: 1.8}, TransferSize: Range{Min: 300, Max: 900},
				Outcomes: ok(880, Weight{Value: "422", Weight: 110}, Weight{Value: "500", Weight: 10})},
		},
		Clicks: []Click{{Name: "quantity-stepper", Element: "button", Odds: 0.4}, {Name: "apply-coupon", Element: "button", Odds: 0.22}, {Name: "go-checkout", Element: "button", Odds: 0.75}},
		Errors: []Error{{Name: "TypeError", Message: "undefined is not a function", Mechanism: "onerror", Odds: 0.015,
			Stack: "TypeError: undefined is not a function\n    at applyCoupon (assets/checkout/coupon.js:44:12)"}},
		Custom: []Event{{Name: "view_cart", Odds: 1}, {Name: "begin_checkout", Odds: 0.72}},
	}
}

func storeCheckout(exit float64) Page {
	return Page{Route: "/checkout", Path: "/checkout", Title: "结算 · Stride Store", Exit: exit, Vitals: storeVitals(1.15),
		APIs: []API{
			{Method: "GET", Path: "/api/checkout/session", Odds: 1, LatencyMS: Range{Min: 60, Max: 300, Skew: 1.8}, TransferSize: Range{Min: 1_500, Max: 9_000},
				Outcomes: ok(976, Weight{Value: "401", Weight: 14}, Weight{Value: "500", Weight: 10})},
			{Method: "POST", Path: "/api/checkout/shipping", Odds: 0.92, LatencyMS: Range{Min: 120, Max: 700, Skew: 1.8}, TransferSize: Range{Min: 600, Max: 3_000},
				Outcomes: ok(952, Weight{Value: "422", Weight: 33}, Weight{Value: "500", Weight: 10}, Weight{Value: "0:timeout", Weight: 5})},
			// The newest release fails payment intents far more often: the release
			// regression the comparison views and alerts should catch.
			{Method: "POST", Path: "/api/payments/intent", Odds: 0.85,
				LatencyMS: Range{Min: 180, Max: 900, Skew: 1.8}, TransferSize: Range{Min: 700, Max: 2_600},
				Outcomes: []Weight{{Value: "201", Weight: 962}, {Value: "402", Weight: 23}, {Value: "500", Weight: 10}, {Value: "0:network", Weight: 5}},
				FailingReleases: map[string][]Weight{
					"web@2026.09.3": {{Value: "201", Weight: 860}, {Value: "402", Weight: 30}, {Value: "500", Weight: 75}, {Value: "502", Weight: 20}, {Value: "0:timeout", Weight: 15}},
				}},
			{Method: "POST", Path: "/api/orders", Odds: 0.7, LatencyMS: Range{Min: 220, Max: 1_400, Skew: 1.8}, TransferSize: Range{Min: 900, Max: 4_000},
				Outcomes: []Weight{{Value: "201", Weight: 958}, {Value: "409", Weight: 22}, {Value: "500", Weight: 15}, {Value: "504", Weight: 5}}},
		},
		Clicks: []Click{{Name: "address-select", Element: "select", Odds: 0.6}, {Name: "payment-method", Element: "input", Odds: 0.85}, {Name: "place-order", Element: "button", Odds: 0.8}},
		Errors: []Error{
			{Name: "PaymentDeclinedError", Message: "The payment provider declined the intent", Mechanism: "handled", Handled: true, Odds: 0.05,
				Stack: "PaymentDeclinedError: The payment provider declined the intent\n    at confirmIntent (assets/checkout/payment.js:212:17)\n    at submitOrder (assets/checkout/index.js:88:9)"},
			{Name: "NetworkError", Message: "Failed to fetch", Mechanism: "onunhandledrejection", Odds: 0.02,
				Stack: "NetworkError: Failed to fetch\n    at postIntent (assets/checkout/payment.js:120:9)"},
		},
		Custom: []Event{
			{Name: "add_shipping_info", Odds: 0.9},
			{Name: "add_payment_info", Odds: 0.82},
		},
		Logs: []Log{
			{Level: "info", Message: "checkout started", Logger: "checkout", Odds: 1, Attributes: map[string]string{"payment.provider": "stripe-cn", "currency": "CNY"}},
			{Level: "warn", Message: "payment retry scheduled", Logger: "payment", Odds: 0.12, Attributes: map[string]string{"retry.attempt": "2"}},
			{Level: "error", Message: "payment failed: upstream timeout", Logger: "payment", Odds: 0.04, Attributes: map[string]string{"error.code": "UPSTREAM_TIMEOUT"}},
		},
	}
}

func storeOrderComplete() Page {
	return Page{Route: "/orders/:id/complete", Path: "/orders/SO-240918-001/complete",
		Paths: []string{"/orders/SO-240918-001/complete", "/orders/SO-240918-002/complete", "/orders/SO-240918-003/complete"},
		Title: "下单成功 · Stride Store", Vitals: storeVitals(0.9),
		APIs: []API{{Method: "GET", Path: "/api/orders/latest", Odds: 1, LatencyMS: Range{Min: 40, Max: 180, Skew: 1.8}, TransferSize: Range{Min: 1_000, Max: 4_000},
			Outcomes: ok(995, Weight{Value: "500", Weight: 5})}},
		Clicks: []Click{{Name: "continue-shopping", Element: "a", Odds: 0.3}},
		Custom: []Event{{Name: "purchase", Odds: 1, Attributes: map[string]string{"currency": "CNY"},
			// "amount" is the order total the dashboard's revenue modules read.
			MeasurementRanges: map[string]Range{"amount": {Min: 79, Max: 2_400, Skew: 1.7}, "items": {Min: 1, Max: 4, Skew: 1.6}}}},
		Logs: []Log{{Level: "info", Message: "order placed", Logger: "orders", Odds: 1, Attributes: map[string]string{"currency": "CNY"}}},
	}
}

func storeLogin(exit float64) Page {
	return Page{Route: "/login", Path: "/login", Title: "登录 · Stride Store", Exit: exit, Vitals: storeVitals(0.85),
		APIs: []API{{Method: "POST", Path: "/api/auth/login", Odds: 0.95, LatencyMS: Range{Min: 120, Max: 520, Skew: 1.8}, TransferSize: Range{Min: 400, Max: 1_200},
			Outcomes: ok(900, Weight{Value: "401", Weight: 85}, Weight{Value: "429", Weight: 10}, Weight{Value: "500", Weight: 5})}},
		Clicks: []Click{{Name: "login-submit", Element: "button", Odds: 0.95}, {Name: "remember-me", Element: "input", Odds: 0.3}},
		Custom: []Event{{Name: "login", Odds: 0.9}},
	}
}

func storeOrders(exit float64) Page {
	return Page{Route: "/account/orders", Path: "/account/orders", Title: "我的订单 · Stride Store", Exit: exit, Vitals: storeVitals(1),
		APIs: []API{{Method: "GET", Path: "/api/orders", Odds: 1, LatencyMS: Range{Min: 80, Max: 460, Skew: 1.8}, TransferSize: Range{Min: 3_000, Max: 30_000},
			Outcomes: ok(985, Weight{Value: "500", Weight: 10}, Weight{Value: "0:timeout", Weight: 5})}},
		Clicks: []Click{{Name: "order-row", Element: "a", Odds: 0.7}},
		Custom: []Event{{Name: "view_orders", Odds: 1}},
	}
}

func storeOrderDetail() Page {
	return Page{Route: "/account/orders/:id", Path: "/account/orders/SO-240911-118",
		Paths: []string{"/account/orders/SO-240911-118", "/account/orders/SO-240902-047", "/account/orders/SO-240827-311"},
		Title: "订单详情 · Stride Store", Vitals: storeVitals(1),
		APIs: []API{
			{Method: "GET", Path: "/api/orders/SO-240911-118", Odds: 1, LatencyMS: Range{Min: 50, Max: 260, Skew: 1.8}, TransferSize: Range{Min: 1_200, Max: 6_000},
				Outcomes: ok(988, Weight{Value: "404", Weight: 8}, Weight{Value: "500", Weight: 4})},
			{Method: "GET", Path: "/api/shipments/tracking", Odds: 0.7, LatencyMS: Range{Min: 200, Max: 1_600, Skew: 1.8}, TransferSize: Range{Min: 800, Max: 4_000},
				Outcomes: ok(950, Weight{Value: "502", Weight: 30}, Weight{Value: "0:timeout", Weight: 20})},
		},
		Clicks: []Click{{Name: "track-shipment", Element: "button", Odds: 0.6}, {Name: "request-return", Element: "button", Odds: 0.08}},
		Errors: []Error{{Name: "TrackingUnavailableError", Message: "Carrier tracking service is unavailable", Mechanism: "handled", Handled: true, Odds: 0.03,
			Stack: "TrackingUnavailableError: Carrier tracking service is unavailable\n    at loadTracking (assets/account/tracking.js:58:15)"}},
		Logs: []Log{{Level: "warn", Message: "carrier tracking slow", Logger: "shipping", Odds: 0.1, Attributes: map[string]string{"carrier": "sf-express"}}},
	}
}

func storeHelp(exit float64) Page {
	return Page{Route: "/help/:topic", Path: "/help/returns", Paths: []string{"/help/returns", "/help/shipping", "/help/sizing"},
		Title: "帮助中心 · Stride Store", Exit: exit, Vitals: storeVitals(0.8),
		APIs: []API{{Method: "GET", Path: "/api/help/articles", Odds: 1, LatencyMS: Range{Min: 30, Max: 140, Skew: 1.8}, TransferSize: Range{Min: 2_000, Max: 12_000},
			Outcomes: ok(997, Weight{Value: "500", Weight: 3})}},
		Clicks: []Click{{Name: "faq-item", Element: "summary", Odds: 0.7}},
		Custom: []Event{{Name: "help_viewed", Odds: 1}},
	}
}

func storeContact() Page {
	return Page{Route: "/help/contact", Path: "/help/contact", Title: "联系客服 · Stride Store", Vitals: storeVitals(0.9),
		APIs: []API{{Method: "POST", Path: "/api/support/tickets", Odds: 0.6, LatencyMS: Range{Min: 150, Max: 700, Skew: 1.8}, TransferSize: Range{Min: 300, Max: 1_000},
			Outcomes: []Weight{{Value: "201", Weight: 970}, {Value: "422", Weight: 25}, {Value: "500", Weight: 5}}}},
		Clicks: []Click{{Name: "start-chat", Element: "button", Odds: 0.4}, {Name: "submit-ticket", Element: "button", Odds: 0.6}},
		Errors: []Error{{Name: "ReferenceError", Message: "chatWidget is not defined", Mechanism: "onerror", Odds: 0.04,
			Stack: "ReferenceError: chatWidget is not defined\n    at openChat (assets/support/chat.js:12:5)"}},
		Custom: []Event{{Name: "support_ticket_created", Odds: 0.55}},
	}
}

// storeVitals keeps most samples in the good band with a long, right-skewed tail,
// the shape field data has; a heavier page passes a weight above 1 to shift slower.
// At weight 1 the P75s land near LCP 2.35s, INP 210ms and CLS 0.11 (P75 = min + 0.75^skew × span).
func storeVitals(weight float64) []Vital {
	return []Vital{
		{Name: "LCP", Odds: 1, Value: Range{Min: 800 * weight, Max: 6_000 * weight, Skew: 4.2}},
		{Name: "FCP", Odds: 1, Value: Range{Min: 400 * weight, Max: 4_200 * weight, Skew: 4.2}},
		{Name: "TTFB", Odds: 1, Value: Range{Min: 70 * weight, Max: 2_400 * weight, Skew: 4.2}},
		{Name: "INP", Odds: 0.75, Value: Range{Min: 30 * weight, Max: 700 * weight, Skew: 4.5}},
		{Name: "CLS", Odds: 0.8, Value: Range{Min: 0, Max: 0.3 * weight, Skew: 3.4}},
	}
}
