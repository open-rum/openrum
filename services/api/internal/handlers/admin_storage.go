package handlers

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"openrum/internal/auth"
	"openrum/internal/config"
	"openrum/internal/httpx"
	"openrum/internal/metadata"
	"openrum/internal/sourcemap"
)

type AdminStorageHandler struct {
	mu            sync.RWMutex
	members       adminOverviewRoles
	reauth        recentElevationChecker
	prober        sourcemap.Prober
	configuration config.Config
	secrets       managedStorageSecretStore
	switcher      *sourcemap.SwitchableStorage
	newStorage    managedStorageFactory
	usage         artifactUsageSource
	logger        zerolog.Logger
}

// EnableArtifactUsage adds stored-object totals to the status response.
func (handler *AdminStorageHandler) EnableArtifactUsage(source artifactUsageSource) {
	handler.usage = source
}

type managedStorageSecretStore interface {
	PutObjectStorage(context.Context, uuid.UUID, metadata.ManagedObjectStorage) (metadata.InstanceSecret, error)
	GetObjectStorage(context.Context) (metadata.ManagedObjectStorage, metadata.InstanceSecret, error)
}

// artifactUsageSource reports how many Source Map objects the active Bucket
// holds, so administrators see what a Bucket change would orphan.
type artifactUsageSource interface {
	ArtifactStorageUsage(context.Context) (metadata.ArtifactStorageUsage, error)
}

type managedStorageFactory func(
	context.Context,
	metadata.ManagedObjectStorage,
) (sourcemap.Storage, sourcemap.Prober, error)

type adminStorageStatusResponse struct {
	Provider                config.ObjectStorageProvider         `json:"provider"`
	ProviderLabel           string                               `json:"providerLabel"`
	Configured              bool                                 `json:"configured"`
	Region                  string                               `json:"region"`
	Bucket                  string                               `json:"bucket"`
	Endpoint                string                               `json:"endpoint"`
	Prefix                  string                               `json:"diagnosticPrefix"`
	CredentialSource        config.ObjectStorageCredentialSource `json:"credentialSource"`
	MaskedIdentity          string                               `json:"maskedIdentity"`
	ManagedBy               string                               `json:"managedBy"`
	TestAvailable           bool                                 `json:"testAvailable"`
	ManagedSecretsAvailable bool                                 `json:"managedSecretsAvailable"`
	ConfigurationSource     string                               `json:"configurationSource"`
	// DeleteAllowed is false once storage has refused a delete; storage still
	// works, but deletions leave objects in the bucket.
	DeleteAllowed bool `json:"deleteAllowed"`
	// ArtifactCount and ArtifactBytes cover ready Source Map objects. They stay in
	// the configured Bucket, so switching to another Bucket leaves them unreadable.
	ArtifactCount *int64 `json:"artifactCount,omitempty"`
	ArtifactBytes *int64 `json:"artifactBytes,omitempty"`
}

type managedStorageRequest struct {
	Provider        string `json:"provider"`
	Endpoint        string `json:"endpoint"`
	Bucket          string `json:"bucket"`
	Region          string `json:"region"`
	ForcePathStyle  bool   `json:"forcePathStyle"`
	AccessKeyID     string `json:"accessKeyId"`
	SecretAccessKey string `json:"secretAccessKey"`
}

func NewAdminStorageHandler(
	members adminOverviewRoles,
	reauth recentElevationChecker,
	prober sourcemap.Prober,
	configuration config.Config,
	logger zerolog.Logger,
) *AdminStorageHandler {
	return &AdminStorageHandler{
		members: members, reauth: reauth, prober: prober, configuration: configuration,
		newStorage: sourcemap.NewManagedStorage, logger: logger,
	}
}

func (handler *AdminStorageHandler) EnableManagedSecrets(repository managedStorageSecretStore, switcher *sourcemap.SwitchableStorage) {
	handler.secrets, handler.switcher = repository, switcher
}

func (handler *AdminStorageHandler) PutManaged(writer http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorize(writer, request, auth.InstanceActionDangerousChanges)
	if !ok {
		return
	}
	if !requireAdminElevation(writer, request, principal, handler.reauth, handler.logger) {
		return
	}
	if handler.secrets == nil || handler.switcher == nil || !handler.configuration.AllowManagedSecrets {
		httpx.WriteError(writer, request, http.StatusConflict, "MANAGED_SECRETS_DISABLED", "Managed secrets require an explicit deployment opt-in and external master key.")
		return
	}
	var payload managedStorageRequest
	if !decodeJSONBody(writer, request, &payload) {
		return
	}
	value := metadata.ManagedObjectStorage{Provider: strings.TrimSpace(payload.Provider), Endpoint: strings.TrimSpace(payload.Endpoint),
		Bucket: strings.TrimSpace(payload.Bucket), Region: strings.TrimSpace(payload.Region), ForcePathStyle: payload.ForcePathStyle,
		AccessKeyID: strings.TrimSpace(payload.AccessKeyID), SecretAccessKey: strings.TrimSpace(payload.SecretAccessKey)}
	// Leaving both credential fields blank keeps the stored ones, so changing an
	// Endpoint or Bucket does not require retyping the Secret. The provider must
	// match: a key for one service is meaningless, and should not be sent, to another.
	if value.AccessKeyID == "" && value.SecretAccessKey == "" {
		if current, _, err := handler.secrets.GetObjectStorage(request.Context()); err == nil && current.Provider == value.Provider {
			value.AccessKeyID, value.SecretAccessKey = current.AccessKeyID, current.SecretAccessKey
		}
	}
	if value.AccessKeyID == "" || value.SecretAccessKey == "" || value.Bucket == "" || value.Region == "" || (value.Provider != "oss" && value.Provider != "s3") {
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "Provider, region, bucket and both credentials are required.")
		return
	}
	// Managed endpoints get the same SSRF boundary as deployment configuration;
	// otherwise the probe below would let an administrator reach internal hosts.
	if err := config.ValidateObjectStorageEndpoint(value.Endpoint, handler.configuration.AppEnv,
		config.ObjectStorageProvider(value.Provider), handler.configuration.ObjectStorageAllowlist); err != nil {
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", strings.Replace(err.Error(), "OBJECT_STORAGE_ENDPOINT", "Endpoint", 1))
		return
	}
	ctx, cancel := context.WithTimeout(request.Context(), 15*time.Second)
	defer cancel()
	storage, prober, err := handler.newStorage(ctx, value)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	probe := prober.Probe(ctx)
	if !probe.Success {
		writeJSON(writer, http.StatusUnprocessableEntity, probe)
		return
	}
	// A credential without delete permission still saves: storage works, and the
	// limit travels with the row so every replica warns about it.
	value.DeleteForbidden = slices.Contains(probe.Warnings, "delete_forbidden")
	secret, err := handler.secrets.PutObjectStorage(request.Context(), principal.UserID, value)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	handler.switcher.Swap(storage, prober)
	handler.switcher.SetDeleteForbidden(value.DeleteForbidden)
	handler.ApplyManagedStorage(value)
	value.SecretAccessKey = ""
	writeJSON(writer, http.StatusOK, map[string]any{"configured": true, "version": secret.Version, "keyId": secret.KeyID, "probe": probe})
}

// ApplyManagedStorage updates the status view after a managed configuration
// becomes active, whether saved here or picked up from another replica. Probes
// go through the switcher, so they always test the live client.
func (handler *AdminStorageHandler) ApplyManagedStorage(value metadata.ManagedObjectStorage) {
	handler.mu.Lock()
	defer handler.mu.Unlock()
	handler.configuration.ObjectStorageProvider = config.ObjectStorageProvider(value.Provider)
	handler.configuration.ObjectStorageEndpoint = value.Endpoint
	handler.configuration.ObjectStorageBucket = value.Bucket
	handler.configuration.ObjectStorageRegion = value.Region
	handler.configuration.ObjectStorageForcePathStyle = value.ForcePathStyle
	handler.configuration.ObjectStorageCredential = config.ObjectStorageCredentialManaged
	handler.configuration.ObjectStorageMaskedIdentity = maskStorageIdentity(value.AccessKeyID)
	if handler.switcher != nil {
		handler.prober = handler.switcher
	}
}

func (handler *AdminStorageHandler) Get(writer http.ResponseWriter, request *http.Request) {
	if _, ok := handler.authorize(writer, request, auth.InstanceActionRead); !ok {
		return
	}
	status := handler.status()
	if handler.usage != nil {
		if usage, err := handler.usage.ArtifactStorageUsage(request.Context()); err == nil {
			status.ArtifactCount, status.ArtifactBytes = &usage.Count, &usage.Bytes
		} else {
			handler.logger.Warn().Err(err).Msg("source map storage usage unavailable")
		}
	}
	writeJSON(writer, http.StatusOK, status)
}

func (handler *AdminStorageHandler) Test(writer http.ResponseWriter, request *http.Request) {
	if _, ok := handler.authorize(writer, request, auth.InstanceActionManageSettings); !ok {
		return
	}
	status := handler.status()
	handler.mu.RLock()
	prober := handler.prober
	handler.mu.RUnlock()
	if !status.Configured || prober == nil {
		httpx.WriteError(writer, request, http.StatusConflict, "OBJECT_STORAGE_NOT_CONFIGURED", "Object storage is optional and is not configured by this deployment.")
		return
	}
	ctx, cancel := context.WithTimeout(request.Context(), 15*time.Second)
	defer cancel()
	writeJSON(writer, http.StatusOK, prober.Probe(ctx))
}

func (handler *AdminStorageHandler) status() adminStorageStatusResponse {
	handler.mu.RLock()
	defer handler.mu.RUnlock()
	configured := handler.configuration.ObjectStorageProvider != config.ObjectStorageProviderNone
	providerLabel := "未启用"
	endpoint := "—"
	switch handler.configuration.ObjectStorageProvider {
	case config.ObjectStorageProviderOSS:
		providerLabel = "Alibaba OSS"
		endpoint = "Alibaba OSS 默认区域 Endpoint"
	case config.ObjectStorageProviderS3:
		providerLabel = "S3-compatible"
		endpoint = "Amazon S3 默认区域 Endpoint"
	}
	if handler.configuration.ObjectStorageEndpoint != "" {
		if parsed, err := url.Parse(handler.configuration.ObjectStorageEndpoint); err == nil {
			endpoint = parsed.Scheme + "://" + parsed.Host
		} else {
			endpoint = "自定义 Endpoint"
		}
	}
	managedBy := "未配置"
	switch handler.configuration.ObjectStorageCredential {
	case config.ObjectStorageCredentialRAMRole:
		managedBy = "阿里云 RAM Role"
	case config.ObjectStorageCredentialIAMRole:
		managedBy = "IAM Role / Workload Identity"
	case config.ObjectStorageCredentialKubernetesSecret:
		managedBy = "Kubernetes Secret"
	case config.ObjectStorageCredentialEnvironment:
		managedBy = "部署环境变量"
	case config.ObjectStorageCredentialManaged:
		managedBy = "控制台托管 · AEAD 加密"
	}
	deleteAllowed := true
	if capability, ok := handler.prober.(interface{ DeleteAllowed() bool }); ok {
		deleteAllowed = capability.DeleteAllowed()
	}
	return adminStorageStatusResponse{
		Provider: handler.configuration.ObjectStorageProvider, ProviderLabel: providerLabel,
		Configured: configured, Region: handler.configuration.ObjectStorageRegion,
		Bucket: handler.configuration.ObjectStorageBucket, Endpoint: endpoint,
		Prefix: "openrum-diagnostics/connectivity/", CredentialSource: handler.configuration.ObjectStorageCredential,
		MaskedIdentity: handler.configuration.ObjectStorageMaskedIdentity, ManagedBy: managedBy,
		TestAvailable:           configured && handler.prober != nil,
		ManagedSecretsAvailable: handler.configuration.AllowManagedSecrets && handler.secrets != nil,
		ConfigurationSource: func() string {
			if handler.secrets != nil && handler.switcher != nil && handler.switcher.Available() {
				return "managed_or_deployment"
			}
			return "deployment"
		}(),
		DeleteAllowed: deleteAllowed,
	}
}

func maskStorageIdentity(value string) string {
	if len(value) <= 4 {
		return "••••"
	}
	if len(value) <= 8 {
		return value[:2] + "••••" + value[len(value)-2:]
	}
	return value[:3] + "••••" + value[len(value)-4:]
}

func (handler *AdminStorageHandler) authorize(
	writer http.ResponseWriter,
	request *http.Request,
	action auth.InstanceAction,
) (auth.Principal, bool) {
	principal, ok := httpx.PrincipalFromContext(request.Context())
	if !ok {
		httpx.WriteError(writer, request, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication is required.")
		return auth.Principal{}, false
	}
	role, err := handler.members.RoleForUser(request.Context(), principal.UserID)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return auth.Principal{}, false
	}
	if err := auth.AuthorizeInstance(role, action); err != nil {
		writeControlPlaneError(writer, request, handler.logger, errors.Join(metadata.ErrForbidden, err))
		return auth.Principal{}, false
	}
	return principal, true
}
