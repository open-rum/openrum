//go:build integration

package handlers

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
)

func TestOAuthCallbackConsumesStateOnceAndStartIsRateLimited(t *testing.T) {
	address := os.Getenv("TEST_REDIS_ADDR")
	if address == "" {
		t.Skip("TEST_REDIS_ADDR is not set")
	}
	client := redis.NewClient(&redis.Options{Addr: address, DB: 15})
	defer func() { _ = client.Close() }()
	handler := &ExternalAuthHandler{redis: client}
	state, err := randomFlowToken()
	if err != nil {
		t.Fatal(err)
	}
	flow, _ := json.Marshal(oauthFlow{ProviderID: "company", Purpose: "login", BindingHash: hex.EncodeToString(sha256.New().Sum(nil))})
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	key := "openrum:oauth:" + state
	if err := client.Set(ctx, key, flow, time.Minute).Err(); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = client.Del(context.Background(), key).Err() }()
	for attempt := range 2 {
		request := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/auth/providers/company/callback?state="+state+"&code=one-use", nil)
		request.SetPathValue("providerId", "company")
		response := httptest.NewRecorder()
		handler.Callback(response, request)
		want := "/login?error=external"
		if attempt == 1 {
			want = "/login?error=expired"
		}
		if response.Code != http.StatusSeeOther || response.Header().Get("Location") != want {
			t.Fatalf("attempt %d: status=%d location=%s", attempt, response.Code, response.Header().Get("Location"))
		}
	}
	if exists, err := client.Exists(ctx, key).Result(); err != nil || exists != 0 {
		t.Fatalf("callback state remained after first use: exists=%d err=%v", exists, err)
	}
	cancelState, err := randomFlowToken()
	if err != nil {
		t.Fatal(err)
	}
	binding := "browser-binding"
	bindingDigest := sha256.Sum256([]byte(binding))
	cancelFlow, _ := json.Marshal(oauthFlow{ProviderID: "company", Purpose: "login",
		ReturnTo: "/projects/example?tab=events", BindingHash: hex.EncodeToString(bindingDigest[:])})
	cancelKey := "openrum:oauth:" + cancelState
	if err := client.Set(ctx, cancelKey, cancelFlow, time.Minute).Err(); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = client.Del(context.Background(), cancelKey).Err() }()
	cancelRequest := httptest.NewRequestWithContext(context.Background(), http.MethodGet,
		"/api/v1/auth/providers/company/callback?state="+cancelState+"&error=access_denied", nil)
	cancelRequest.SetPathValue("providerId", "company")
	cancelRequest.AddCookie(&http.Cookie{Name: flowCookieName(cancelState), Value: binding})
	cancelResponse := httptest.NewRecorder()
	handler.Callback(cancelResponse, cancelRequest)
	if got := cancelResponse.Header().Get("Location"); got != "/login?error=cancelled&returnTo=%2Fprojects%2Fexample%3Ftab%3Devents" {
		t.Fatalf("cancelled login lost safe return address: %s", got)
	}
	ip := "198.51.100.42"
	request := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/v1/auth/providers/company/start", nil)
	request.RemoteAddr = ip + ":4321"
	for attempt := range oauthStartLimit + 1 {
		allowed, err := handler.oauthStartAllowed(request)
		if err != nil || allowed != (attempt < oauthStartLimit) {
			t.Fatalf("start attempt %d: allowed=%v err=%v", attempt, allowed, err)
		}
	}
	digest := sha256.Sum256([]byte(ip))
	_ = client.Del(ctx, "openrum:oauth:start:"+hex.EncodeToString(digest[:])).Err()
}
