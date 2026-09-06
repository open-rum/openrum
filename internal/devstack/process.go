package devstack

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// StateDirectory holds the PIDs, logs and binaries of supervised host
// processes. It sits at the repository root and is ignored by git.
const StateDirectory = ".openrum"

// Supervisor starts and stops the host half of a dev stack. A supervised
// process is detached from the terminal that started it, so closing that
// terminal does not take the stack down with it, and its whole process group is
// recorded so stopping it does not leave a child behind.
type Supervisor struct {
	Root string
}

// PIDPath is where a service's process identifier is recorded.
func (supervisor Supervisor) PIDPath(service Service) string {
	return filepath.Join(supervisor.Root, StateDirectory, "run", service.Name+".pid")
}

// LogPath is where a service's output is collected. Both streams go to one
// file, in the order the process wrote them.
func (supervisor Supervisor) LogPath(service Service) string {
	return filepath.Join(supervisor.Root, StateDirectory, "log", service.Name+".log")
}

func (supervisor Supervisor) binaryPath(service Service) string {
	return filepath.Join(supervisor.Root, StateDirectory, "bin", service.Name)
}

// Running answers with the process identifier of a supervised service, and
// whether it is still alive. A recorded process that has since exited is
// reported as not running and its record is left for Start to overwrite.
func (supervisor Supervisor) Running(service Service) (int, bool) {
	raw, err := os.ReadFile(supervisor.PIDPath(service))
	if err != nil {
		return 0, false
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(raw)))
	if err != nil || pid <= 0 {
		return 0, false
	}
	reap(pid)
	if !alive(pid) {
		return pid, false
	}
	return pid, true
}

// Start builds a service when it needs building and launches it. Already
// running is success: the command is about ensuring the stack is up, and a
// developer who wants a fresh process asks for a restart.
func (supervisor Supervisor) Start(service Service, environment Environment) error {
	if _, running := supervisor.Running(service); running {
		return nil
	}
	for _, directory := range []string{"run", "log", "bin"} {
		if err := os.MkdirAll(filepath.Join(supervisor.Root, StateDirectory, directory), 0o755); err != nil {
			return err
		}
	}
	command := service.Command
	arguments := service.Arguments
	if service.Build != "" {
		// Compiled and then run, rather than handed to `go run`. `go run`
		// launches the built binary as a child of itself, so signalling it
		// stops the wrapper and leaves the server holding the port.
		binary := supervisor.binaryPath(service)
		build := exec.Command("go", "build", "-o", binary, service.Build)
		build.Dir = supervisor.Root
		build.Stdout = os.Stderr
		build.Stderr = os.Stderr
		if err := build.Run(); err != nil {
			return fmt.Errorf("build %s: %w", service.Name, err)
		}
		command = binary
		arguments = nil
	}
	values, err := environment.HostServiceEnvironment(service)
	if err != nil {
		return err
	}
	log, err := os.OpenFile(supervisor.LogPath(service), os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return err
	}
	defer func() { _ = log.Close() }()
	process := exec.Command(command, arguments...)
	process.Dir = supervisor.Root
	process.Env = append(os.Environ(), values...)
	process.Stdout = log
	process.Stderr = log
	detach(process)
	if err := process.Start(); err != nil {
		return fmt.Errorf("start %s: %w", service.Name, err)
	}
	// Read before releasing, which invalidates the handle and with it the
	// identifier we are about to record.
	pid := process.Process.Pid
	// Not waited on: the process is meant to outlive this command. Releasing it
	// hands reaping to init rather than leaving a zombie behind when we exit.
	if err := process.Process.Release(); err != nil {
		return err
	}
	return os.WriteFile(supervisor.PIDPath(service), []byte(strconv.Itoa(pid)), 0o644)
}

// Stop ends a supervised service. It asks first and insists after: a dev server
// given a chance to exit cleanly releases its port and flushes its log, and one
// that ignores the request still has to go, because the port is needed.
func (supervisor Supervisor) Stop(service Service) error {
	pid, running := supervisor.Running(service)
	if pid == 0 {
		return nil
	}
	defer func() { _ = os.Remove(supervisor.PIDPath(service)) }()
	if !running {
		return nil
	}
	if err := terminateGroup(pid, false); err != nil && !errors.Is(err, os.ErrProcessDone) {
		return err
	}
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		reap(pid)
		if !alive(pid) {
			return nil
		}
		time.Sleep(50 * time.Millisecond)
	}
	return terminateGroup(pid, true)
}

// Owns answers whether a process identifier belongs to a service this
// supervisor started. Port conflicts are reported differently depending on the
// answer: a stale process of ours is ours to clear, and anything else is the
// developer's to decide about.
func (supervisor Supervisor) Owns(pid int) bool {
	for _, service := range HostServicesFor(ModeDev) {
		if recorded, _ := supervisor.Running(service); recorded == pid && pid != 0 {
			return true
		}
	}
	return false
}
