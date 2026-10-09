package devstack

import (
	"slices"
	"strings"
	"testing"
)

func TestDevRunsTheApiAndConsoleOnTheHostAndNothingElseTwice(t *testing.T) {
	dev := ServicesFor(ModeDev)
	kinds := make(map[string][]Kind)
	for _, service := range dev {
		kinds[service.Name] = append(kinds[service.Name], service.Kind)
	}
	for _, name := range []string{"api", "web"} {
		if got := kinds[name]; len(got) != 1 || got[0] != KindHost {
			t.Errorf("dev runs %s as %v, want one host entry", name, got)
		}
	}
	// Running a container and a host process for the same service would put two
	// APIs on one database, which is the ambiguity the mode split removes.
	for name, entries := range kinds {
		if len(entries) > 1 {
			t.Errorf("dev runs %s %d times: %v", name, len(entries), entries)
		}
	}
}

func TestUpRunsEverythingInAContainer(t *testing.T) {
	for _, service := range ServicesFor(ModeUp) {
		if service.Kind != KindContainer {
			t.Errorf("up runs %s as %s", service.Name, service.Kind)
		}
	}
	names := ContainerNamesFor(ModeUp)
	for _, expected := range []string{"api", "web", "ingest", "consumer", "worker", "postgres", "clickhouse", "kafka", "redis"} {
		if !slices.Contains(names, expected) {
			t.Errorf("up omits %s", expected)
		}
	}
}

func TestDevExcludesTheServicesItRunsOnTheHost(t *testing.T) {
	dev := ContainerNamesFor(ModeDev)
	for _, name := range []string{"api", "web"} {
		if slices.Contains(dev, name) {
			t.Errorf("dev starts the %s container, which it runs on the host", name)
		}
	}
	// Everything else has to stay, because the host half depends on all of it.
	for _, name := range []string{"postgres", "clickhouse", "kafka", "redis", "ingest", "consumer", "worker"} {
		if !slices.Contains(dev, name) {
			t.Errorf("dev omits %s", name)
		}
	}
}

func TestConsoleIsClaimedOncePerModeAndAlwaysOnTheSamePort(t *testing.T) {
	environment := Environment{values: map[string]string{"CONSOLE_PORT": "4173"}}
	for _, mode := range []Mode{ModeUp, ModeDev} {
		var consoles []Service
		for _, service := range ServicesFor(mode) {
			if service.Console {
				consoles = append(consoles, service)
			}
		}
		if len(consoles) != 1 {
			t.Fatalf("%s has %d consoles", mode, len(consoles))
		}
		port, hasPort, err := consoles[0].HostPort(environment)
		if err != nil {
			t.Fatal(err)
		}
		if !hasPort || port != 4173 {
			t.Errorf("%s console on port %d (present %v), want 4173", mode, port, hasPort)
		}
	}
}

func TestHostPortPrefersAnExplicitPortOverAPublishedOne(t *testing.T) {
	environment := Environment{values: map[string]string{"CONSOLE_PORT": "4173"}}
	api := Service{Name: "api", Kind: KindHost, Port: HostAPIPort}
	port, hasPort, err := api.HostPort(environment)
	if err != nil || !hasPort || port != HostAPIPort {
		t.Fatalf("port=%d present=%v err=%v", port, hasPort, err)
	}
	silent := Service{Name: "consumer", Kind: KindContainer}
	if _, hasPort, err := silent.HostPort(environment); err != nil || hasPort {
		t.Fatalf("a service with no published port claimed one: %v %v", hasPort, err)
	}
}

func TestHostServicesCanAllBeBuiltOrLaunched(t *testing.T) {
	for _, service := range HostServicesFor(ModeDev) {
		if service.Build == "" && service.Command == "" {
			t.Errorf("%s has neither a build target nor a command", service.Name)
		}
		if service.Build != "" && service.Command != "" {
			t.Errorf("%s has both a build target and a command", service.Name)
		}
	}
}

func TestParseModeRejectsAnythingButTheTwoModes(t *testing.T) {
	for _, name := range []string{"up", "dev"} {
		if _, err := ParseMode(name); err != nil {
			t.Errorf("%s rejected: %v", name, err)
		}
	}
	for _, name := range []string{"", "start", "UP", "production"} {
		if _, err := ParseMode(name); err == nil {
			t.Errorf("accepted %q as a mode", name)
		}
	}
}

func TestComposeUpSelectsServicesOnlyForTheModeThatNeedsFewer(t *testing.T) {
	const path = "deploy/compose/.env"
	up := ComposeUp(path, ModeUp)
	dev := strings.Join(ComposeUp(path, ModeDev), " ")
	// An unqualified `up` has to keep meaning "everything", because the
	// quickstart, the README, the Makefile and the integration script all run
	// Compose directly and would otherwise stop starting the console.
	if last := up[len(up)-1]; strings.HasPrefix(last, "-") == false {
		t.Errorf("up names individual services: %v", up)
	}
	// Dev names what it wants so that Compose leaves the API and proxy
	// containers alone rather than starting them against their host twins.
	for _, name := range ContainerNamesFor(ModeDev) {
		if !strings.Contains(dev, " "+name) {
			t.Errorf("dev does not select %s: %s", name, dev)
		}
	}
	for _, name := range []string{" api", " web"} {
		if strings.HasSuffix(dev, name) || strings.Contains(dev, name+" ") {
			t.Errorf("dev selects%s: %s", name, dev)
		}
	}
	for _, arguments := range [][]string{ComposeUp(path, ModeUp), ComposeUp(path, ModeDev)} {
		joined := strings.Join(arguments, " ")
		if !strings.Contains(joined, "--env-file "+path) {
			t.Errorf("environment file missing: %s", joined)
		}
		// --wait is the readiness the command exists to provide, and --build is
		// what makes a new migration reach an existing stack.
		for _, flag := range []string{"--wait", "--build", "--detach"} {
			if !strings.Contains(joined, flag) {
				t.Errorf("%s missing from: %s", flag, joined)
			}
		}
	}
}

func TestDestructiveAndInspectingCommandsCoverTheWholeProject(t *testing.T) {
	const path = "deploy/compose/.env"
	commands := map[string][]string{
		"stop":    ComposeStop(path, nil),
		"down":    ComposeDown(path),
		"reset":   ComposeReset(path),
		"logs":    ComposeLogs(path, nil),
		"status":  ComposeStatus(path),
		"restart": ComposeRestart(path, "api"),
	}
	for name, arguments := range commands {
		joined := strings.Join(arguments, " ")
		if !strings.Contains(joined, "--env-file "+path) {
			t.Errorf("%s does not pass the environment file: %s", name, joined)
		}
		// A container the other mode started is still a container of ours, so
		// none of these may narrow themselves to one mode's selection.
		for _, name := range ContainerNamesFor(ModeDev) {
			if strings.HasSuffix(joined, " "+name) {
				t.Errorf("%s narrowed itself to one mode's services: %s", name, joined)
			}
		}
	}
	if !strings.Contains(strings.Join(ComposeStatus(path), " "), "--all") {
		t.Error("status hides containers that are not running")
	}
	if !strings.Contains(strings.Join(ComposeReset(path), " "), "--volumes") {
		t.Error("reset does not remove volumes")
	}
	if strings.Contains(strings.Join(ComposeDown(path), " "), "--volumes") {
		t.Error("down removes volumes, which would discard data the developer kept")
	}
}

func TestComposeLogsPassesASelectionThrough(t *testing.T) {
	arguments := ComposeLogs("env", []string{"ingest", "consumer"})
	joined := strings.Join(arguments, " ")
	if !strings.HasSuffix(joined, "ingest consumer") {
		t.Errorf("selection not appended: %s", joined)
	}
	if !strings.Contains(joined, "--follow") {
		t.Errorf("logs do not follow: %s", joined)
	}
}

func TestSeedRunsTheGeneratorOnceAndLeavesTheRunningStackAlone(t *testing.T) {
	joined := strings.Join(ComposeSeed("deploy/compose/.env"), " ")
	for _, want := range []string{"--profile seed", "--env-file deploy/compose/.env", " run --rm --no-deps ", "demo-seed"} {
		if !strings.Contains(joined, want) {
			t.Errorf("seed command is missing %q: %s", want, joined)
		}
	}
	// A plain `up` has to stay free of the generator, or every start would
	// load the demo dataset again.
	if strings.Contains(strings.Join(ComposeUp("env", ModeUp), " "), "demo-seed") {
		t.Error("up names the demo generator")
	}
}
