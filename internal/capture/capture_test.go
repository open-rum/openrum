package capture

import (
	"errors"
	"reflect"
	"strings"
	"testing"
)

func TestZeroSettingsCaptureNothing(t *testing.T) {
	compiled, err := Compile(Settings{})
	if err != nil {
		t.Fatal(err)
	}
	if compiled.Active() {
		t.Fatal("empty settings must be inactive")
	}
	if selection := compiled.Select("GET", "https://api.example.com/orders"); !selection.Empty() {
		t.Fatalf("selection = %+v, want empty", selection)
	}
	var missing *Compiled
	if missing.Active() || !missing.Select("GET", "https://x.test/").Empty() {
		t.Fatal("a nil rule set must capture nothing")
	}
}

func TestValidateRefusesSensitiveHeaders(t *testing.T) {
	for _, name := range []string{
		"authorization", "cookie", "set-cookie", "x-api-key", "x-auth-token", "proxy-authorization",
		"x-csrf-token", "x-forwarded-for", "x-real-ip", "x-session-id", "x-user-email",
	} {
		settings := Settings{Rules: []Rule{{ID: "r", Method: "GET", Pattern: "https://api.example.com/*", RequestHeaders: []string{name}}}}
		err := settings.Validate()
		if !errors.Is(err, ErrInvalidSettings) || !strings.Contains(err.Error(), name) {
			t.Errorf("%s: err = %v, want a refusal naming the header", name, err)
		}
		// The rule is named by its address: its identifier is generated and means nothing to a reader.
		if err != nil && (!strings.Contains(err.Error(), "https://api.example.com/*") || strings.Contains(err.Error(), `"r"`)) {
			t.Errorf("%s: err = %v, want the rule named by its address", name, err)
		}
	}
	allowed := Settings{Rules: []Rule{{
		ID: "r", Method: "GET", Pattern: "https://api.example.com/*",
		RequestHeaders: []string{"x-request-id", "accept"}, ResponseHeaders: []string{"content-type", "cache-control", "etag"},
	}}}
	if err := allowed.Validate(); err != nil {
		t.Fatalf("ordinary headers must be accepted: %v", err)
	}
}

func TestValidateRejectsBroadAndMalformedRules(t *testing.T) {
	base := Rule{ID: "r", Method: "GET", Pattern: "https://api.example.com/*", ResponseHeaders: []string{"etag"}}
	cases := map[string]func(Rule) Rule{
		"only wildcards":   func(rule Rule) Rule { rule.Pattern = "*"; return rule },
		"wildcard slashes": func(rule Rule) Rule { rule.Pattern = "*/*"; return rule },
		"unknown method":   func(rule Rule) Rule { rule.Method = "TRACE"; return rule },
		"nothing named":    func(rule Rule) Rule { rule.ResponseHeaders = nil; return rule },
		"upper-case name":  func(rule Rule) Rule { rule.ResponseHeaders = []string{"ETag"}; return rule },
		"duplicate name":   func(rule Rule) Rule { rule.ResponseHeaders = []string{"etag", "etag"}; return rule },
		"empty id":         func(rule Rule) Rule { rule.ID = ""; return rule },
		"long pattern":     func(rule Rule) Rule { rule.Pattern = strings.Repeat("a", MaxPatternLength+1); return rule },
		"many wildcards":   func(rule Rule) Rule { rule.Pattern = "a" + strings.Repeat("*a", MaxWildcards+1); return rule },
	}
	for name, mutate := range cases {
		if err := (Settings{Rules: []Rule{mutate(base)}}).Validate(); !errors.Is(err, ErrInvalidSettings) {
			t.Errorf("%s: err = %v, want ErrInvalidSettings", name, err)
		}
	}
	duplicate := Settings{Rules: []Rule{base, base}}
	if err := duplicate.Validate(); !errors.Is(err, ErrInvalidSettings) {
		t.Errorf("duplicate id: err = %v", err)
	}
	tooMany := Settings{}
	for index := 0; index <= MaxRules; index++ {
		rule := base
		rule.ID = strings.Repeat("x", index+1)
		tooMany.Rules = append(tooMany.Rules, rule)
	}
	if err := tooMany.Validate(); !errors.Is(err, ErrInvalidSettings) {
		t.Errorf("too many rules: err = %v", err)
	}
}

func TestNormalizeCanonicalisesInput(t *testing.T) {
	normalized := Settings{Rules: []Rule{{
		ID: " r ", Method: " post ", Pattern: " https://api.example.com/orders/:id ",
		RequestHeaders: []string{" X-Request-Id ", ""}, ResponseHeaders: []string{"Content-Type"},
	}, {ID: "any", Pattern: "https://api.example.com/*", ResponseHeaders: []string{"etag"}}}}.Normalize()
	first := normalized.Rules[0]
	if first.ID != "r" || first.Method != "POST" || first.Pattern != "https://api.example.com/orders/:id" ||
		!reflect.DeepEqual(first.RequestHeaders, []string{"x-request-id"}) ||
		!reflect.DeepEqual(first.ResponseHeaders, []string{"content-type"}) {
		t.Fatalf("normalized = %+v", first)
	}
	if normalized.Rules[1].Method != AnyMethod {
		t.Fatalf("an omitted method must mean any, got %q", normalized.Rules[1].Method)
	}
	if err := normalized.Validate(); err != nil {
		t.Fatal(err)
	}
}

func TestSelectMatchesEndpointAndMethod(t *testing.T) {
	compiled, err := Compile(Settings{Rules: []Rule{
		{ID: "orders", Method: "GET", Pattern: "https://api.example.com/orders/:id", ResponseHeaders: []string{"etag"}},
		{ID: "family", Method: "*", Pattern: "https://api.example.com/*", RequestHeaders: []string{"accept"}, ResponseHeaders: []string{"content-type", "etag"}},
		{ID: "other", Method: "POST", Pattern: "https://billing.example.com/*", ResponseHeaders: []string{"x-trace"}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	got := compiled.Select("GET", "https://api.example.com/orders/:id")
	if !reflect.DeepEqual(got.Request, []string{"accept"}) || !reflect.DeepEqual(got.Response, []string{"etag", "content-type"}) {
		t.Fatalf("union of matching rules = %+v", got)
	}
	if got := compiled.Select("POST", "https://api.example.com/orders"); !reflect.DeepEqual(got.Response, []string{"content-type", "etag"}) {
		t.Fatalf("method-specific rule must not apply to POST: %+v", got)
	}
	if got := compiled.Select("GET", "https://billing.example.com/x"); !got.Empty() {
		t.Fatalf("a POST-only rule matched GET: %+v", got)
	}
	if got := compiled.Select("GET", "https://elsewhere.example.org/x"); !got.Empty() {
		t.Fatalf("an unrelated host matched: %+v", got)
	}
	if got := compiled.Select("GET", "HTTPS://API.EXAMPLE.COM/ORDERS/:ID"); got.Empty() {
		t.Fatal("matching must ignore case")
	}
}

func TestCompileFailsClosedOnInvalidDocument(t *testing.T) {
	if _, err := Compile(Settings{Rules: []Rule{{ID: "r", Method: "GET", Pattern: "*"}}}); err == nil {
		t.Fatal("an invalid stored document must not compile")
	}
}

func TestClientProjectionWidensIdentifiersAndDropsNotes(t *testing.T) {
	projected := Settings{Rules: []Rule{{
		ID: "r", Method: "GET", Pattern: "https://api.example.com/orders/:id/items/:id",
		ResponseHeaders: []string{"etag"}, Note: "internal context",
	}}}.ClientProjection()
	rule := projected.Rules[0]
	if rule.Pattern != "https://api.example.com/orders/*/items/*" || rule.Note != "" {
		t.Fatalf("projection = %+v", rule)
	}
	compiled, err := Compile(projected)
	if err != nil {
		t.Fatal(err)
	}
	// The browser holds the concrete address, which the widened pattern must cover.
	if compiled.Select("GET", "https://api.example.com/orders/12345/items/9").Empty() {
		t.Fatal("projected pattern must match the un-normalized address")
	}
}

func TestRestrictKeepsOnlyAllowedNames(t *testing.T) {
	headers := map[string]string{"ETag": "abc", "content-type": "json", "x-other": "no"}
	got := Restrict(headers, []string{"etag", "content-type"})
	if !reflect.DeepEqual(got, map[string]string{"etag": "abc", "content-type": "json"}) {
		t.Fatalf("restricted = %v", got)
	}
	if Restrict(headers, nil) != nil || Restrict(nil, []string{"etag"}) != nil {
		t.Fatal("nothing allowed must restrict to nil")
	}
}

func TestRuleWithOnlyABodyIsValidAndSelected(t *testing.T) {
	settings := Settings{Rules: []Rule{
		{ID: "a", Method: "POST", Pattern: "https://api.example.com/orders", RequestBody: true},
		{ID: "b", Method: "*", Pattern: "https://api.example.com/*", ResponseBody: true, ResponseHeaders: []string{"etag"}},
		{ID: "c", Method: "GET", Pattern: "https://api.example.com/health", RequestHeaders: []string{"accept"}},
	}}
	compiled, err := Compile(settings)
	if err != nil {
		t.Fatal(err)
	}
	post := compiled.Select("POST", "https://api.example.com/orders")
	if !post.RequestBody || !post.ResponseBody || post.Empty() {
		t.Fatalf("both rules apply to POST /orders: %+v", post)
	}
	get := compiled.Select("GET", "https://api.example.com/orders")
	if get.RequestBody || !get.ResponseBody {
		t.Fatalf("only the family rule applies to GET: %+v", get)
	}
	health := compiled.Select("GET", "https://api.example.com/health")
	if !health.ResponseBody || health.RequestBody || len(health.Request) != 1 {
		t.Fatalf("rules combine by union: %+v", health)
	}
	if other := compiled.Select("GET", "https://elsewhere.test/x"); !other.Empty() {
		t.Fatalf("an unrelated host captured something: %+v", other)
	}
	if err := (Settings{Rules: []Rule{{ID: "x", Method: "GET", Pattern: "https://a.test/*"}}}).Validate(); err == nil {
		t.Fatal("a rule that captures nothing must be refused")
	}
}
