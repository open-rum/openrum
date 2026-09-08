package metadata

import (
	"math"
	"strings"
	"testing"
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
