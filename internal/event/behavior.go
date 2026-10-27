package event

import (
	"errors"
	"regexp"
	"strings"

	"openrum/internal/privacy"
)

var ErrInvalidBehaviorEvent = errors.New("invalid behavior event")

const BehaviorEventClick = "ui.click"

var (
	allowedBehaviorElements = map[string]struct{}{
		"a": {}, "button": {}, "input": {}, "select": {}, "textarea": {}, "summary": {}, "custom": {},
	}
	allowedBehaviorRoles = map[string]struct{}{
		"button": {}, "link": {}, "menuitem": {}, "tab": {},
	}
	allowedBehaviorInputTypes = map[string]struct{}{
		"button": {}, "checkbox": {}, "radio": {}, "reset": {}, "submit": {}, "file": {},
	}
)

// behaviorSelector is the SDK's short CSS path to a click: up to three `tag#id.class` steps
// joined by " > ". Ids and classes carry no digits, which the SDK already drops because those are
// usually generated or hold data; anything else is left out rather than stored.
var behaviorSelector = regexp.MustCompile(`^[a-z][a-z0-9-]*(#[A-Za-z_-]{1,40})?(\.[A-Za-z_-]{1,40}){0,3}( > [a-z][a-z0-9-]*(#[A-Za-z_-]{1,40})?(\.[A-Za-z_-]{1,40}){0,3}){0,2}$`)

const maxBehaviorSelector = 200

// NormalizeBehaviorAttributes applies the stricter schema used by automatic SDK behavior events.
// Product-defined custom events keep the general custom-event attribute contract.
func NormalizeBehaviorAttributes(name string, attributes map[string]string) (map[string]string, bool, error) {
	if name != BehaviorEventClick {
		return attributes, false, nil
	}
	element := normalizedBehaviorToken(attributes["element"], allowedBehaviorElements)
	if element == "" {
		return nil, true, ErrInvalidBehaviorEvent
	}
	result := map[string]string{"element": element}
	if role := normalizedBehaviorToken(attributes["role"], allowedBehaviorRoles); role != "" {
		result["role"] = role
	}
	if inputType := normalizedBehaviorToken(attributes["input_type"], allowedBehaviorInputTypes); inputType != "" && element == "input" {
		result["input_type"] = inputType
	}
	if explicitName, _ := privacy.ScrubString(attributes["name"], 64); explicitName != "" {
		result["name"] = explicitName
	}
	if selector := attributes["selector"]; len(selector) <= maxBehaviorSelector && behaviorSelector.MatchString(selector) {
		result["selector"] = selector
	}
	return result, !equalStringMap(result, attributes), nil
}

func normalizedBehaviorToken(value string, allowed map[string]struct{}) string {
	normalized := strings.ToLower(strings.TrimSpace(value))
	if _, ok := allowed[normalized]; ok {
		return normalized
	}
	return ""
}

func equalStringMap(left, right map[string]string) bool {
	if len(left) != len(right) {
		return false
	}
	for key, value := range left {
		if right[key] != value {
			return false
		}
	}
	return true
}
