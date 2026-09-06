//go:build unix

package devstack

import (
	"os/exec"
	"syscall"
)

// detach puts the child in a session of its own. Without it the child shares
// our process group, so the terminal that started the stack would deliver its
// interrupt to the whole stack, and closing that terminal would take the stack
// with it.
func detach(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
}

// terminateGroup signals the whole process group rather than the one process we
// know about. A dev server is a supervisor of its own children, and signalling
// only the parent leaves those children holding the port.
func terminateGroup(pid int, force bool) error {
	signal := syscall.SIGTERM
	if force {
		signal = syscall.SIGKILL
	}
	if err := syscall.Kill(-pid, signal); err != nil {
		// The group may already be gone while the leader lingers as a zombie.
		return syscall.Kill(pid, signal)
	}
	return nil
}

// alive reports whether a process exists. Signal zero performs the permission
// and existence checks without delivering anything.
func alive(pid int) bool {
	return syscall.Kill(pid, 0) == nil
}

// reap collects a child of this program that has already exited. A dead child
// nobody has waited for stays in the process table as a zombie, and a zombie
// still answers signal zero, so without this a service that has been stopped
// goes on reporting itself as alive. Processes we did not start are not ours to
// wait for and the resulting error is the expected answer.
func reap(pid int) {
	var status syscall.WaitStatus
	_, _ = syscall.Wait4(pid, &status, syscall.WNOHANG, nil)
}
