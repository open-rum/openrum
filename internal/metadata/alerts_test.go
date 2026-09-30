package metadata

import (
	"math"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func validRuleFixture() CreateAlertRuleInput {
	return CreateAlertRuleInput{
		Name: "Error rate spike", Metric: AlertErrorRate, Comparator: "gte", Threshold: 2,
		WindowMinutes: 5, CooldownMinutes: 30, Environment: "production", Enabled: true,
	}
}

func TestValidAlertRuleMirrorsTheDatabaseConstraints(t *testing.T) {
	if !validAlertRule(validRuleFixture()) {
		t.Fatal("the recommended rule shape was rejected")
	}
	// An empty environment means "all environments" and is allowed by the
	// alert_rules CHECK, so it must not be treated as a missing value.
	anyEnvironment := validRuleFixture()
	anyEnvironment.Environment = ""
	if !validAlertRule(anyEnvironment) {
		t.Fatal("an unscoped rule was rejected")
	}

	for name, mutate := range map[string]func(CreateAlertRuleInput) CreateAlertRuleInput{
		"unknown metric": func(input CreateAlertRuleInput) CreateAlertRuleInput {
			input.Metric = AlertMetric("p99_latency")
			return input
		},
		"unsupported window": func(input CreateAlertRuleInput) CreateAlertRuleInput {
			input.WindowMinutes = 7
			return input
		},
		"unsupported comparator": func(input CreateAlertRuleInput) CreateAlertRuleInput {
			input.Comparator = "lt"
			return input
		},
		"empty name": func(input CreateAlertRuleInput) CreateAlertRuleInput {
			input.Name = ""
			return input
		},
		"overlong name": func(input CreateAlertRuleInput) CreateAlertRuleInput {
			input.Name = strings.Repeat("n", 121)
			return input
		},
		"negative threshold": func(input CreateAlertRuleInput) CreateAlertRuleInput {
			input.Threshold = -1
			return input
		},
		"non-finite threshold": func(input CreateAlertRuleInput) CreateAlertRuleInput {
			input.Threshold = math.NaN()
			return input
		},
		"cooldown below floor": func(input CreateAlertRuleInput) CreateAlertRuleInput {
			input.CooldownMinutes = 1
			return input
		},
		"cooldown above ceiling": func(input CreateAlertRuleInput) CreateAlertRuleInput {
			input.CooldownMinutes = 1441
			return input
		},
		"malformed environment": func(input CreateAlertRuleInput) CreateAlertRuleInput {
			input.Environment = "Production"
			return input
		},
	} {
		if validAlertRule(mutate(validRuleFixture())) {
			t.Fatalf("%s was accepted", name)
		}
	}
}

func TestAlertDeepLinkTargetsThePageThatExplainsTheMetric(t *testing.T) {
	projectID := uuid.New()
	from := time.Date(2026, 9, 6, 11, 55, 0, 0, time.UTC)
	to := time.Date(2026, 9, 6, 12, 0, 0, 0, time.UTC)
	for _, testCase := range []struct {
		metric AlertMetric
		page   string
	}{
		{AlertErrorCount, "issues"},
		{AlertErrorRate, "issues"},
		{AlertAPIFailureRate, "apis"},
		{AlertLCPP75, "performance"},
		{AlertMetric("unknown"), "overview"},
	} {
		link := AlertDeepLink(projectID, testCase.metric, from, to, "production")
		want := "/projects/" + projectID.String() + "/" + testCase.page + "?"
		if !strings.HasPrefix(link, want) {
			t.Fatalf("metric %q produced %q, want prefix %q", testCase.metric, link, want)
		}
		for _, part := range []string{"to=2026-09-06T12%3A00%3A00Z", "from=2026-09-06T11%3A55%3A00Z", "environment=production"} {
			if !strings.Contains(link, part) {
				t.Fatalf("metric %q lost %s: %q", testCase.metric, part, link)
			}
		}
	}
	if strings.Contains(AlertDeepLink(projectID, AlertErrorRate, from, to, ""), "environment=") {
		t.Fatal("a rule over every environment must not pin one")
	}
}
