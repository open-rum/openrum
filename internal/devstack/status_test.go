package devstack

import (
	"strings"
	"testing"
)

func TestParseComposeStatusAcceptsBothShapesComposeEmits(t *testing.T) {
	lines := []byte(`{"Service":"postgres","State":"running","Health":"healthy"}
{"Service":"kafka","State":"exited","Health":""}`)
	array := []byte(`[{"Service":"postgres","State":"running","Health":"healthy"},{"Service":"kafka","State":"exited","Health":""}]`)
	for name, output := range map[string][]byte{"lines": lines, "array": array} {
		states, err := parseComposeStatus(output)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if states["postgres"].Health != "healthy" || states["kafka"].State != "exited" {
			t.Errorf("%s: %+v", name, states)
		}
	}
}

func TestParseComposeStatusTreatsNoContainersAsAnAnswer(t *testing.T) {
	states, err := parseComposeStatus([]byte("  \n"))
	if err != nil {
		t.Fatal(err)
	}
	if len(states) != 0 {
		t.Errorf("states=%+v", states)
	}
}

func TestDescribeContainerTrustsHealthOverTheProcessBeingUp(t *testing.T) {
	cases := []struct {
		name   string
		state  containerState
		found  bool
		expect State
	}{
		{"absent", containerState{}, false, StateStopped},
		{"exited", containerState{State: "exited"}, true, StateStopped},
		{"healthy", containerState{State: "running", Health: "healthy"}, true, StateReady},
		// Running but failing its own healthcheck is not ready, and reporting it
		// as ready is how a developer ends up debugging the wrong layer.
		{"unhealthy", containerState{State: "running", Health: "unhealthy"}, true, StateStarting},
		{"starting", containerState{State: "running", Health: "starting"}, true, StateStarting},
		// No healthcheck means running is all we can honestly claim.
		{"uncheckable", containerState{State: "running"}, true, StateRunning},
	}
	for _, testCase := range cases {
		state, _ := describeContainer(testCase.state, testCase.found)
		if state != testCase.expect {
			t.Errorf("%s: state=%s, want %s", testCase.name, state, testCase.expect)
		}
	}
}

func TestRenderAlignsTheColumnsAndLinksOnlyTheConsole(t *testing.T) {
	reports := []Report{
		{Name: "postgres", Kind: KindContainer, State: StateReady, Detail: "127.0.0.1:5433"},
		{Name: "clickhouse", Kind: KindContainer, State: StateStarting, Detail: "healthcheck starting"},
		{Name: "web", Kind: KindHost, State: StateRunning, Detail: "pid 42", URL: "http://127.0.0.1:4173"},
	}
	plain := Render(reports, false)
	lines := strings.Split(strings.TrimRight(plain, "\n"), "\n")
	if len(lines) != 4 {
		t.Fatalf("lines=%d", len(lines))
	}
	// The longest name sets the column, so every state starts at one offset.
	offset := strings.Index(lines[0], "STATE")
	for _, line := range lines[1:] {
		if !strings.Contains(line, strings.Repeat(" ", 1)) {
			t.Fatalf("no padding in %q", line)
		}
		field := strings.Fields(line)
		if strings.Index(line, field[2]) != offset {
			t.Errorf("state column of %q starts at %d, want %d", line, strings.Index(line, field[2]), offset)
		}
	}
	if strings.Contains(plain, "\x1b]8") {
		t.Error("escape codes were written to a destination that cannot interpret them")
	}
	if !strings.Contains(plain, "http://127.0.0.1:4173") {
		t.Error("the console address is missing when links are off")
	}

	linked := Render(reports, true)
	if !strings.Contains(linked, "\x1b]8;;http://127.0.0.1:4173\x1b\\http://127.0.0.1:4173\x1b]8;;\x1b\\") {
		t.Errorf("console not hyperlinked: %q", linked)
	}
	// Only the console; wrapping a bare address in a link invites a click that
	// opens a Postgres port in a browser.
	if strings.Count(linked, "\x1b]8;;") != 2 {
		t.Errorf("more than the console was linked: %q", linked)
	}
}

func TestBlockingNamesOnlyWhatStandsInTheWay(t *testing.T) {
	reports := []Report{
		{Name: "postgres", State: StateReady},
		{Name: "consumer", State: StateRunning},
		{Name: "kafka", State: StateStarting, Detail: "healthcheck failing"},
		{Name: "web", State: StateForeign, Detail: "held by node (pid 9)"},
	}
	blocking := Blocking(reports)
	if len(blocking) != 2 {
		t.Fatalf("blocking=%v", blocking)
	}
	joined := strings.Join(blocking, "; ")
	for _, expected := range []string{"kafka is starting: healthcheck failing", "web is foreign: held by node (pid 9)"} {
		if !strings.Contains(joined, expected) {
			t.Errorf("%q missing from %q", expected, joined)
		}
	}
	// A service with no readiness endpoint is running and that is the most that
	// can be said; calling it blocking would make status permanently unhappy.
	if strings.Contains(joined, "consumer") {
		t.Errorf("a running service was reported as blocking: %q", joined)
	}
}

func TestParseOccupantsNamesEveryProcessHoldingThePort(t *testing.T) {
	occupants := parseOccupants("p1234\ncnode\np5678\ncopenrum-api\n")
	if len(occupants) != 2 {
		t.Fatalf("occupants=%+v", occupants)
	}
	if occupants[0].PID != 1234 || occupants[0].Command != "node" {
		t.Errorf("first=%+v", occupants[0])
	}
	if occupants[1].PID != 5678 || occupants[1].Command != "openrum-api" {
		t.Errorf("second=%+v", occupants[1])
	}
	if got := occupants[0].String(); got != "node (pid 1234)" {
		t.Errorf("description=%q", got)
	}
}

func TestParseOccupantsSurvivesOutputItCannotFullyRead(t *testing.T) {
	if occupants := parseOccupants(""); len(occupants) != 0 {
		t.Errorf("empty output produced %+v", occupants)
	}
	// A process identifier with no command still answers the question that
	// matters, which is who to go and stop.
	occupants := parseOccupants("p42\n")
	if len(occupants) != 1 || occupants[0].Command != "unknown" {
		t.Errorf("occupants=%+v", occupants)
	}
	if occupants := parseOccupants("pnotanumber\ncnode\n"); len(occupants) != 0 {
		t.Errorf("unparsable identifier accepted: %+v", occupants)
	}
}
