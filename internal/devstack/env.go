package devstack

import (
	"bufio"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

// EnvironmentFile names the Compose environment the stack reads. A developer who
// wants different ports or passwords edits this file; when it is absent the
// checked-in example stands in, which is what Compose itself is pointed at.
const EnvironmentFile = "deploy/compose/.env"

// EnvironmentExample is the committed fallback for EnvironmentFile.
const EnvironmentExample = "deploy/compose/.env.example"

// composeDefaults mirrors every ${NAME:-default} in the Compose file that the
// host half of a dev stack also needs. Compose applies these to containers; the
// stack applies the same ones to host processes so the two halves cannot
// disagree about a port or a credential. TestComposeDefaultsMatchTheComposeFile
// reads the Compose file and fails if this table drifts from it.
var composeDefaults = map[string]string{
	"POSTGRES_DB":            "openrum",
	"POSTGRES_USER":          "openrum",
	"POSTGRES_PASSWORD":      "openrum_local_only",
	"POSTGRES_PORT":          "5433",
	"CLICKHOUSE_DB":          "openrum",
	"CLICKHOUSE_USER":        "openrum",
	"CLICKHOUSE_PASSWORD":    "openrum_local_only",
	"CLICKHOUSE_HTTP_PORT":   "8123",
	"CLICKHOUSE_NATIVE_PORT": "9000",
	"KAFKA_PORT":             "9092",
	"REDIS_PORT":             "6379",
	"CONSOLE_PORT":           "4173",
	"INGEST_PORT":            "8081",
	"GEO_COUNTRY_HEADER":     "CF-IPCountry",
	"GEO_TRUSTED_PROXIES":    "10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,127.0.0.0/8,::1/128",
}

// passthrough names the variables a host process should inherit verbatim from
// the environment file. They configure optional subsystems, so an empty value is
// a legitimate answer and is passed along rather than defaulted.
var passthrough = []string{
	"OBJECT_STORAGE_PROVIDER",
	"OBJECT_STORAGE_ENDPOINT",
	"OBJECT_STORAGE_BUCKET",
	"OBJECT_STORAGE_REGION",
	"OBJECT_STORAGE_FORCE_PATH_STYLE",
	"OPENRUM_OBJECT_STORAGE_ENDPOINT_ALLOWLIST",
	"OPENRUM_ALLOW_MANAGED_SECRETS",
	"OPENRUM_MASTER_KEY",
	"OPENRUM_MASTER_KEY_ID",
	"OSS_ACCESS_KEY_ID",
	"OSS_ACCESS_KEY_SECRET",
	"AWS_ACCESS_KEY_ID",
	"AWS_SECRET_ACCESS_KEY",
	"AWS_SESSION_TOKEN",
}

// Environment is the resolved Compose environment: the file's values with the
// Compose defaults filled in.
type Environment struct {
	// Path is the file the values came from, reported so status output can say
	// which environment a stack is running under.
	Path   string
	values map[string]string
}

// LoadEnvironment resolves the Compose environment for the repository at root.
func LoadEnvironment(root string) (Environment, error) {
	path := filepath.Join(root, EnvironmentFile)
	if _, err := os.Stat(path); err != nil {
		path = filepath.Join(root, EnvironmentExample)
	}
	file, err := os.Open(path)
	if err != nil {
		return Environment{}, fmt.Errorf("read compose environment: %w", err)
	}
	defer func() { _ = file.Close() }()
	values, err := parseEnvironment(file)
	if err != nil {
		return Environment{}, fmt.Errorf("read %s: %w", path, err)
	}
	return Environment{Path: path, values: values}, nil
}

// parseEnvironment reads the subset of the env-file format Compose accepts:
// KEY=value lines, blank lines, and # comments. Quotes around a value are
// stripped, and `export` prefixes are tolerated.
func parseEnvironment(reader io.Reader) (map[string]string, error) {
	values := make(map[string]string)
	scanner := bufio.NewScanner(reader)
	for line := 1; scanner.Scan(); line++ {
		text := strings.TrimSpace(scanner.Text())
		if text == "" || strings.HasPrefix(text, "#") {
			continue
		}
		text = strings.TrimPrefix(text, "export ")
		name, value, found := strings.Cut(text, "=")
		if !found {
			return nil, fmt.Errorf("line %d is not KEY=value", line)
		}
		name = strings.TrimSpace(name)
		if name == "" {
			return nil, fmt.Errorf("line %d has an empty name", line)
		}
		values[name] = unquote(strings.TrimSpace(value))
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	return values, nil
}

func unquote(value string) string {
	if len(value) < 2 {
		return value
	}
	first, last := value[0], value[len(value)-1]
	if first == last && (first == '"' || first == '\'') {
		return value[1 : len(value)-1]
	}
	return value
}

// Value answers with the file's value, or the Compose default when the file
// leaves the name out. A name present but empty is an explicit empty value and
// is returned as such, which is how Compose reads ${NAME:-default} too only for
// names it has no entry for.
func (environment Environment) Value(name string) string {
	if value, found := environment.values[name]; found {
		return value
	}
	return composeDefaults[name]
}

// Port answers with a published host port. A value that is not a port is a
// configuration error rather than something to paper over with a default,
// because every derived address would silently point somewhere else.
func (environment Environment) Port(name string) (int, error) {
	raw := environment.Value(name)
	port, err := strconv.Atoi(raw)
	if err != nil || port < 1 || port > 65535 {
		return 0, fmt.Errorf("%s=%q is not a port", name, raw)
	}
	return port, nil
}

// ConsoleURL is the one address the console answers on, in either mode: the
// container proxy publishes it under `up`, and Vite binds it under `dev`.
func (environment Environment) ConsoleURL() (string, error) {
	port, err := environment.Port("CONSOLE_PORT")
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("http://127.0.0.1:%d", port), nil
}

// HostServiceEnvironment derives the environment one host service needs.
func (environment Environment) HostServiceEnvironment(service Service) ([]string, error) {
	switch service.Name {
	case "api":
		return environment.HostEnvironment()
	case "web":
		return environment.ConsoleEnvironment()
	default:
		return nil, fmt.Errorf("no host environment defined for %q", service.Name)
	}
}

// ConsoleEnvironment points the dev server at the host API and at ingest. Both
// proxies exist so the console is same-origin with everything it calls, which
// keeps the browser's origin equal to PUBLIC_BASE_URL and the CSRF check happy.
func (environment Environment) ConsoleEnvironment() ([]string, error) {
	console, err := environment.Port("CONSOLE_PORT")
	if err != nil {
		return nil, err
	}
	ingest, err := environment.Port("INGEST_PORT")
	if err != nil {
		return nil, err
	}
	return []string{
		fmt.Sprintf("CONSOLE_PORT=%d", console),
		fmt.Sprintf("OPENRUM_API_PROXY=http://127.0.0.1:%d", HostAPIPort),
		fmt.Sprintf("OPENRUM_INGEST_PROXY=http://127.0.0.1:%d", ingest),
	}, nil
}

// HostEnvironment derives the variables a host service needs to reach the
// containers through their published ports. Container addresses (postgres:5432,
// kafka:19092) are meaningless outside the Compose network, so every one of
// them is rewritten to loopback and the published port.
func (environment Environment) HostEnvironment() ([]string, error) {
	postgres, err := environment.Port("POSTGRES_PORT")
	if err != nil {
		return nil, err
	}
	clickhouse, err := environment.Port("CLICKHOUSE_NATIVE_PORT")
	if err != nil {
		return nil, err
	}
	kafka, err := environment.Port("KAFKA_PORT")
	if err != nil {
		return nil, err
	}
	redis, err := environment.Port("REDIS_PORT")
	if err != nil {
		return nil, err
	}
	ingest, err := environment.Port("INGEST_PORT")
	if err != nil {
		return nil, err
	}
	console, err := environment.ConsoleURL()
	if err != nil {
		return nil, err
	}
	derived := map[string]string{
		"APP_ENV":        "development",
		"LISTEN_ADDRESS": fmt.Sprintf(":%d", HostAPIPort),
		// The browser and the API must agree on the origin or every write fails
		// the CSRF origin check. Both modes serve the console from CONSOLE_PORT.
		"PUBLIC_BASE_URL": console,
		"POSTGRES_DSN": fmt.Sprintf(
			"postgres://%s:%s@127.0.0.1:%d/%s?sslmode=disable",
			url.QueryEscape(environment.Value("POSTGRES_USER")),
			url.QueryEscape(environment.Value("POSTGRES_PASSWORD")),
			postgres,
			environment.Value("POSTGRES_DB"),
		),
		"CLICKHOUSE_DSN": fmt.Sprintf(
			"clickhouse://%s:%s@127.0.0.1:%d/%s",
			url.QueryEscape(environment.Value("CLICKHOUSE_USER")),
			url.QueryEscape(environment.Value("CLICKHOUSE_PASSWORD")),
			clickhouse,
			environment.Value("CLICKHOUSE_DB"),
		),
		"KAFKA_BROKERS": fmt.Sprintf("127.0.0.1:%d", kafka),
		"REDIS_ADDR":    fmt.Sprintf("127.0.0.1:%d", redis),
		// Straight to the published ingest port. Routing through the container
		// proxy would add a hop that resolves nothing extra: the proxy does not
		// set the country header, and GEO_TRUSTED_PROXIES already covers
		// loopback and the private ranges, so both paths are equally trusted.
		"INGEST_BASE_URL":     fmt.Sprintf("http://127.0.0.1:%d/ingest", ingest),
		"GEO_COUNTRY_HEADER":  environment.Value("GEO_COUNTRY_HEADER"),
		"GEO_TRUSTED_PROXIES": environment.Value("GEO_TRUSTED_PROXIES"),
	}
	for _, name := range passthrough {
		if value, found := environment.values[name]; found {
			derived[name] = value
		}
	}
	names := make([]string, 0, len(derived))
	for name := range derived {
		names = append(names, name)
	}
	sort.Strings(names)
	assignments := make([]string, 0, len(names))
	for _, name := range names {
		assignments = append(assignments, name+"="+derived[name])
	}
	return assignments, nil
}
