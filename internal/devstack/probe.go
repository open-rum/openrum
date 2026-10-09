package devstack

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

// Occupant is a process holding a port.
type Occupant struct {
	PID     int
	Command string
}

func (occupant Occupant) String() string {
	return fmt.Sprintf("%s (pid %d)", occupant.Command, occupant.PID)
}

// Listening reports whether anything accepts connections on a host port. This
// is the weakest evidence the stack uses and the only kind available for a
// service with no readiness endpoint, such as the dev server.
func Listening(ctx context.Context, port int) bool {
	connection, err := (&net.Dialer{Timeout: 300 * time.Millisecond}).DialContext(ctx, "tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		return false
	}
	_ = connection.Close()
	return true
}

// Ready asks a service whether it considers itself ready. A service that
// answers a status outside the success range is running but not usable, which
// status reports differently from being absent.
func Ready(ctx context.Context, port int, path string) bool {
	address := fmt.Sprintf("http://127.0.0.1:%d%s", port, path)
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, address, nil)
	if err != nil {
		return false
	}
	client := http.Client{Timeout: time.Second}
	response, err := client.Do(request)
	if err != nil {
		return false
	}
	defer func() { _ = response.Body.Close() }()
	return response.StatusCode >= 200 && response.StatusCode < 300
}

// Occupants names the processes listening on a port. A port conflict is only
// actionable if the report says who to talk to, so the answer carries the
// command name and not just the fact of the collision.
//
// The answer is empty and the error nil when nothing holds the port. An error
// means the question could not be asked, which callers treat as unknown rather
// than as free.
func Occupants(ctx context.Context, port int) ([]Occupant, error) {
	command := exec.CommandContext(ctx, "lsof", "-nP", fmt.Sprintf("-iTCP:%d", port), "-sTCP:LISTEN", "-F", "pc")
	output, err := command.Output()
	if err != nil {
		// lsof exits non-zero when nothing matches, which is an answer rather
		// than a failure. Anything else means we could not look.
		if command.ProcessState != nil && command.ProcessState.ExitCode() == 1 {
			return nil, nil
		}
		return nil, err
	}
	return parseOccupants(string(output)), nil
}

// parseOccupants reads lsof's field output, where each record is a set of
// lines prefixed by the field they carry: p for the process identifier and c
// for the command. Fields repeat per process, so a record is complete once the
// next process identifier appears or the output ends.
func parseOccupants(output string) []Occupant {
	var occupants []Occupant
	var current Occupant
	flush := func() {
		if current.PID != 0 {
			if current.Command == "" {
				current.Command = "unknown"
			}
			occupants = append(occupants, current)
		}
		current = Occupant{}
	}
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if len(line) < 2 {
			continue
		}
		field, value := line[0], line[1:]
		switch field {
		case 'p':
			flush()
			pid, err := strconv.Atoi(value)
			if err != nil {
				continue
			}
			current.PID = pid
		case 'c':
			current.Command = value
		}
	}
	flush()
	return occupants
}
