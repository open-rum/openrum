package handlers

import "testing"

func TestSafeServerReturnToRejectsExternalAndAuthLoops(t *testing.T) {
	for _, scenario := range []struct{ input, want string }{
		{"/projects/one?from=2026-09-01#events", "/projects/one?from=2026-09-01#events"},
		{"https://evil.example/path", "/"},
		{"//evil.example/path", "/"},
		{"/\\evil.example/path", "/"},
		{"/%2F%2Fevil.example/path", "/"},
		{"/login?returnTo=/projects", "/"},
		{"/awaiting-access", "/"},
	} {
		if got := safeServerReturnTo(scenario.input); got != scenario.want {
			t.Errorf("returnTo %q: got %q, want %q", scenario.input, got, scenario.want)
		}
	}
}
