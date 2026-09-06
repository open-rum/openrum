package devstack

import (
	"fmt"
	"sort"
)

// Mode is the shape of a running stack. The two modes differ in which processes
// you are debugging, so the caller names one rather than letting the stack
// guess: `up` is what a reviewer runs, `dev` is what an author runs.
type Mode string

const (
	// ModeUp runs every service as a container, including the API and the
	// bundled proxy. This is the arrangement a deployment uses.
	ModeUp Mode = "up"
	// ModeDev runs the API and the console on the host, against containerised
	// infrastructure and pipeline services.
	ModeDev Mode = "dev"
)

// HostAPIPort is where the host API listens under ModeDev. It matches the port
// the API container uses internally, so the health path and any hard-coded
// developer bookmark work the same in both modes.
const HostAPIPort = 8080

// Kind distinguishes a service the stack starts through Compose from one it
// supervises itself.
type Kind string

const (
	KindContainer Kind = "container"
	KindHost      Kind = "host"
)

// Service is one entry in the stack: enough to start it, probe it, and name it
// in status output.
type Service struct {
	Name string
	Kind Kind
	// Modes lists the modes that run this service. Infrastructure runs in both;
	// the API runs as a container in one mode and a host process in the other,
	// which is why the two appear as separate entries.
	Modes []Mode
	// PortName is the environment variable holding the published host port, for
	// services reachable from the host. Empty means the service has no host
	// port and is judged by its container health alone.
	PortName string
	// Port overrides PortName for host processes, whose ports are ours to pick
	// rather than Compose's to publish.
	Port int
	// ReadyPath is an HTTP path answering with the service's readiness. Empty
	// means a listening port is the whole of the evidence available.
	ReadyPath string
	// Command and Arguments start a host service. Unused for containers.
	Command   string
	Arguments []string
	// Build, when set, is a `go build` target compiled before the service runs.
	// Running the binary rather than `go run` keeps one process under one PID,
	// which is what makes a host service stoppable.
	Build string
	// Console marks the service that serves the browser-facing console, whose
	// URL is worth printing as a link.
	Console bool
}

// services is the whole stack. Order is the order status reports, which runs
// from the storage a failure originates in up to the console it surfaces in.
var services = []Service{
	{Name: "postgres", Kind: KindContainer, Modes: []Mode{ModeUp, ModeDev}, PortName: "POSTGRES_PORT"},
	{Name: "clickhouse", Kind: KindContainer, Modes: []Mode{ModeUp, ModeDev}, PortName: "CLICKHOUSE_NATIVE_PORT"},
	{Name: "kafka", Kind: KindContainer, Modes: []Mode{ModeUp, ModeDev}, PortName: "KAFKA_PORT"},
	{Name: "redis", Kind: KindContainer, Modes: []Mode{ModeUp, ModeDev}, PortName: "REDIS_PORT"},
	{Name: "ingest", Kind: KindContainer, Modes: []Mode{ModeUp, ModeDev}, PortName: "INGEST_PORT", ReadyPath: "/health/ready"},
	{Name: "consumer", Kind: KindContainer, Modes: []Mode{ModeUp, ModeDev}},
	{Name: "worker", Kind: KindContainer, Modes: []Mode{ModeUp, ModeDev}},
	{Name: "api", Kind: KindContainer, Modes: []Mode{ModeUp}},
	{Name: "web", Kind: KindContainer, Modes: []Mode{ModeUp}, PortName: "CONSOLE_PORT", ReadyPath: "/health/ready", Console: true},
	{
		Name:      "api",
		Kind:      KindHost,
		Modes:     []Mode{ModeDev},
		Port:      HostAPIPort,
		ReadyPath: "/health/ready",
		Build:     "./services/api/cmd/api",
	},
	{
		Name:      "web",
		Kind:      KindHost,
		Modes:     []Mode{ModeDev},
		PortName:  "CONSOLE_PORT",
		Command:   "pnpm",
		Arguments: []string{"--filter", "@openrum/web", "dev"},
		Console:   true,
	},
}

// ServicesFor lists the services a mode runs, in report order.
func ServicesFor(mode Mode) []Service {
	selected := make([]Service, 0, len(services))
	for _, service := range services {
		for _, candidate := range service.Modes {
			if candidate == mode {
				selected = append(selected, service)
				break
			}
		}
	}
	return selected
}

// HostServicesFor lists only the services the stack supervises itself.
func HostServicesFor(mode Mode) []Service {
	selected := make([]Service, 0, 2)
	for _, service := range ServicesFor(mode) {
		if service.Kind == KindHost {
			selected = append(selected, service)
		}
	}
	return selected
}

// ContainerNamesFor lists the Compose service names a mode starts, sorted so
// the argument list a command is built from is stable.
func ContainerNamesFor(mode Mode) []string {
	names := make([]string, 0, len(services))
	for _, service := range ServicesFor(mode) {
		if service.Kind == KindContainer {
			names = append(names, service.Name)
		}
	}
	sort.Strings(names)
	return names
}

// HostPort answers with the port a service occupies on the host, and whether it
// occupies one at all.
func (service Service) HostPort(environment Environment) (int, bool, error) {
	if service.Port != 0 {
		return service.Port, true, nil
	}
	if service.PortName == "" {
		return 0, false, nil
	}
	port, err := environment.Port(service.PortName)
	if err != nil {
		return 0, false, err
	}
	return port, true, nil
}

// ParseMode reads a mode from a command name.
func ParseMode(name string) (Mode, error) {
	switch Mode(name) {
	case ModeUp:
		return ModeUp, nil
	case ModeDev:
		return ModeDev, nil
	default:
		return "", fmt.Errorf("unknown mode %q", name)
	}
}
