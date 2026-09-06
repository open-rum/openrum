//go:build !unix

package devstack

import (
	"errors"
	"os/exec"
)

// The stack supervises host processes through sessions and process groups,
// which Windows has no equivalent of. Windows developers run the repository
// under WSL, where this file does not apply.
var errUnsupportedPlatform = errors.New("openrum supervises host processes on macOS and Linux only; on Windows use WSL")

func detach(*exec.Cmd) {}

func terminateGroup(int, bool) error { return errUnsupportedPlatform }

func alive(int) bool { return false }

func reap(int) {}
