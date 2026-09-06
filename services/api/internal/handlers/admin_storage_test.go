package handlers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"openrum/internal/auth"
	"openrum/internal/config"
	"openrum/internal/httpx"
	"openrum/internal/metadata"
	"openrum/internal/sourcemap"
)

type fixedStorageProber struct {
	called bool
	result sourcemap.StorageProbeResult
}

type managedStorageMemory struct{ value string }

func (storage *managedStorageMemory) PresignUpload(context.Context, string, int64, []byte, time.Duration) (sourcemap.UploadGrant, error) {
	return sourcemap.UploadGrant{}, nil
}

func (storage *managedStorageMemory) Head(context.Context, string) (sourcemap.ObjectInfo, error) {
	return sourcemap.ObjectInfo{}, nil
}

func (storage *managedStorageMemory) Delete(context.Context, string) error { return nil }

func (storage *managedStorageMemory) Read(context.Context, string, int64) ([]byte, error) {
	return []byte(storage.value), nil
}

type fakeManagedStorageSecrets struct {
	called bool
	value  metadata.ManagedObjectStorage
	secret metadata.InstanceSecret
	err    error
}

func (store *fakeManagedStorageSecrets) PutObjectStorage(
	_ context.Context,
	_ uuid.UUID,
	value metadata.ManagedObjectStorage,
) (metadata.InstanceSecret, error) {
	store.called = true
	store.value = value
	return store.secret, store.err
}

func (prober *fixedStorageProber) Probe(context.Context) sourcemap.StorageProbeResult {
	prober.called = true
	return prober.result
}

func TestAdminStorageStatusMasksIdentityAndProbeUsesDedicatedPrefix(t *testing.T) {
	adminID := uuid.New()
	members := &fakeInstanceMembers{roles: map[uuid.UUID]metadata.InstanceRole{adminID: metadata.InstanceRoleAdmin}}
	prober := &fixedStorageProber{result: sourcemap.StorageProbeResult{
		Success: true, StartedAt: time.Now().UTC(), Steps: []sourcemap.StorageProbeStep{{Name: "write", Status: "passed"}},
	}}
	configuration := config.Config{
		ObjectStorageProvider: config.ObjectStorageProviderOSS, ObjectStorageRegion: "cn-hangzhou",
		ObjectStorageBucket: "openrum-private", ObjectStorageEndpoint: "https://oss-cn-hangzhou.aliyuncs.com",
		ObjectStorageCredential: config.ObjectStorageCredentialEnvironment, ObjectStorageMaskedIdentity: "LTA••••7890",
	}
	router := adminStorageTestRouter(members, prober, configuration, adminID)

	response := performStorageRequest(router, http.MethodGet, "/api/v1/admin/object-storage", false)
	if response.Code != http.StatusOK || strings.Contains(response.Body.String(), "secret") || !strings.Contains(response.Body.String(), "LTA••••7890") {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	response = performStorageRequest(router, http.MethodPost, "/api/v1/admin/object-storage/test", true)
	if response.Code != http.StatusOK || !prober.called || !strings.Contains(response.Body.String(), `"success":true`) {
		t.Fatalf("status=%d called=%v body=%s", response.Code, prober.called, response.Body.String())
	}
}

func TestAdminStorageMissingConfigurationAndRoleAreExplicit(t *testing.T) {
	adminID, memberID := uuid.New(), uuid.New()
	members := &fakeInstanceMembers{roles: map[uuid.UUID]metadata.InstanceRole{adminID: metadata.InstanceRoleAdmin}}
	router := adminStorageTestRouter(members, nil, config.Config{}, adminID)
	response := performStorageRequest(router, http.MethodPost, "/api/v1/admin/object-storage/test", true)
	if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), "OBJECT_STORAGE_NOT_CONFIGURED") {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}

	router = adminStorageTestRouter(members, nil, config.Config{}, memberID)
	response = performStorageRequest(router, http.MethodGet, "/api/v1/admin/object-storage", false)
	if response.Code != http.StatusForbidden {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestAdminStorageStatusDescribesS3CompatibleProvider(t *testing.T) {
	adminID := uuid.New()
	members := &fakeInstanceMembers{roles: map[uuid.UUID]metadata.InstanceRole{adminID: metadata.InstanceRoleAdmin}}
	configuration := config.Config{
		ObjectStorageProvider: config.ObjectStorageProviderS3, ObjectStorageRegion: "us-east-1",
		ObjectStorageBucket: "openrum", ObjectStorageEndpoint: "https://storage.example.com",
		ObjectStorageCredential: config.ObjectStorageCredentialIAMRole,
	}
	response := performStorageRequest(adminStorageTestRouter(members, &fixedStorageProber{}, configuration, adminID), http.MethodGet, "/api/v1/admin/object-storage", false)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"provider":"s3"`) || !strings.Contains(response.Body.String(), `"providerLabel":"S3-compatible"`) {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestMaskStorageIdentityNeverReturnsTheCredential(t *testing.T) {
	for _, value := range []string{"A", "ABCD", "ABCDEFGH", "LTAI1234567890"} {
		masked := maskStorageIdentity(value)
		if masked == value || strings.Contains(masked, value) {
			t.Fatalf("credential %q was not masked: %q", value, masked)
		}
	}
}

func TestManagedStorageRejectsExpiredElevationBeforeReadingCredentials(t *testing.T) {
	adminID := uuid.New()
	members := &fakeInstanceMembers{roles: map[uuid.UUID]metadata.InstanceRole{adminID: metadata.InstanceRoleOwner}}
	handler := NewAdminStorageHandler(
		members,
		retentionReauthFixture{err: auth.ErrReauthenticationRequired},
		nil,
		config.Config{AllowManagedSecrets: true},
		zerolog.Nop(),
	)
	requireSession := httpx.RequireSession(adminAuthenticator{principals: map[string]auth.Principal{"session": {UserID: adminID}}})
	baseURL, _ := url.Parse("http://openrum.test")
	router := httpx.NewRouter(zerolog.Nop())
	router.Handle("PUT /api/v1/admin/object-storage/managed", requireSession(httpx.RequireCSRF(baseURL)(http.HandlerFunc(handler.PutManaged))))
	response := performStorageRequest(router, http.MethodPut, "/api/v1/admin/object-storage/managed", true)
	if response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), "REAUTHENTICATION_REQUIRED") {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestManagedStorageRotationProbesBeforePersistingOrSwapping(t *testing.T) {
	ownerID := uuid.New()
	members := &fakeInstanceMembers{roles: map[uuid.UUID]metadata.InstanceRole{ownerID: metadata.InstanceRoleOwner}}
	oldStorage := &managedStorageMemory{value: "old"}
	switcher := sourcemap.NewSwitchableStorage(oldStorage, nil)
	secrets := &fakeManagedStorageSecrets{}
	handler := NewAdminStorageHandler(
		members,
		retentionReauthFixture{},
		nil,
		config.Config{AllowManagedSecrets: true},
		zerolog.Nop(),
	)
	handler.EnableManagedSecrets(secrets, switcher)
	handler.newStorage = func(context.Context, metadata.ManagedObjectStorage) (sourcemap.Storage, sourcemap.Prober, error) {
		return &managedStorageMemory{value: "candidate"}, &fixedStorageProber{result: sourcemap.StorageProbeResult{
			Success: false, ErrorCode: "credentials", StartedAt: time.Now().UTC(),
		}}, nil
	}

	response := performAdminRequest(
		adminStorageManagedTestRouter(handler, ownerID),
		"session",
		http.MethodPut,
		"/api/v1/admin/object-storage/managed",
		managedStoragePayload(),
		true,
	)
	current, _ := switcher.Read(context.Background(), "test", 32)
	if response.Code != http.StatusUnprocessableEntity || secrets.called || string(current) != "old" {
		t.Fatalf("status=%d persisted=%v current=%q body=%s", response.Code, secrets.called, current, response.Body.String())
	}
}

func TestManagedStorageRotationPersistsThenSwapsAndUpdatesStatus(t *testing.T) {
	ownerID := uuid.New()
	members := &fakeInstanceMembers{roles: map[uuid.UUID]metadata.InstanceRole{ownerID: metadata.InstanceRoleOwner}}
	switcher := sourcemap.NewSwitchableStorage(&managedStorageMemory{value: "old"}, nil)
	secrets := &fakeManagedStorageSecrets{secret: metadata.InstanceSecret{Version: 2, KeyID: "key-2026"}}
	handler := NewAdminStorageHandler(
		members,
		retentionReauthFixture{},
		nil,
		config.Config{AllowManagedSecrets: true},
		zerolog.Nop(),
	)
	handler.EnableManagedSecrets(secrets, switcher)
	handler.newStorage = func(context.Context, metadata.ManagedObjectStorage) (sourcemap.Storage, sourcemap.Prober, error) {
		return &managedStorageMemory{value: "candidate"}, &fixedStorageProber{result: sourcemap.StorageProbeResult{
			Success: true, StartedAt: time.Now().UTC(),
			Steps: []sourcemap.StorageProbeStep{{Name: "write", Status: "passed"}, {Name: "read", Status: "passed"}, {Name: "delete", Status: "passed"}},
		}}, nil
	}

	response := performAdminRequest(
		adminStorageManagedTestRouter(handler, ownerID),
		"session",
		http.MethodPut,
		"/api/v1/admin/object-storage/managed",
		managedStoragePayload(),
		true,
	)
	current, _ := switcher.Read(context.Background(), "test", 32)
	status := handler.status()
	if response.Code != http.StatusOK || !secrets.called || string(current) != "candidate" ||
		status.CredentialSource != config.ObjectStorageCredentialManaged || status.MaskedIdentity == secrets.value.AccessKeyID ||
		strings.Contains(response.Body.String(), secrets.value.SecretAccessKey) {
		t.Fatalf("status=%d persisted=%v current=%q storage=%+v body=%s", response.Code, secrets.called, current, status, response.Body.String())
	}
}

func adminStorageManagedTestRouter(handler *AdminStorageHandler, userID uuid.UUID) http.Handler {
	router := httpx.NewRouter(zerolog.Nop())
	requireSession := httpx.RequireSession(adminAuthenticator{principals: map[string]auth.Principal{
		"session": {UserID: userID},
	}})
	baseURL, _ := url.Parse("http://openrum.test")
	router.Handle("PUT /api/v1/admin/object-storage/managed", requireSession(httpx.RequireCSRF(baseURL)(http.HandlerFunc(handler.PutManaged))))
	return router
}

func managedStoragePayload() string {
	return `{"provider":"oss","region":"cn-shanghai","bucket":"openrum","endpoint":"https://oss-cn-shanghai.aliyuncs.com","accessKeyId":"LTAI1234567890","secretAccessKey":"top-secret","forcePathStyle":false}`
}

func adminStorageTestRouter(members adminOverviewRoles, prober sourcemap.Prober, configuration config.Config, userID uuid.UUID) http.Handler {
	router := httpx.NewRouter(zerolog.Nop())
	handler := NewAdminStorageHandler(members, retentionReauthFixture{}, prober, configuration, zerolog.Nop())
	requireSession := httpx.RequireSession(adminAuthenticator{principals: map[string]auth.Principal{"session": {UserID: userID}}})
	baseURL, _ := url.Parse("http://openrum.test")
	requireCSRF := httpx.RequireCSRF(baseURL)
	router.Handle("GET /api/v1/admin/object-storage", requireSession(http.HandlerFunc(handler.Get)))
	router.Handle("POST /api/v1/admin/object-storage/test", requireSession(requireCSRF(http.HandlerFunc(handler.Test))))
	return router
}

func performStorageRequest(router http.Handler, method, path string, csrf bool) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, path, nil)
	request.Host = "openrum.test"
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "session"})
	if csrf {
		request.AddCookie(&http.Cookie{Name: auth.CSRFCookieName, Value: "csrf"})
		request.Header.Set("X-CSRF-Token", "csrf")
		request.Header.Set("Origin", "http://openrum.test")
	}
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	return response
}
