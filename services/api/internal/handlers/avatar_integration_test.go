//go:build integration

package handlers

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"openrum/internal/auth"
	"openrum/internal/avatar"
	"openrum/internal/httpx"
	"openrum/internal/metadata"
	"openrum/internal/migrate"
	"openrum/internal/sourcemap"
	"openrum/migrations"
)

// memoryAvatarStore stands in for object storage.
type memoryAvatarStore struct {
	mutex   sync.Mutex
	state   sourcemap.StorageState
	objects map[string][]byte
	types   map[string]string
	deleted []string
}

func newMemoryAvatarStore(state sourcemap.StorageState) *memoryAvatarStore {
	return &memoryAvatarStore{state: state, objects: map[string][]byte{}, types: map[string]string{}}
}

func (store *memoryAvatarStore) State() sourcemap.StorageState { return store.state }

func (store *memoryAvatarStore) Put(_ context.Context, key, contentType string, body []byte) error {
	store.mutex.Lock()
	defer store.mutex.Unlock()
	store.objects[key], store.types[key] = append([]byte(nil), body...), contentType
	return nil
}

func (store *memoryAvatarStore) Read(_ context.Context, key string, maximum int64) ([]byte, error) {
	store.mutex.Lock()
	defer store.mutex.Unlock()
	body, ok := store.objects[key]
	if !ok {
		return nil, errors.New("missing")
	}
	if int64(len(body)) > maximum {
		return nil, sourcemap.ErrObjectMismatch
	}
	return body, nil
}

func (store *memoryAvatarStore) Delete(_ context.Context, key string) error {
	store.mutex.Lock()
	defer store.mutex.Unlock()
	store.deleted = append(store.deleted, key)
	delete(store.objects, key)
	return nil
}

func pngPicture(t *testing.T, size int, shade uint8) []byte {
	t.Helper()
	picture := image.NewRGBA(image.Rect(0, 0, size, size))
	for x := 0; x < size; x++ {
		for y := 0; y < size; y++ {
			picture.Set(x, y, color.RGBA{R: shade, G: uint8(x), B: uint8(y), A: 255})
		}
	}
	var buffer bytes.Buffer
	if err := png.Encode(&buffer, picture); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func avatarRequest(t *testing.T, router http.Handler, session, method, path, contentType string, body []byte, csrf bool) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequestWithContext(context.Background(), method, path, bytes.NewReader(body))
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: session})
	request.AddCookie(&http.Cookie{Name: auth.CSRFCookieName, Value: "test-csrf-token"})
	if contentType != "" {
		request.Header.Set("Content-Type", contentType)
	}
	if csrf {
		request.Header.Set("Origin", "http://openrum.test")
		request.Header.Set(httpx.CSRFHeader, "test-csrf-token")
	}
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	return response
}

func avatarRouter(database *sql.DB, store avatarStore, principals map[string]auth.Principal) http.Handler {
	logger := zerolog.Nop()
	router := httpx.NewRouter(logger)
	handler := NewAvatarHandler(metadata.NewAvatarRepository(database), store, logger)
	baseURL, _ := url.Parse("http://openrum.test")
	requireSession := httpx.RequireSession(fixtureAuthenticator{principals: principals})
	requireCSRF := httpx.RequireCSRF(baseURL)
	router.Handle("GET /api/v1/auth/avatar/status", requireSession(http.HandlerFunc(handler.Status)))
	router.Handle("PUT /api/v1/auth/avatar", requireSession(requireCSRF(http.HandlerFunc(handler.Set))))
	router.Handle("GET /api/v1/users/{userId}/avatar", requireSession(http.HandlerFunc(handler.Get)))
	return router
}

func TestAvatarsFlow(t *testing.T) {
	database := openControlPlaneTestDatabase(t)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	if err := migrate.PostgresUp(ctx, database, migrations.Files); err != nil {
		t.Fatal(err)
	}
	const truncate = "TRUNCATE audit_logs, sessions, organization_join_requests, organization_invitations, project_keys, projects, organization_members, organizations, users CASCADE"
	if _, err := database.ExecContext(ctx, truncate); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = database.ExecContext(context.Background(), truncate) })

	ada, grace, outsider := uuid.New(), uuid.New(), uuid.New()
	for _, user := range []struct {
		id    uuid.UUID
		email string
	}{{ada, "ada@example.com"}, {grace, "grace@example.com"}, {outsider, "outsider@example.com"}} {
		if _, err := database.ExecContext(ctx,
			"INSERT INTO users (id,email,display_name,password_hash) VALUES ($1,$2,$3,'hash')", user.id, user.email, user.email); err != nil {
			t.Fatal(err)
		}
	}
	organizations := metadata.NewOrganizationRepository(database)
	created, err := organizations.Create(ctx, ada, "Acme", "acme")
	if err != nil {
		t.Fatal(err)
	}
	if err := organizations.AddMember(ctx, ada, created.Organization.ID, grace, metadata.RoleMember); err != nil {
		t.Fatal(err)
	}
	principals := map[string]auth.Principal{
		"ada":      {UserID: ada, Email: "ada@example.com", AccessStatus: "approved"},
		"grace":    {UserID: grace, Email: "grace@example.com", AccessStatus: "approved"},
		"outsider": {UserID: outsider, Email: "outsider@example.com", AccessStatus: "approved"},
	}
	store := newMemoryAvatarStore(sourcemap.StorageReady)
	router := avatarRouter(database, store, principals)
	own := "/api/v1/users/" + ada.String() + "/avatar"
	stored := func() string {
		var value sql.NullString
		if err := database.QueryRowContext(ctx, "SELECT avatar FROM users WHERE id=$1", ada).Scan(&value); err != nil {
			t.Fatal(err)
		}
		return value.String
	}

	t.Run("status says what can be offered", func(t *testing.T) {
		response := avatarRequest(t, router, "ada", http.MethodGet, "/api/v1/auth/avatar/status", "", nil, false)
		assertStatus(t, response, http.StatusOK)
		var status struct {
			UploadAvailable bool     `json:"uploadAvailable"`
			MaxUploadBytes  int      `json:"maxUploadBytes"`
			Styles          []string `json:"styles"`
		}
		decodeResponse(t, response, &status)
		if !status.UploadAvailable || status.MaxUploadBytes != avatar.MaxUploadBytes || len(status.Styles) != len(avatar.Styles) {
			t.Fatalf("status=%+v", status)
		}
		for _, state := range []sourcemap.StorageState{sourcemap.StorageNotConfigured, sourcemap.StorageUnavailable} {
			closed := avatarRouter(database, newMemoryAvatarStore(state), principals)
			decodeResponse(t, avatarRequest(t, closed, "ada", http.MethodGet, "/api/v1/auth/avatar/status", "", nil, false), &status)
			if status.UploadAvailable {
				t.Fatalf("uploadAvailable=true with storage %s", state)
			}
		}
	})

	t.Run("a generated avatar is picked, replaced and cleared", func(t *testing.T) {
		pick := func(body string) *httptest.ResponseRecorder {
			return avatarRequest(t, router, "ada", http.MethodPut, "/api/v1/auth/avatar", "application/json", []byte(body), true)
		}
		assertStatus(t, pick(`{"avatar":"dicebear:lorelei:abc123"}`), http.StatusOK)
		if stored() != "dicebear:lorelei:abc123" {
			t.Fatalf("stored=%q", stored())
		}
		assertStatus(t, pick(`{"avatar":"dicebear:thumbs:zzz"}`), http.StatusOK)
		assertStatus(t, pick(`{"avatar":null}`), http.StatusOK)
		if stored() != "" {
			t.Fatalf("stored=%q after clearing", stored())
		}
		for _, bad := range []string{
			`{"avatar":"dicebear:fun-emoji:abc"}`, `{"avatar":"dicebear:lorelei:a b"}`, `{"avatar":"https://evil.example/a.svg"}`,
			`{"avatar":"upload:` + strings.Repeat("a", 32) + `"}`, `{"avatar":""}`, `{"avatar":1}`, `{"other":1}`,
		} {
			if response := pick(bad); response.Code != http.StatusBadRequest {
				t.Errorf("%s -> %d, want 400", bad, response.Code)
			}
		}
		if stored() != "" {
			t.Fatalf("a refused request changed the avatar to %q", stored())
		}
	})

	t.Run("requests need a session, a CSRF token and a known content type", func(t *testing.T) {
		assertStatus(t, avatarRequest(t, router, "nobody", http.MethodPut, "/api/v1/auth/avatar", "application/json", []byte(`{"avatar":null}`), true), http.StatusUnauthorized)
		assertStatus(t, avatarRequest(t, router, "ada", http.MethodPut, "/api/v1/auth/avatar", "application/json", []byte(`{"avatar":null}`), false), http.StatusForbidden)
		assertStatus(t, avatarRequest(t, router, "ada", http.MethodPut, "/api/v1/auth/avatar", "text/plain", []byte("x"), true), http.StatusUnsupportedMediaType)
		assertStatus(t, avatarRequest(t, router, "ada", http.MethodPut, "/api/v1/auth/avatar", "image/svg+xml", []byte("<svg/>"), true), http.StatusUnsupportedMediaType)
	})

	var firstHash string
	t.Run("an uploaded picture is checked, stored and referenced by hash", func(t *testing.T) {
		response := avatarRequest(t, router, "ada", http.MethodPut, "/api/v1/auth/avatar", "image/png", pngPicture(t, 256, 10), true)
		assertStatus(t, response, http.StatusOK)
		var result struct {
			Avatar string `json:"avatar"`
		}
		decodeResponse(t, response, &result)
		hash, ok := avatar.ParseUpload(result.Avatar)
		if !ok || stored() != result.Avatar {
			t.Fatalf("avatar=%q stored=%q", result.Avatar, stored())
		}
		firstHash = hash
		key := avatar.ObjectKey(ada, hash)
		if store.types[key] != "image/png" || len(store.objects[key]) == 0 {
			t.Fatalf("object %s: type=%q size=%d", key, store.types[key], len(store.objects[key]))
		}
	})

	t.Run("a picture that is not a usable PNG is refused and changes nothing", func(t *testing.T) {
		before := stored()
		objects := len(store.objects)
		for name, body := range map[string][]byte{
			"svg":       []byte(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`),
			"too small": pngPicture(t, 8, 1),
			"too large": pngPicture(t, 600, 1),
			"garbage":   []byte("\x89PNG\r\n\x1a\nnot really"),
		} {
			if response := avatarRequest(t, router, "ada", http.MethodPut, "/api/v1/auth/avatar", "image/png", body, true); response.Code != http.StatusBadRequest {
				t.Errorf("%s -> %d, want 400", name, response.Code)
			}
		}
		oversized := append(pngPicture(t, 64, 1), make([]byte, avatar.MaxUploadBytes)...)
		assertStatus(t, avatarRequest(t, router, "ada", http.MethodPut, "/api/v1/auth/avatar", "image/png", oversized, true), http.StatusRequestEntityTooLarge)
		if stored() != before || len(store.objects) != objects {
			t.Fatalf("a refused upload changed state: avatar=%q objects=%d", stored(), len(store.objects))
		}
	})

	t.Run("an upload needs object storage", func(t *testing.T) {
		for _, state := range []sourcemap.StorageState{sourcemap.StorageNotConfigured, sourcemap.StorageUnavailable} {
			closed := avatarRouter(database, newMemoryAvatarStore(state), principals)
			response := avatarRequest(t, closed, "ada", http.MethodPut, "/api/v1/auth/avatar", "image/png", pngPicture(t, 128, 3), true)
			assertStatus(t, response, http.StatusConflict)
			if !strings.Contains(response.Body.String(), "OBJECT_STORAGE_NOT_CONFIGURED") {
				t.Fatalf("body=%s", response.Body.String())
			}
		}
		// Picking a generated avatar never needs storage.
		closed := avatarRouter(database, newMemoryAvatarStore(sourcemap.StorageNotConfigured), principals)
		assertStatus(t, avatarRequest(t, closed, "grace", http.MethodPut, "/api/v1/auth/avatar", "application/json", []byte(`{"avatar":"dicebear:shapes:q1"}`), true), http.StatusOK)
	})

	t.Run("the picture is served to its owner and to people in a shared organization", func(t *testing.T) {
		path := own + "?v=" + firstHash
		for _, viewer := range []string{"ada", "grace"} {
			response := avatarRequest(t, router, viewer, http.MethodGet, path, "", nil, false)
			assertStatus(t, response, http.StatusOK)
			header := response.Header()
			if header.Get("Content-Type") != "image/png" || header.Get("X-Content-Type-Options") != "nosniff" {
				t.Fatalf("%s headers=%v", viewer, header)
			}
			if !strings.Contains(header.Get("Cache-Control"), "immutable") || !strings.Contains(header.Get("Cache-Control"), "private") {
				t.Fatalf("cache=%q", header.Get("Cache-Control"))
			}
			if _, err := png.Decode(bytes.NewReader(response.Body.Bytes())); err != nil {
				t.Fatalf("%s got something that is not a PNG: %v", viewer, err)
			}
		}
		// Without the matching hash the address is not cacheable for good.
		stale := avatarRequest(t, router, "ada", http.MethodGet, own+"?v=old", "", nil, false)
		assertStatus(t, stale, http.StatusOK)
		if strings.Contains(stale.Header().Get("Cache-Control"), "immutable") {
			t.Fatalf("cache=%q", stale.Header().Get("Cache-Control"))
		}
	})

	t.Run("a stranger cannot fetch it, and cannot tell it exists", func(t *testing.T) {
		assertStatus(t, avatarRequest(t, router, "outsider", http.MethodGet, own, "", nil, false), http.StatusNotFound)
		assertStatus(t, avatarRequest(t, router, "outsider", http.MethodGet, "/api/v1/users/"+uuid.NewString()+"/avatar", "", nil, false), http.StatusNotFound)
		assertStatus(t, avatarRequest(t, router, "nobody", http.MethodGet, own, "", nil, false), http.StatusUnauthorized)
		assertStatus(t, avatarRequest(t, router, "ada", http.MethodGet, "/api/v1/users/not-a-uuid/avatar", "", nil, false), http.StatusNotFound)
	})

	t.Run("someone without an uploaded picture has nothing to serve", func(t *testing.T) {
		assertStatus(t, avatarRequest(t, router, "ada", http.MethodGet, "/api/v1/users/"+grace.String()+"/avatar", "", nil, false), http.StatusNotFound)
	})

	t.Run("replacing an upload removes the old object", func(t *testing.T) {
		response := avatarRequest(t, router, "ada", http.MethodPut, "/api/v1/auth/avatar", "image/png", pngPicture(t, 200, 90), true)
		assertStatus(t, response, http.StatusOK)
		oldKey := avatar.ObjectKey(ada, firstHash)
		if _, stillThere := store.objects[oldKey]; stillThere || len(store.deleted) == 0 || store.deleted[len(store.deleted)-1] != oldKey {
			t.Fatalf("old object not removed: deleted=%v", store.deleted)
		}
		// Uploading the very same picture again must not delete the object it just wrote.
		again := avatarRequest(t, router, "ada", http.MethodPut, "/api/v1/auth/avatar", "image/png", pngPicture(t, 200, 90), true)
		assertStatus(t, again, http.StatusOK)
		current, _ := avatar.ParseUpload(stored())
		if _, ok := store.objects[avatar.ObjectKey(ada, current)]; !ok {
			t.Fatal("re-uploading the same picture deleted it")
		}
		// Choosing a generated avatar drops the upload too.
		assertStatus(t, avatarRequest(t, router, "ada", http.MethodPut, "/api/v1/auth/avatar", "application/json", []byte(`{"avatar":"dicebear:notionists:n1"}`), true), http.StatusOK)
		if _, ok := store.objects[avatar.ObjectKey(ada, current)]; ok {
			t.Fatal("the upload outlived the choice of a generated avatar")
		}
		assertStatus(t, avatarRequest(t, router, "ada", http.MethodGet, own, "", nil, false), http.StatusNotFound)
	})

	t.Run("members and requests carry the picture reference", func(t *testing.T) {
		if _, err := database.ExecContext(ctx, "UPDATE users SET avatar='dicebear:thumbs:grace1' WHERE id=$1", grace); err != nil {
			t.Fatal(err)
		}
		members, err := organizations.ListMembers(ctx, ada, created.Organization.ID)
		if err != nil {
			t.Fatal(err)
		}
		got := map[uuid.UUID]string{}
		for _, member := range members {
			got[member.UserID] = member.Avatar
		}
		if got[grace] != "dicebear:thumbs:grace1" || got[ada] != "dicebear:notionists:n1" {
			t.Fatalf("members=%v", got)
		}
		member, err := organizations.GetMember(ctx, ada, created.Organization.ID, grace)
		if err != nil || member.Avatar != "dicebear:thumbs:grace1" {
			t.Fatalf("member=%+v err=%v", member, err)
		}
	})
}
