package event

import (
	"errors"
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
