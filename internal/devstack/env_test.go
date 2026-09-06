package devstack

import (
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"
)

func TestLoadEnvironmentPrefersTheDeveloperFileOverTheExample(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "deploy", "compose"), 0o755); err != nil {
		t.Fatal(err)
	}
	write(t, filepath.Join(root, EnvironmentExample), "CONSOLE_PORT=4173\n")
	environment, err := LoadEnvironment(root)
	if err != nil {
		t.Fatal(err)
	}
	if environment.Value("CONSOLE_PORT") != "4173" {
		t.Fatalf("example not read: %q", environment.Value("CONSOLE_PORT"))
	}

	write(t, filepath.Join(root, EnvironmentFile), "CONSOLE_PORT=4999\n")
	environment, err = LoadEnvironment(root)
	if err != nil {
		t.Fatal(err)
	}
	if environment.Value("CONSOLE_PORT") != "4999" {
		t.Fatalf("developer file ignored: %q", environment.Value("CONSOLE_PORT"))
	}
}

func TestParseEnvironmentReadsTheFormatComposeAccepts(t *testing.T) {
	values, err := parseEnvironment(strings.NewReader(strings.Join([]string{
		"# a comment",
		"",
		"PLAIN=value",
		"export EXPORTED=value",
		`QUOTED="spaced value"`,
		"SINGLE='value'",
		"EMPTY=",
		"WITH_EQUALS=key=value",
	}, "\n")))
	if err != nil {
		t.Fatal(err)
	}
	expected := map[string]string{
		"PLAIN":       "value",
		"EXPORTED":    "value",
		"QUOTED":      "spaced value",
		"SINGLE":      "value",
		"EMPTY":       "",
		"WITH_EQUALS": "key=value",
	}
	for name, want := range expected {
		if values[name] != want {
			t.Errorf("%s=%q, want %q", name, values[name], want)
		}
	}
}

func TestValueTreatsAnEmptyEntryAsAnAnswerAndAMissingOneAsADefault(t *testing.T) {
	environment := Environment{values: map[string]string{"OBJECT_STORAGE_PROVIDER": ""}}
	if got := environment.Value("OBJECT_STORAGE_PROVIDER"); got != "" {
		t.Errorf("explicit empty overridden: %q", got)
	}
	if got := environment.Value("CONSOLE_PORT"); got != "4173" {
		t.Errorf("default not applied: %q", got)
	}
}

func TestPortRejectsAValueThatWouldSilentlyRedirectEveryAddress(t *testing.T) {
	for _, raw := range []string{"", "http://localhost", "0", "70000", "8080 "} {
		environment := Environment{values: map[string]string{"CONSOLE_PORT": raw}}
		if _, err := environment.Port("CONSOLE_PORT"); err == nil {
			t.Errorf("accepted %q as a port", raw)
		}
	}
}

func TestHostEnvironmentPointsEveryDependencyAtItsPublishedPort(t *testing.T) {
	environment := Environment{values: map[string]string{
		"POSTGRES_USER":          "openrum",
		"POSTGRES_PASSWORD":      "pass word",
		"POSTGRES_DB":            "openrum",
		"POSTGRES_PORT":          "5433",
		"CLICKHOUSE_USER":        "openrum",
		"CLICKHOUSE_PASSWORD":    "secret",
		"CLICKHOUSE_DB":          "openrum",
		"CLICKHOUSE_NATIVE_PORT": "9000",
		"KAFKA_PORT":             "9092",
		"REDIS_PORT":             "6379",
		"INGEST_PORT":            "8081",
		"CONSOLE_PORT":           "4173",
		"OBJECT_STORAGE_BUCKET":  "local-bucket",
	}}
	assignments, err := environment.HostEnvironment()
	if err != nil {
		t.Fatal(err)
	}
	values := index(assignments)
	expected := map[string]string{
		"APP_ENV":         "development",
		"LISTEN_ADDRESS":  ":8080",
		"PUBLIC_BASE_URL": "http://127.0.0.1:4173",
		// A password with a space has to survive being placed in a URL, or the
		// API fails to connect for a reason that looks nothing like the cause.
		"POSTGRES_DSN":          "postgres://openrum:pass+word@127.0.0.1:5433/openrum?sslmode=disable",
		"CLICKHOUSE_DSN":        "clickhouse://openrum:secret@127.0.0.1:9000/openrum",
		"KAFKA_BROKERS":         "127.0.0.1:9092",
		"REDIS_ADDR":            "127.0.0.1:6379",
		"INGEST_BASE_URL":       "http://127.0.0.1:8081/ingest",
		"OBJECT_STORAGE_BUCKET": "local-bucket",
	}
	for name, want := range expected {
		if values[name] != want {
			t.Errorf("%s=%q, want %q", name, values[name], want)
		}
	}
	// A container address in a host environment is the failure this derivation
	// exists to prevent, and it fails at connect time rather than at start.
	for _, assignment := range assignments {
		for _, address := range []string{"@postgres:", "@clickhouse:", "kafka:19092", "redis:6379", "//ingest:"} {
			if strings.Contains(assignment, address) {
				t.Errorf("%q leaks the container address %q", assignment, address)
			}
		}
	}
}

func TestHostEnvironmentOmitsOptionalNamesTheFileNeverMentions(t *testing.T) {
	environment := Environment{values: map[string]string{}}
	assignments, err := environment.HostEnvironment()
	if err != nil {
		t.Fatal(err)
	}
	// Passing OBJECT_STORAGE_PROVIDER= through when the file does not set it
	// would be indistinguishable from a deliberate empty, which is fine here
	// but would mask a missing entry elsewhere.
	if _, found := index(assignments)["OBJECT_STORAGE_PROVIDER"]; found {
		t.Error("an absent optional name was materialised")
	}
}

func TestConsoleEnvironmentSendsBothProxiesAtTheirHostTargets(t *testing.T) {
	environment := Environment{values: map[string]string{"CONSOLE_PORT": "4173", "INGEST_PORT": "8081"}}
	assignments, err := environment.ConsoleEnvironment()
	if err != nil {
		t.Fatal(err)
	}
	values := index(assignments)
	if values["CONSOLE_PORT"] != "4173" {
		t.Errorf("console port=%q", values["CONSOLE_PORT"])
	}
	if values["OPENRUM_API_PROXY"] != "http://127.0.0.1:8080" {
		t.Errorf("api proxy=%q", values["OPENRUM_API_PROXY"])
	}
	if values["OPENRUM_INGEST_PROXY"] != "http://127.0.0.1:8081" {
		t.Errorf("ingest proxy=%q", values["OPENRUM_INGEST_PROXY"])
	}
}

// TestComposeDefaultsMatchTheComposeFile keeps the claim that the environment
// file is the single source of truth honest. The stack has to know what Compose
// would substitute for a name the file leaves out, and the only way to know is
// to write it down twice, so this reads the Compose file and fails when the two
// copies disagree.
func TestComposeDefaultsMatchTheComposeFile(t *testing.T) {
	content, err := os.ReadFile(filepath.Join("..", "..", ComposeFile))
	if err != nil {
		t.Fatal(err)
	}
	pattern := regexp.MustCompile(`\$\{([A-Z0-9_]+):-([^}]*)\}`)
	seen := make(map[string]string)
	for _, match := range pattern.FindAllStringSubmatch(string(content), -1) {
		seen[match[1]] = match[2]
	}
	for name, expected := range composeDefaults {
		actual, found := seen[name]
		if !found {
			t.Errorf("%s has a default here but none in the compose file", name)
			continue
		}
		if actual != expected {
			t.Errorf("%s defaults to %q here and %q in the compose file", name, expected, actual)
		}
	}
	// Names the host half needs but has no default for would resolve to an
	// empty string, which is how a stack ends up pointed at port zero.
	for _, name := range []string{"CONSOLE_PORT", "INGEST_PORT", "POSTGRES_PORT", "KAFKA_PORT", "REDIS_PORT", "CLICKHOUSE_NATIVE_PORT"} {
		if _, found := composeDefaults[name]; !found {
			t.Errorf("%s is required by the host environment but has no default", name)
		}
	}
}

// TestPassthroughCoversTheOptionalNamesTheExampleOffers stops a new optional
// setting from being added to the example file and silently never reaching a
// host process.
func TestPassthroughCoversTheOptionalNamesTheExampleOffers(t *testing.T) {
	file, err := os.Open(filepath.Join("..", "..", EnvironmentExample))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = file.Close() }()
	values, err := parseEnvironment(file)
	if err != nil {
		t.Fatal(err)
	}
	for name := range values {
		if _, defaulted := composeDefaults[name]; defaulted {
			continue
		}
		if !slices.Contains(passthrough, name) {
			t.Errorf("%s is in the example file but is neither defaulted nor passed through", name)
		}
	}
}

func index(assignments []string) map[string]string {
	values := make(map[string]string, len(assignments))
	for _, assignment := range assignments {
		name, value, _ := strings.Cut(assignment, "=")
		values[name] = value
	}
	return values
}

func write(t *testing.T, path string, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}
