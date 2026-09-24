// Command openrum starts, stops and reports on a local OpenRUM stack.
//
// Compose can describe the containers but not the whole arrangement a
// contributor works in: half of a development stack runs on the host, the two
// halves have to agree about ports and credentials, and "is it up?" is a
// question about readiness rather than about processes having been launched.
// This command owns that arrangement.
package main

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"openrum/internal/devstack"
)

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	command, arguments := os.Args[1], os.Args[2:]
	if command == "help" || command == "-h" || command == "--help" {
		usage()
		return
	}
	if err := run(command, arguments); err != nil {
		fmt.Fprintf(os.Stderr, "openrum: %v\n", err)
		os.Exit(1)
	}
}

func run(command string, arguments []string) error {
	root, err := repositoryRoot()
	if err != nil {
		return err
	}
	environment, err := devstack.LoadEnvironment(root)
	if err != nil {
		return err
	}
	stack := stack{root: root, environment: environment, supervisor: devstack.Supervisor{Root: root}}
	switch command {
	case "up", "dev":
		mode, err := devstack.ParseMode(command)
		if err != nil {
			return err
		}
		return stack.start(mode)
	case "status":
		return stack.status(stack.mode())
	case "stop":
		return stack.stop()
	case "down":
		return stack.remove(devstack.ComposeDown(environment.Path), "removed the containers; volumes and their data are untouched")
	case "reset":
		confirmed := len(arguments) > 0 && arguments[0] == "--yes"
		if !confirmed && !confirm("Delete every local OpenRUM database volume?") {
			return errors.New("reset cancelled")
		}
		return stack.remove(devstack.ComposeReset(environment.Path), "removed the containers and their volumes; the next start reseeds the demo dataset")
	case "logs":
		return stack.logs(arguments)
	case "restart":
		if len(arguments) != 1 {
			return errors.New("usage: openrum restart <service>")
		}
		return stack.restart(arguments[0])
	default:
		usage()
		return fmt.Errorf("unknown command %q", command)
	}
}

type stack struct {
	root        string
	environment devstack.Environment
	supervisor  devstack.Supervisor
}

// start brings a mode up and then reports what came up. The two modes claim the
// same console port, so entering one leaves the other's half of that port
// behind on purpose: running both would mean two APIs and two consumers against
// one database, which reads as a data bug rather than as a mistake in setup.
func (stack stack) start(mode devstack.Mode) error {
	if err := preflight(mode); err != nil {
		return err
	}
	if mode == devstack.ModeDev {
		if err := stack.buildBrowserSDK(); err != nil {
			return err
		}
	}
	if mode == devstack.ModeUp {
		for _, service := range devstack.HostServicesFor(devstack.ModeDev) {
			if _, running := stack.supervisor.Running(service); running {
				fmt.Printf("stopping the host %s, which holds a port this mode needs\n", service.Name)
			}
			if err := stack.supervisor.Stop(service); err != nil {
				return err
			}
		}
	}
	if mode == devstack.ModeDev {
		if err := stack.releaseContainers(); err != nil {
			return err
		}
	}
	if err := stack.compose(devstack.ComposeUp(stack.environment.Path, mode)); err != nil {
		return fmt.Errorf("compose did not reach a ready state: %w", err)
	}
	for _, service := range devstack.HostServicesFor(mode) {
		if err := stack.startHost(service); err != nil {
			return err
		}
	}
	if err := stack.writeMode(mode); err != nil {
		return err
	}
	for _, service := range devstack.HostServicesFor(mode) {
		if err := stack.awaitHost(service); err != nil {
			return err
		}
	}
	return stack.status(mode)
}

func (stack stack) buildBrowserSDK() error {
	command := exec.Command("pnpm", "--filter", "@openrum/browser", "build")
	command.Dir = stack.root
	command.Stdout = os.Stdout
	command.Stderr = os.Stderr
	if err := command.Run(); err != nil {
		return fmt.Errorf("build Browser SDK: %w", err)
	}
	return nil
}

// releaseContainers stops the containers that belong to the other mode. They
// are excluded from this mode's Compose command, which means Compose leaves
// them alone rather than stopping them, and the proxy container would go on
// answering the console port with a build that no longer matches the source.
func (stack stack) releaseContainers() error {
	var claimed []string
	for _, service := range devstack.ServicesFor(devstack.ModeUp) {
		if service.Kind != devstack.KindContainer {
			continue
		}
		if len(service.Modes) == 1 && service.Modes[0] == devstack.ModeUp {
			claimed = append(claimed, service.Name)
		}
	}
	if len(claimed) == 0 {
		return nil
	}
	return stack.composeQuietly(devstack.ComposeStop(stack.environment.Path, claimed))
}

func (stack stack) startHost(service devstack.Service) error {
	port, hasPort, err := service.HostPort(stack.environment)
	if err != nil {
		return err
	}
	if _, running := stack.supervisor.Running(service); running {
		return nil
	}
	if hasPort {
		occupants, err := devstack.Occupants(port)
		if err == nil && len(occupants) > 0 {
			var names []string
			for _, occupant := range occupants {
				names = append(names, occupant.String())
			}
			return fmt.Errorf(
				"port %d is held by %s, which openrum did not start; stop it or set a different port in %s",
				port, strings.Join(names, ", "), stack.environment.Path,
			)
		}
	}
	return stack.supervisor.Start(service, stack.environment)
}

// awaitHost blocks until a host service is usable. Compose is asked to wait for
// its containers, and a command that returned before its host processes had
// bound their ports would report a stack as up moments before the browser found
// nothing listening.
func (stack stack) awaitHost(service devstack.Service) error {
	port, hasPort, err := service.HostPort(stack.environment)
	if err != nil || !hasPort {
		return err
	}
	deadline := time.Now().Add(45 * time.Second)
	for time.Now().Before(deadline) {
		if _, running := stack.supervisor.Running(service); !running {
			return fmt.Errorf("the host %s exited during startup; see %s", service.Name, stack.supervisor.LogPath(service))
		}
		if service.ReadyPath != "" {
			if devstack.Ready(context.Background(), port, service.ReadyPath) {
				return nil
			}
		} else if devstack.Listening(port) {
			return nil
		}
		time.Sleep(250 * time.Millisecond)
	}
	return fmt.Errorf("the host %s did not become ready; see %s", service.Name, stack.supervisor.LogPath(service))
}

func (stack stack) stop() error {
	for _, service := range devstack.HostServicesFor(devstack.ModeDev) {
		if err := stack.supervisor.Stop(service); err != nil {
			return err
		}
	}
	if err := stack.compose(devstack.ComposeStop(stack.environment.Path, nil)); err != nil {
		return err
	}
	fmt.Println("stopped; the containers and their data are still there, so the next start is quick")
	return nil
}

func (stack stack) remove(arguments []string, note string) error {
	for _, service := range devstack.HostServicesFor(devstack.ModeDev) {
		if err := stack.supervisor.Stop(service); err != nil {
			return err
		}
	}
	if err := stack.compose(arguments); err != nil {
		return err
	}
	_ = os.Remove(stack.modePath())
	fmt.Println(note)
	return nil
}

func (stack stack) logs(selection []string) error {
	hosts := make(map[string]devstack.Service)
	for _, service := range devstack.HostServicesFor(devstack.ModeDev) {
		hosts[service.Name] = service
	}
	if len(selection) == 1 {
		if service, found := hosts[selection[0]]; found {
			if stack.mode() == devstack.ModeDev {
				return stack.tail(service)
			}
		}
	}
	return stack.compose(devstack.ComposeLogs(stack.environment.Path, selection))
}

// tail follows a supervised process's log. The process writes to a file rather
// than to a terminal, because it has to outlive the terminal that started it.
func (stack stack) tail(service devstack.Service) error {
	path := stack.supervisor.LogPath(service)
	if _, err := os.Stat(path); err != nil {
		return fmt.Errorf("no log for the host %s yet", service.Name)
	}
	command := exec.Command("tail", "-n", "100", "-f", path)
	command.Stdout = os.Stdout
	command.Stderr = os.Stderr
	return command.Run()
}

func (stack stack) restart(name string) error {
	mode := stack.mode()
	for _, service := range devstack.HostServicesFor(mode) {
		if service.Name != name {
			continue
		}
		if err := stack.supervisor.Stop(service); err != nil {
			return err
		}
		if err := stack.startHost(service); err != nil {
			return err
		}
		// Waited on for the same reason a start is: the next thing the
		// developer does is reload the page.
		if err := stack.awaitHost(service); err != nil {
			return err
		}
		fmt.Printf("restarted the host %s\n", name)
		return nil
	}
	for _, service := range devstack.ServicesFor(mode) {
		if service.Name == name && service.Kind == devstack.KindContainer {
			return stack.compose(devstack.ComposeRestart(stack.environment.Path, name))
		}
	}
	return fmt.Errorf("%s is not a service this mode runs", name)
}

func (stack stack) status(mode devstack.Mode) error {
	command := exec.Command("docker", devstack.ComposeStatus(stack.environment.Path)...)
	command.Dir = stack.root
	output, err := command.Output()
	if err != nil {
		return fmt.Errorf("ask compose for status: %w", err)
	}
	reports, err := devstack.Collect(context.Background(), mode, stack.environment, stack.supervisor, output)
	if err != nil {
		return err
	}
	fmt.Printf("mode %s, environment %s\n\n", mode, stack.environment.Path)
	fmt.Print(devstack.Render(reports, interactive()))
	if blocking := devstack.Blocking(reports); len(blocking) > 0 {
		fmt.Printf("\nnot ready yet: %s\n", strings.Join(blocking, "; "))
	}
	return nil
}

func (stack stack) compose(arguments []string) error {
	command := exec.Command("docker", arguments...)
	command.Dir = stack.root
	command.Stdout = os.Stdout
	command.Stderr = os.Stderr
	command.Stdin = os.Stdin
	return command.Run()
}

func (stack stack) composeQuietly(arguments []string) error {
	command := exec.Command("docker", arguments...)
	command.Dir = stack.root
	command.Stderr = os.Stderr
	return command.Run()
}

func (stack stack) modePath() string {
	return filepath.Join(stack.root, devstack.StateDirectory, "mode")
}

// writeMode records which mode is running so a later status, restart or logs
// answers about the stack that is actually there rather than asking again.
func (stack stack) writeMode(mode devstack.Mode) error {
	if err := os.MkdirAll(filepath.Join(stack.root, devstack.StateDirectory), 0o755); err != nil {
		return err
	}
	return os.WriteFile(stack.modePath(), []byte(mode), 0o644)
}

func (stack stack) mode() devstack.Mode {
	raw, err := os.ReadFile(stack.modePath())
	if err != nil {
		return devstack.ModeUp
	}
	mode, err := devstack.ParseMode(strings.TrimSpace(string(raw)))
	if err != nil {
		return devstack.ModeUp
	}
	return mode
}

// preflight checks the tools the next command will reach for. It reports what
// is missing and how to get it, because the alternative is a failure from
// several layers down that reads as a bug in the stack. Versions are not
// checked: the toolchain requirements live in the development guide, and a
// second copy here would drift from it.
func preflight(mode devstack.Mode) error {
	if _, err := exec.LookPath("docker"); err != nil {
		return errors.New("docker is not on PATH; install Docker Engine or Docker Desktop")
	}
	if err := exec.Command("docker", "compose", "version").Run(); err != nil {
		return errors.New("docker compose v2 is unavailable; install the Compose plugin")
	}
	if err := exec.Command("docker", "info").Run(); err != nil {
		return errors.New("the docker daemon is not responding; start Docker and try again")
	}
	if mode != devstack.ModeDev {
		return nil
	}
	for tool, remedy := range map[string]string{
		"go":   "install Go, which builds the host API",
		"pnpm": "run `corepack enable`, which provides pnpm for the host console",
	} {
		if _, err := exec.LookPath(tool); err != nil {
			return fmt.Errorf("%s is not on PATH; %s", tool, remedy)
		}
	}
	return nil
}

// repositoryRoot walks up from the working directory until it finds the Compose
// file, so the command works from anywhere inside the repository.
func repositoryRoot() (string, error) {
	directory, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		if _, err := os.Stat(filepath.Join(directory, devstack.ComposeFile)); err == nil {
			return directory, nil
		}
		parent := filepath.Dir(directory)
		if parent == directory {
			return "", errors.New("run this from inside the openrum repository")
		}
		directory = parent
	}
}

func confirm(question string) bool {
	fmt.Printf("%s [y/N] ", question)
	reader := bufio.NewReader(os.Stdin)
	answer, err := reader.ReadString('\n')
	if err != nil {
		return false
	}
	answer = strings.ToLower(strings.TrimSpace(answer))
	return answer == "y" || answer == "yes"
}

// interactive reports whether output is going to a terminal, which decides
// whether hyperlink escape codes mean anything.
func interactive() bool {
	information, err := os.Stdout.Stat()
	if err != nil {
		return false
	}
	return information.Mode()&os.ModeCharDevice != 0
}

func usage() {
	fmt.Print(`openrum manages a local OpenRUM stack.

  openrum up               every service in a container, as a deployment runs it
  openrum dev              API and console on the host, everything else in containers
  openrum status           what is running, and what is not ready yet
  openrum logs [service]   follow logs; a host service tails its own file
  openrum restart <name>   restart one service
  openrum stop             stop everything, keeping the containers and their data
  openrum down             remove the containers, keeping the volumes
  openrum reset [--yes]    remove the containers and delete every local database

The two modes share one console port, so only one of them runs at a time.
Ports and credentials come from deploy/compose/.env, falling back to the
committed .env.example.
`)
}
