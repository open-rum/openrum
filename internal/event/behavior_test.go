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
