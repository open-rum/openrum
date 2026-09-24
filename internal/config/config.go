package config

import (
	"encoding/base64"
	"fmt"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"
)

type Service string

const (
	ServiceAPI      Service = "api"
	ServiceIngest   Service = "ingest"
	ServiceConsumer Service = "consumer"
	ServiceWorker   Service = "worker"
)

type Config struct {
	Service                     Service
	AppEnv                      string
	PublicBaseURL               *url.URL
	ListenAddress               string
	ShutdownTimeout             time.Duration
	PostgresDSN                 string
	ClickHouseDSN               string
	KafkaBrokers                []string
	KafkaEventTopic             string
	KafkaRetention              time.Duration
	ConsumerWorkers             int
	ConsumerFlushInterval       time.Duration
	RedisAddress                string
	GeoCountryHeader            string
	GeoTrustedProxies           []string
	IngestTrustedProxies        []string
	IngestBaseURL               string
	ObjectStorageProvider       ObjectStorageProvider
	ObjectStorageEndpoint       string
	ObjectStorageBucket         string
	ObjectStorageRegion         string
	ObjectStorageForcePathStyle bool
	ObjectStorageCredential     ObjectStorageCredentialSource
	ObjectStorageMaskedIdentity string
	ObjectStorageAllowlist      []string
	AllowManagedSecrets         bool
	ManagedSecretsKeyID         string
	ManagedSecretsMasterKey     []byte
	BootstrapToken              string
	SystemSettings              []SystemSettingDefinition
	StoragePressure             StoragePressureConfig
}

// StoragePressureConfig controls the optional ClickHouse capacity guard. The
// guard is deliberately opt-in because external ClickHouse providers do not
// all expose system.disks to application users.
type StoragePressureConfig struct {
	Enabled           bool
	WarningFreeRatio  float64
	CriticalFreeRatio float64
	HardStopFreeRatio float64
	RecoveryFreeRatio float64
	EmergencyRate     float64
	PollInterval      time.Duration
}

type ObjectStorageCredentialSource string

type ObjectStorageProvider string

const (
	ObjectStorageProviderNone ObjectStorageProvider = "none"
	ObjectStorageProviderOSS  ObjectStorageProvider = "oss"
	ObjectStorageProviderS3   ObjectStorageProvider = "s3"

	ObjectStorageCredentialNone             ObjectStorageCredentialSource = "none"
	ObjectStorageCredentialRAMRole          ObjectStorageCredentialSource = "ram_role"
	ObjectStorageCredentialIAMRole          ObjectStorageCredentialSource = "iam_role"
	ObjectStorageCredentialEnvironment      ObjectStorageCredentialSource = "environment"
	ObjectStorageCredentialKubernetesSecret ObjectStorageCredentialSource = "kubernetes_secret"
	ObjectStorageCredentialManaged          ObjectStorageCredentialSource = "managed_encrypted"
)

type lookupEnv func(string) (string, bool)

var serviceDefaults = map[Service]string{
	ServiceAPI:      ":8080",
	ServiceIngest:   ":8081",
	ServiceConsumer: ":8082",
	ServiceWorker:   ":8083",
}

var serviceRequirements = map[Service][]string{
	ServiceAPI:      {"POSTGRES_DSN", "CLICKHOUSE_DSN", "KAFKA_BROKERS", "REDIS_ADDR"},
	ServiceIngest:   {"POSTGRES_DSN", "KAFKA_BROKERS", "REDIS_ADDR"},
	ServiceConsumer: {"POSTGRES_DSN", "CLICKHOUSE_DSN", "KAFKA_BROKERS", "REDIS_ADDR"},
	ServiceWorker:   {"POSTGRES_DSN", "CLICKHOUSE_DSN"},
}

func Load(service Service) (Config, error) {
	return load(service, os.LookupEnv)
}

func load(service Service, lookup lookupEnv) (Config, error) {
	defaultAddress, knownService := serviceDefaults[service]
	if !knownService {
		return Config{}, fmt.Errorf("unknown service %q", service)
	}

	values := func(key string) string {
		value, _ := lookup(key)
		return strings.TrimSpace(value)
	}

	missing := make([]string, 0)
	required := append([]string{"APP_ENV", "PUBLIC_BASE_URL"}, serviceRequirements[service]...)
	for _, key := range required {
		if values(key) == "" {
			missing = append(missing, key)
		}
	}
	if len(missing) > 0 {
		sort.Strings(missing)
		return Config{}, fmt.Errorf("missing required environment variables: %s", strings.Join(missing, ", "))
	}

	appEnv := values("APP_ENV")
	if !isSupportedEnvironment(appEnv) {
		return Config{}, fmt.Errorf("APP_ENV must be one of development, test, staging, production; got %q", appEnv)
	}

	publicBaseURL, err := url.ParseRequestURI(values("PUBLIC_BASE_URL"))
	if err != nil || publicBaseURL.Host == "" || (publicBaseURL.Scheme != "http" && publicBaseURL.Scheme != "https") {
		return Config{}, fmt.Errorf("PUBLIC_BASE_URL must be an absolute http(s) URL")
	}
	if appEnv == "production" && publicBaseURL.Scheme != "https" {
		return Config{}, fmt.Errorf("PUBLIC_BASE_URL must use https in production")
	}

	shutdownTimeout := 10 * time.Second
	if raw := values("SHUTDOWN_TIMEOUT"); raw != "" {
		shutdownTimeout, err = time.ParseDuration(raw)
		if err != nil || shutdownTimeout <= 0 {
			return Config{}, fmt.Errorf("SHUTDOWN_TIMEOUT must be a positive duration")
		}
	}

	listenAddress := values(strings.ToUpper(string(service)) + "_HTTP_ADDR")
	if listenAddress == "" {
		listenAddress = defaultAddress
	}

	topic := values("KAFKA_EVENT_TOPIC")
	if topic == "" {
		topic = "rum-events-v1"
	}
	kafkaRetention := 7 * 24 * time.Hour
	if raw := values("OPENRUM_KAFKA_RETENTION_DURATION"); raw != "" {
		kafkaRetention, err = time.ParseDuration(raw)
		if err != nil || kafkaRetention < time.Hour {
			return Config{}, fmt.Errorf("OPENRUM_KAFKA_RETENTION_DURATION must be a duration of at least 1h")
		}
	}
	systemSettings, err := loadSystemSettings(values)
	if err != nil {
		return Config{}, err
	}
	storage, err := loadObjectStorage(values, appEnv)
	if err != nil {
		return Config{}, err
	}
	allowManagedSecrets, managedKeyID, managedMasterKey, err := loadManagedSecrets(values)
	if err != nil {
		return Config{}, err
	}
	storagePressure, err := loadStoragePressure(values)
	if err != nil {
		return Config{}, err
	}

	consumerWorkers := 4
	if raw := values("OPENRUM_CONSUMER_WORKERS"); raw != "" {
		consumerWorkers, err = strconv.Atoi(raw)
		if err != nil || consumerWorkers < 1 || consumerWorkers > 64 {
			return Config{}, fmt.Errorf("OPENRUM_CONSUMER_WORKERS must be an integer between 1 and 64")
		}
	}
	consumerFlushInterval := 10 * time.Millisecond
	if raw := values("OPENRUM_CONSUMER_FLUSH_INTERVAL"); raw != "" {
		consumerFlushInterval, err = time.ParseDuration(raw)
		if err != nil || consumerFlushInterval < time.Millisecond || consumerFlushInterval > time.Second {
			return Config{}, fmt.Errorf("OPENRUM_CONSUMER_FLUSH_INTERVAL must be between 1ms and 1s")
		}
	}

	return Config{
		Service:                     service,
		AppEnv:                      appEnv,
		PublicBaseURL:               publicBaseURL,
		ListenAddress:               listenAddress,
		ShutdownTimeout:             shutdownTimeout,
		PostgresDSN:                 values("POSTGRES_DSN"),
		ClickHouseDSN:               values("CLICKHOUSE_DSN"),
		KafkaBrokers:                splitCommaSeparated(values("KAFKA_BROKERS")),
		KafkaEventTopic:             topic,
		KafkaRetention:              kafkaRetention,
		ConsumerWorkers:             consumerWorkers,
		ConsumerFlushInterval:       consumerFlushInterval,
		RedisAddress:                values("REDIS_ADDR"),
		GeoCountryHeader:            strings.TrimSpace(values("GEO_COUNTRY_HEADER")),
		GeoTrustedProxies:           splitCommaSeparated(values("GEO_TRUSTED_PROXIES")),
		IngestTrustedProxies:        splitCommaSeparated(values("INGEST_TRUSTED_PROXIES")),
		IngestBaseURL:               strings.TrimRight(strings.TrimSpace(values("INGEST_BASE_URL")), "/"),
		ObjectStorageProvider:       storage.provider,
		ObjectStorageEndpoint:       storage.endpoint,
		ObjectStorageBucket:         storage.bucket,
		ObjectStorageRegion:         storage.region,
		ObjectStorageForcePathStyle: storage.forcePathStyle,
		ObjectStorageCredential:     storage.credential,
		ObjectStorageMaskedIdentity: storage.maskedIdentity,
		ObjectStorageAllowlist:      storage.allowlist,
		AllowManagedSecrets:         allowManagedSecrets,
		ManagedSecretsKeyID:         managedKeyID,
		ManagedSecretsMasterKey:     managedMasterKey,
		BootstrapToken:              values("BOOTSTRAP_TOKEN"),
		SystemSettings:              systemSettings,
		StoragePressure:             storagePressure,
	}, nil
}

func loadStoragePressure(values func(string) string) (StoragePressureConfig, error) {
	result := StoragePressureConfig{
		WarningFreeRatio: 0.15, CriticalFreeRatio: 0.10, HardStopFreeRatio: 0.05, RecoveryFreeRatio: 0.10,
		EmergencyRate: 0.10, PollInterval: 30 * time.Second,
	}
	if raw := values("OPENRUM_STORAGE_PRESSURE_GUARD_ENABLED"); raw != "" {
		enabled, err := strconv.ParseBool(raw)
		if err != nil {
			return StoragePressureConfig{}, fmt.Errorf("OPENRUM_STORAGE_PRESSURE_GUARD_ENABLED must be true or false")
		}
		result.Enabled = enabled
	}
	for key, destination := range map[string]*float64{
		"OPENRUM_STORAGE_WARNING_FREE_RATIO":   &result.WarningFreeRatio,
		"OPENRUM_STORAGE_CRITICAL_FREE_RATIO":  &result.CriticalFreeRatio,
		"OPENRUM_STORAGE_HARD_STOP_FREE_RATIO": &result.HardStopFreeRatio,
		"OPENRUM_STORAGE_RECOVERY_FREE_RATIO":  &result.RecoveryFreeRatio,
	} {
		if raw := values(key); raw != "" {
			parsed, err := strconv.ParseFloat(raw, 64)
			if err != nil || parsed <= 0 || parsed > 1 {
				return StoragePressureConfig{}, fmt.Errorf("%s must be greater than 0 and at most 1", key)
			}
			*destination = parsed
		}
	}
	if raw := values("OPENRUM_STORAGE_EMERGENCY_SAMPLE_RATE"); raw != "" {
		parsed, err := strconv.ParseFloat(raw, 64)
		if err != nil || parsed < 0 || parsed > 1 {
			return StoragePressureConfig{}, fmt.Errorf("OPENRUM_STORAGE_EMERGENCY_SAMPLE_RATE must be between 0 and 1")
		}
		result.EmergencyRate = parsed
	}
	if raw := values("OPENRUM_STORAGE_POLL_INTERVAL"); raw != "" {
		parsed, err := time.ParseDuration(raw)
		if err != nil || parsed < 10*time.Second || parsed > 10*time.Minute {
			return StoragePressureConfig{}, fmt.Errorf("OPENRUM_STORAGE_POLL_INTERVAL must be between 10s and 10m")
		}
		result.PollInterval = parsed
	}
	if !(result.HardStopFreeRatio < result.CriticalFreeRatio &&
		result.CriticalFreeRatio <= result.RecoveryFreeRatio &&
		result.RecoveryFreeRatio < result.WarningFreeRatio) {
		return StoragePressureConfig{}, fmt.Errorf("storage pressure ratios must satisfy hard stop < critical <= recovery < warning")
	}
	return result, nil
}

// IngestEnvelopeURL is the endpoint the development data generator posts to.
// It falls back to the public origin, where the bundled reverse proxy already
// exposes ingest, so a developer running only the API on the host needs no
// extra configuration.
func (configuration Config) IngestEnvelopeURL() string {
	base := configuration.IngestBaseURL
	if base == "" && configuration.PublicBaseURL != nil {
		base = strings.TrimRight(configuration.PublicBaseURL.String(), "/") + "/ingest"
	}
	return base + "/v1/envelope"
}

func loadManagedSecrets(values func(string) string) (bool, string, []byte, error) {
	raw := values("OPENRUM_ALLOW_MANAGED_SECRETS")
	if raw == "" {
		return false, "", nil, nil
	}
	allowed, err := strconv.ParseBool(raw)
	if err != nil {
		return false, "", nil, fmt.Errorf("OPENRUM_ALLOW_MANAGED_SECRETS must be true or false")
	}
	if !allowed {
		return false, "", nil, nil
	}
	encoded := values("OPENRUM_MASTER_KEY")
	material, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil || len(material) != 32 {
		return false, "", nil, fmt.Errorf("OPENRUM_MASTER_KEY must be base64 for exactly 32 bytes")
	}
	keyID := values("OPENRUM_MASTER_KEY_ID")
	if keyID == "" {
		keyID = "v1"
	}
	if len(keyID) > 32 {
		return false, "", nil, fmt.Errorf("OPENRUM_MASTER_KEY_ID must not exceed 32 characters")
	}
	return true, keyID, material, nil
}

type objectStorageConfig struct {
	provider       ObjectStorageProvider
	endpoint       string
	bucket         string
	region         string
	forcePathStyle bool
	credential     ObjectStorageCredentialSource
	maskedIdentity string
	allowlist      []string
}

func loadObjectStorage(values func(string) string, appEnv string) (objectStorageConfig, error) {
	provider := ObjectStorageProvider(strings.ToLower(values("OBJECT_STORAGE_PROVIDER")))
	if provider == "" && (values("OSS_ENDPOINT") != "" || values("OSS_BUCKET") != "" || values("OSS_REGION") != "") {
		provider = ObjectStorageProviderOSS
	}
	if provider == "" {
		provider = ObjectStorageProviderNone
	}
	if provider != ObjectStorageProviderNone && provider != ObjectStorageProviderOSS && provider != ObjectStorageProviderS3 {
		return objectStorageConfig{}, fmt.Errorf("OBJECT_STORAGE_PROVIDER must be one of oss or s3")
	}
	endpoint, bucket, region := values("OBJECT_STORAGE_ENDPOINT"), values("OBJECT_STORAGE_BUCKET"), values("OBJECT_STORAGE_REGION")
	if provider == ObjectStorageProviderOSS {
		endpoint, bucket, region = firstValue(endpoint, values("OSS_ENDPOINT")), firstValue(bucket, values("OSS_BUCKET")), firstValue(region, values("OSS_REGION"))
	}
	if provider == ObjectStorageProviderNone {
		if endpoint != "" || bucket != "" || region != "" {
			return objectStorageConfig{}, fmt.Errorf("OBJECT_STORAGE_PROVIDER is required when object storage fields are configured")
		}
		return objectStorageConfig{provider: provider, credential: ObjectStorageCredentialNone}, nil
	}
	if bucket == "" || region == "" {
		return objectStorageConfig{}, fmt.Errorf("OBJECT_STORAGE_BUCKET and OBJECT_STORAGE_REGION are required when object storage is enabled")
	}
	allowlist := splitCommaSeparated(firstValue(values("OPENRUM_OBJECT_STORAGE_ENDPOINT_ALLOWLIST"), values("OPENRUM_OSS_ENDPOINT_ALLOWLIST")))
	if err := validateObjectStorageEndpoint(endpoint, appEnv, provider, allowlist); err != nil {
		return objectStorageConfig{}, err
	}
	forcePathStyle := provider == ObjectStorageProviderS3 && endpoint != ""
	if raw := values("OBJECT_STORAGE_FORCE_PATH_STYLE"); raw != "" {
		parsed, err := strconv.ParseBool(raw)
		if err != nil {
			return objectStorageConfig{}, fmt.Errorf("OBJECT_STORAGE_FORCE_PATH_STYLE must be true or false")
		}
		forcePathStyle = parsed
	}
	credential, maskedIdentity, err := objectStorageCredentials(values, provider)
	if err != nil {
		return objectStorageConfig{}, err
	}
	return objectStorageConfig{
		provider: provider, endpoint: endpoint, bucket: bucket, region: region, forcePathStyle: forcePathStyle,
		credential: credential, maskedIdentity: maskedIdentity, allowlist: allowlist,
	}, nil
}

func objectStorageCredentials(values func(string) string, provider ObjectStorageProvider) (ObjectStorageCredentialSource, string, error) {
	accessKeyID, accessKeySecret := values("AWS_ACCESS_KEY_ID"), values("AWS_SECRET_ACCESS_KEY")
	credentialName := "AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY"
	roleSource := ObjectStorageCredentialIAMRole
	if provider == ObjectStorageProviderOSS {
		accessKeyID, accessKeySecret = values("OSS_ACCESS_KEY_ID"), values("OSS_ACCESS_KEY_SECRET")
		credentialName = "OSS_ACCESS_KEY_ID and OSS_ACCESS_KEY_SECRET"
		roleSource = ObjectStorageCredentialRAMRole
	}
	if (accessKeyID == "") != (accessKeySecret == "") {
		return "", "", fmt.Errorf("%s must be configured together", credentialName)
	}
	if accessKeyID != "" {
		source := ObjectStorageCredentialEnvironment
		if values("KUBERNETES_SERVICE_HOST") != "" {
			source = ObjectStorageCredentialKubernetesSecret
		}
		return source, maskCredentialIdentity(accessKeyID), nil
	}
	return roleSource, "运行时角色（启动后解析）", nil
}

func maskCredentialIdentity(value string) string {
	runes := []rune(value)
	if len(runes) <= 7 {
		return "••••"
	}
	return string(runes[:3]) + "••••" + string(runes[len(runes)-4:])
}

func validateObjectStorageEndpoint(raw, appEnv string, provider ObjectStorageProvider, allowlist []string) error {
	if raw == "" {
		return nil
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Hostname() == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") ||
		parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return fmt.Errorf("OBJECT_STORAGE_ENDPOINT must be an absolute http(s) URL without credentials, query, or fragment")
	}
	if appEnv != "production" {
		return nil
	}
	if parsed.Scheme != "https" {
		return fmt.Errorf("OBJECT_STORAGE_ENDPOINT must use https in production")
	}
	host := strings.ToLower(parsed.Hostname())
	if provider == ObjectStorageProviderOSS && (host == "aliyuncs.com" || strings.HasSuffix(host, ".aliyuncs.com")) {
		return nil
	}
	for _, allowed := range allowlist {
		if strings.EqualFold(strings.TrimSpace(allowed), host) {
			return nil
		}
	}
	return fmt.Errorf("OBJECT_STORAGE_ENDPOINT host must be listed in OPENRUM_OBJECT_STORAGE_ENDPOINT_ALLOWLIST")
}

func firstValue(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func isSupportedEnvironment(value string) bool {
	switch value {
	case "development", "test", "staging", "production":
		return true
	default:
		return false
	}
}

func splitCommaSeparated(value string) []string {
	if value == "" {
		return nil
	}
	parts := strings.Split(value, ",")
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			result = append(result, trimmed)
		}
	}
	return result
}
