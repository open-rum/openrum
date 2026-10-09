package devstack

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

// State is how much evidence there is that a service is usable.
type State string

const (
	// StateReady means the service answered its own readiness endpoint.
	StateReady State = "ready"
	// StateStarting means it holds its port but does not yet call itself ready.
	StateStarting State = "starting"
	// StateRunning means it is up and offers no readiness endpoint to ask.
	StateRunning State = "running"
	// StateStopped means nothing of ours is there.
	StateStopped State = "stopped"
	// StateForeign means its port is held by a process the stack did not start.
	// Reported separately because the fix is a conversation with that process,
	// not another start.
	StateForeign State = "foreign"
)

// Report is one row of status.
type Report struct {
	Name   string
	Kind   Kind
	State  State
	Detail string
	// URL is set for the console, the one service worth opening.
	URL string
}

// containerState is the part of `compose ps` output the stack reads.
type containerState struct {
	Service string `json:"Service"`
	State   string `json:"State"`
	Health  string `json:"Health"`
}

// parseComposeStatus reads `compose ps --format json`, which emits either one
// JSON object per line or a single array depending on the Compose version.
// Both shapes are accepted so the stack does not depend on that detail.
func parseComposeStatus(output []byte) (map[string]containerState, error) {
	states := make(map[string]containerState)
	trimmed := bytes.TrimSpace(output)
	if len(trimmed) == 0 {
		return states, nil
	}
	if trimmed[0] == '[' {
		var entries []containerState
		if err := json.Unmarshal(trimmed, &entries); err != nil {
			return nil, err
		}
		for _, entry := range entries {
			states[entry.Service] = entry
		}
		return states, nil
	}
	for _, line := range bytes.Split(trimmed, []byte("\n")) {
		line = bytes.TrimSpace(line)
		if len(line) == 0 {
			continue
		}
		var entry containerState
		if err := json.Unmarshal(line, &entry); err != nil {
			return nil, err
		}
		states[entry.Service] = entry
	}
	return states, nil
}

// describeContainer turns Compose's state and health into ours. Health is the
// stronger signal and wins when present; a container with no healthcheck is
// only ever reported as running.
func describeContainer(state containerState, found bool) (State, string) {
	if !found || state.State == "" {
		return StateStopped, ""
	}
	if state.State != "running" {
		return StateStopped, state.State
	}
	switch state.Health {
	case "healthy":
		return StateReady, ""
	case "starting":
		return StateStarting, "healthcheck starting"
	case "unhealthy":
		return StateStarting, "healthcheck failing"
	default:
		return StateRunning, ""
	}
}

// Collect gathers the state of every service a mode runs. Containers are judged
// by Compose, which already knows their healthchecks; host processes are judged
// by our own record of them plus whatever their port is willing to say.
func Collect(ctx context.Context, mode Mode, environment Environment, supervisor Supervisor, composeStatus []byte) ([]Report, error) {
	containers, err := parseComposeStatus(composeStatus)
	if err != nil {
		return nil, fmt.Errorf("read compose status: %w", err)
	}
	console, err := environment.ConsoleURL()
	if err != nil {
		return nil, err
	}
	reports := make([]Report, 0, len(services))
	for _, service := range ServicesFor(mode) {
		port, hasPort, err := service.HostPort(environment)
		if err != nil {
			return nil, err
		}
		report := Report{Name: service.Name, Kind: service.Kind}
		if service.Console {
			report.URL = console
		}
		switch service.Kind {
		case KindContainer:
			state, found := containers[service.Name]
			report.State, report.Detail = describeContainer(state, found)
		case KindHost:
			report.State, report.Detail = describeHost(ctx, service, supervisor, port, hasPort)
		}
		if hasPort && report.Detail == "" {
			report.Detail = fmt.Sprintf("127.0.0.1:%d", port)
		}
		reports = append(reports, report)
	}
	return reports, nil
}

func describeHost(ctx context.Context, service Service, supervisor Supervisor, port int, hasPort bool) (State, string) {
	pid, running := supervisor.Running(service)
	if !running {
		if hasPort {
			if occupants, err := Occupants(ctx, port); err == nil && len(occupants) > 0 {
				return StateForeign, describeOccupants(occupants)
			}
		}
		return StateStopped, ""
	}
	detail := fmt.Sprintf("pid %d", pid)
	if hasPort {
		detail = fmt.Sprintf("pid %d, 127.0.0.1:%d", pid, port)
	}
	if service.ReadyPath != "" && hasPort {
		if Ready(ctx, port, service.ReadyPath) {
			return StateReady, detail
		}
		return StateStarting, detail
	}
	if hasPort && !Listening(ctx, port) {
		return StateStarting, detail
	}
	return StateRunning, detail
}

func describeOccupants(occupants []Occupant) string {
	names := make([]string, 0, len(occupants))
	for _, occupant := range occupants {
		names = append(names, occupant.String())
	}
	sort.Strings(names)
	return "held by " + strings.Join(names, ", ")
}

// Render lays the reports out as a table. When links is true the console
// address is wrapped in an OSC 8 hyperlink so a terminal that understands them
// makes it clickable; when it is false, as in a pipe or a log, the address is
// printed plainly rather than wrapped in escape codes nothing will interpret.
func Render(reports []Report, links bool) string {
	headers := []string{"SERVICE", "WHERE", "STATE", "DETAIL"}
	rows := make([][]string, 0, len(reports))
	for _, report := range reports {
		detail := report.Detail
		if report.URL != "" {
			detail = hyperlink(report.URL, links)
		}
		rows = append(rows, []string{report.Name, string(report.Kind), string(report.State), detail})
	}
	// The detail column is last and unpadded, so its width never matters and an
	// escape sequence inside it cannot throw the alignment off.
	widths := make([]int, len(headers)-1)
	for index := range widths {
		widths[index] = len(headers[index])
		for _, row := range rows {
			if len(row[index]) > widths[index] {
				widths[index] = len(row[index])
			}
		}
	}
	var builder strings.Builder
	writeRow(&builder, headers, widths)
	for _, row := range rows {
		writeRow(&builder, row, widths)
	}
	return builder.String()
}

func writeRow(builder *strings.Builder, row []string, widths []int) {
	for index, cell := range row {
		if index < len(widths) {
			fmt.Fprintf(builder, "%-*s  ", widths[index], cell)
			continue
		}
		builder.WriteString(cell)
	}
	builder.WriteString("\n")
}

func hyperlink(address string, links bool) string {
	if !links {
		return address
	}
	return "\x1b]8;;" + address + "\x1b\\" + address + "\x1b]8;;\x1b\\"
}

// Blocking reports the services that stand between the stack and being usable,
// so a command can end with the reason rather than a bare failure.
func Blocking(reports []Report) []string {
	var blocking []string
	for _, report := range reports {
		if report.State == StateReady || report.State == StateRunning {
			continue
		}
		detail := report.Detail
		if detail != "" {
			detail = ": " + detail
		}
		blocking = append(blocking, fmt.Sprintf("%s is %s%s", report.Name, report.State, detail))
	}
	return blocking
}
