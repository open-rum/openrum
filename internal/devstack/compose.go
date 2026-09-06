package devstack

// ComposeFile is the stack definition, relative to the repository root.
const ComposeFile = "deploy/compose/docker-compose.yml"

// composeBase is the prefix every Compose invocation shares. The environment
// file is passed explicitly because the stack resolves the same file for host
// processes, and a Compose run that picked up a different one would put the two
// halves on different ports.
func composeBase(environmentPath string) []string {
	return []string{"compose", "--env-file", environmentPath, "-f", ComposeFile}
}

// ComposeUp builds the command that starts a mode's containers.
//
// ModeDev names the services it wants; Compose starts those plus whatever they
// depend on, which leaves the API and proxy containers alone because nothing in
// that set depends on them. Naming the wanted services rather than marking the
// unwanted ones with a profile keeps a plain `compose up` meaning "everything",
// which is what the quickstart, the README and the integration script rely on.
//
// `--wait` is the readiness a shell cannot express: it blocks until every
// healthcheck passes and every one-shot job exits successfully, and fails the
// command when one does not.
//
// `--build` is not an optimisation to skip. The migration and seed jobs run
// from the locally built image, so a code change rebuilds it, which recreates
// those containers, which reruns them. Without it a newly added migration
// would never reach an existing stack.
func ComposeUp(environmentPath string, mode Mode) []string {
	arguments := append(composeBase(environmentPath), "up", "--detach", "--build", "--wait")
	if mode == ModeDev {
		arguments = append(arguments, ContainerNamesFor(mode)...)
	}
	return arguments
}

// ComposeStop halts containers without discarding them, so the next start
// reuses the same volumes and the same built image. An empty selection stops
// every container in the project, including any the other mode left running.
func ComposeStop(environmentPath string, names []string) []string {
	return append(append(composeBase(environmentPath), "stop"), names...)
}

// ComposeDown removes the containers. Volumes survive, so the demo dataset and
// every table are still there afterwards.
func ComposeDown(environmentPath string) []string {
	return append(composeBase(environmentPath), "down")
}

// ComposeReset removes the containers and their volumes, discarding every local
// database. Callers confirm with the developer first.
func ComposeReset(environmentPath string) []string {
	return append(composeBase(environmentPath), "down", "--volumes")
}

// ComposeLogs follows container logs. An empty selection follows all of them.
func ComposeLogs(environmentPath string, names []string) []string {
	arguments := append(composeBase(environmentPath), "logs", "--follow", "--tail", "100")
	return append(arguments, names...)
}

// ComposeRestart restarts one container.
func ComposeRestart(environmentPath string, name string) []string {
	return append(composeBase(environmentPath), "restart", name)
}

// ComposeStatus asks Compose for the state of every service as JSON. It reports
// on all of them, not just the current mode's, so status can point at a
// container the other mode left behind.
func ComposeStatus(environmentPath string) []string {
	return append(composeBase(environmentPath), "ps", "--all", "--format", "json")
}
