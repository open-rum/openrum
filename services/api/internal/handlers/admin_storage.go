package handlers

import (
	"context"
	"errors"
	"net/http"
	"net/url"
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
	logger        zerolog.Logger
}

type managedStorageSecretStore interface {
	PutObjectStorage(context.Context, uuid.UUID, metadata.ManagedObjectStorage) (metadata.InstanceSecret, error)
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
	if value.AccessKeyID == "" || value.SecretAccessKey == "" || value.Bucket == "" || value.Region == "" || (value.Provider != "oss" && value.Provider != "s3") {
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "Provider, region, bucket and both credentials are required.")
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
	secret, err := handler.secrets.PutObjectStorage(request.Context(), principal.UserID, value)
	if err != nil {
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	handler.switcher.Swap(storage, prober)
	handler.mu.Lock()
	handler.configuration.ObjectStorageProvider = config.ObjectStorageProvider(value.Provider)
	handler.configuration.ObjectStorageEndpoint = value.Endpoint
	handler.configuration.ObjectStorageBucket = value.Bucket
	handler.configuration.ObjectStorageRegion = value.Region
	handler.configuration.ObjectStorageForcePathStyle = value.ForcePathStyle
	handler.configuration.ObjectStorageCredential = config.ObjectStorageCredentialManaged
	handler.configuration.ObjectStorageMaskedIdentity = maskStorageIdentity(value.AccessKeyID)
	handler.prober = prober
	handler.mu.Unlock()
	value.SecretAccessKey = ""
	writeJSON(writer, http.StatusOK, map[string]any{"configured": true, "version": secret.Version, "keyId": secret.KeyID, "probe": probe})
}

func (handler *AdminStorageHandler) Get(writer http.ResponseWriter, request *http.Request) {
	if _, ok := handler.authorize(writer, request, auth.InstanceActionRead); !ok {
		return
	}
	writeJSON(writer, http.StatusOK, handler.status())
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
