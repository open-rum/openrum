//go:build unix

package devstack

import (
	"os"
	"testing"
	"time"
)

// supervised stands in for a host service. The command is deliberately inert:
// what is under test is the supervisor's bookkeeping, not anything a real
// service does.
func supervised() (Supervisor, Service, Environment) {
	service := Service{Name: "web", Kind: KindHost, Command: "sleep", Arguments: []string{"30"}}
	environment := Environment{values: map[string]string{"CONSOLE_PORT": "4173", "INGEST_PORT": "8081"}}
	return Supervisor{}, service, environment
}

func TestStartRecordsAnIdentifierThatStillNamesTheProcess(t *testing.T) {
	supervisor, service, environment := supervised()
	supervisor.Root = t.TempDir()
	if err := supervisor.Start(service, environment); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = supervisor.Stop(service) })

	// The identifier is read from the process handle, which is invalidated when
	// the handle is released. Recording it afterwards yields -1, and the whole
	// stack then reports a running service as stopped.
	pid, running := supervisor.Running(service)
	if pid <= 0 {
		t.Fatalf("recorded identifier is %d", pid)
	}
	if !running {
		t.Fatalf("process %d recorded but not found alive", pid)
	}
	if !alive(pid) {
		t.Fatalf("process %d is not the one that was started", pid)
	}
}

func TestStartLeavesAnAlreadyRunningServiceAlone(t *testing.T) {
	supervisor, service, environment := supervised()
	supervisor.Root = t.TempDir()
	if err := supervisor.Start(service, environment); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = supervisor.Stop(service) })
	first, _ := supervisor.Running(service)
	if err := supervisor.Start(service, environment); err != nil {
		t.Fatal(err)
	}
	second, _ := supervisor.Running(service)
	// Starting twice must not abandon the first process, which would hold its
	// port while nothing recorded it.
	if first != second {
		t.Fatalf("a second start replaced %d with %d", first, second)
	}
}

func TestStopEndsTheProcessAndForgetsIt(t *testing.T) {
	supervisor, service, environment := supervised()
	supervisor.Root = t.TempDir()
	if err := supervisor.Start(service, environment); err != nil {
		t.Fatal(err)
	}
	pid, _ := supervisor.Running(service)
	if err := supervisor.Stop(service); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		reap(pid)
		if !alive(pid) {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if alive(pid) {
		t.Fatalf("process %d survived being stopped", pid)
	}
	if _, running := supervisor.Running(service); running {
		t.Error("the service is still recorded as running")
	}
	if _, err := os.Stat(supervisor.PIDPath(service)); !os.IsNotExist(err) {
		t.Error("the identifier file outlived the process")
	}
}

func TestRunningReportsAStaleRecordAsStopped(t *testing.T) {
	supervisor, service, _ := supervised()
	supervisor.Root = t.TempDir()
	if err := os.MkdirAll(supervisor.Root+"/"+StateDirectory+"/run", 0o755); err != nil {
		t.Fatal(err)
	}
	// A record left behind by a machine that was restarted, or by a process
	// that crashed. Treating it as running would make the stack refuse to
	// start a service that is not there.
	write(t, supervisor.PIDPath(service), "999999")
	if _, running := supervisor.Running(service); running {
		t.Error("a dead identifier was reported as running")
	}
	for _, content := range []string{"", "not-a-number", "0", "-1"} {
		write(t, supervisor.PIDPath(service), content)
		if _, running := supervisor.Running(service); running {
			t.Errorf("%q was reported as running", content)
		}
	}
}

func TestStopIsQuietWhenThereIsNothingToStop(t *testing.T) {
	supervisor, service, _ := supervised()
	supervisor.Root = t.TempDir()
	if err := supervisor.Stop(service); err != nil {
		t.Fatalf("stopping an absent service failed: %v", err)
	}
}
