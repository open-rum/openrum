package event_test

import (
	"errors"
	"reflect"
	"testing"

	"openrum/internal/event"
)

func TestNormalizeBehaviorAttributesWhitelistsAutomaticClickContext(t *testing.T) {
	attributes, changed, err := event.NormalizeBehaviorAttributes(event.BehaviorEventClick, map[string]string{
		"element": "BUTTON", "role": "button", "name": "checkout.submit",
		"value": "private", "text": "Card 4242 4242 4242 4242", "href": "/receipt?token=secret",
	})
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]string{"element": "button", "role": "button", "name": "checkout.submit"}
	if !changed || !reflect.DeepEqual(attributes, want) {
		t.Fatalf("changed=%v attributes=%#v", changed, attributes)
	}
}

func TestNormalizeBehaviorAttributesRejectsClickWithoutSafeElement(t *testing.T) {
	_, changed, err := event.NormalizeBehaviorAttributes(event.BehaviorEventClick, map[string]string{
		"text": "private content",
	})
	if !changed || !errors.Is(err, event.ErrInvalidBehaviorEvent) {
		t.Fatalf("changed=%v error=%v", changed, err)
	}
}

func TestNormalizeBehaviorAttributesPreservesProductCustomEvents(t *testing.T) {
	want := map[string]string{"plan": "pro", "step": "payment"}
	attributes, changed, err := event.NormalizeBehaviorAttributes("checkout.completed", want)
	if err != nil || changed || !reflect.DeepEqual(attributes, want) {
		t.Fatalf("changed=%v attributes=%#v error=%v", changed, attributes, err)
	}
}

func TestNormalizeBehaviorAttributesKeepsOnlyAShortSafeSelector(t *testing.T) {
	for _, test := range []struct {
		selector string
		kept     bool
	}{
		{"div.experiment-grid > article.experiment-card.accent-violet > button.run-button", true},
		{"main#content > button", true},
		{"a > b > c > button", false},               // four steps
		{"button.user-42", false},                   // a digit can carry data
		{"button[data-id=x]", false},                // only tag, id and class
		{"button.a.b.c.d", false},                   // more than three classes
		{"button > script:contains(secret)", false}, // not a plain step
		{"BUTTON.run", false},                       // the SDK lowercases tags
	} {
		attributes, _, err := event.NormalizeBehaviorAttributes(event.BehaviorEventClick, map[string]string{
			"element": "button", "selector": test.selector,
		})
		if err != nil {
			t.Fatal(err)
		}
		if _, ok := attributes["selector"]; ok != test.kept {
			t.Fatalf("selector %q kept=%v, want %v", test.selector, ok, test.kept)
		}
	}
}
