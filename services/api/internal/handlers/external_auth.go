package handlers

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"

	"openrum/internal/auth"
	"openrum/internal/httpx"
	"openrum/internal/metadata"
)

const oauthFlowTTL = 10 * time.Minute

const oauthStartLimit = 20

type ExternalAuthHandler struct {
	store        *auth.ExternalStore
	sessions     *auth.SessionManager
	redis        redis.UniversalClient
	limiter      auth.FailureLimiter
	members      *metadata.InstanceMemberRepository
	baseURL      *url.URL
	secureCookie bool
	logger       zerolog.Logger
}

type oauthFlow struct {
	ProviderID  string `json:"providerId"`
	Version     int64  `json:"version"`
	Purpose     string `json:"purpose"`
	UserID      string `json:"userId,omitempty"`
	SessionID   string `json:"sessionId,omitempty"`
	ReturnTo    string `json:"returnTo"`
	Nonce       string `json:"nonce"`
	Verifier    string `json:"verifier"`
	BindingHash string `json:"bindingHash"`
}

func NewExternalAuthHandler(store *auth.ExternalStore, sessions *auth.SessionManager, redisClient redis.UniversalClient,
	limiter auth.FailureLimiter, members *metadata.InstanceMemberRepository, baseURL *url.URL, secureCookie bool, logger zerolog.Logger) *ExternalAuthHandler {
	return &ExternalAuthHandler{store: store, sessions: sessions, redis: redisClient, limiter: limiter, members: members, baseURL: baseURL, secureCookie: secureCookie, logger: logger}
}

func (handler *ExternalAuthHandler) Methods(writer http.ResponseWriter, request *http.Request) {
	providers, err := handler.store.ListProviders(request.Context(), true)
	if err != nil {
		handler.internalError(writer, request, err)
		return
	}
	methods := make([]map[string]string, 0, len(providers))
	for _, p := range providers {
		methods = append(methods, map[string]string{"id": p.ID, "kind": p.Kind, "label": p.Label})
	}
	writeJSON(writer, http.StatusOK, map[string]any{"local": true, "providers": methods})
}

func (handler *ExternalAuthHandler) AdminGet(writer http.ResponseWriter, request *http.Request) {
	if _, ok := handler.authorizeAdmin(writer, request); !ok {
		return
	}
	providers, err := handler.store.ListProviders(request.Context(), false)
	if err != nil {
		handler.internalError(writer, request, err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"managedSecretsAvailable": handler.store.ManagedSecretsAvailable(), "providers": providers})
}

func (handler *ExternalAuthHandler) AdminPut(writer http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorizeAdmin(writer, request)
	if !ok {
		return
	}
	if !requireAdminElevation(writer, request, principal, handler.sessions, handler.logger) {
		return
	}
	var payload struct {
		Kind     string                `json:"kind"`
		Label    string                `json:"label"`
		Enabled  bool                  `json:"enabled"`
		Settings auth.ProviderSettings `json:"settings"`
		Secret   string                `json:"secret"`
	}
	if !decodeJSONBody(writer, request, &payload) {
		return
	}
	provider := auth.Provider{ID: request.PathValue("providerId"), Kind: payload.Kind, Label: payload.Label, Enabled: payload.Enabled, Settings: payload.Settings}
	if err := auth.ValidateProvider(&provider); err != nil {
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "Provider configuration is invalid.")
		return
	}
	if err := handler.store.SaveProvider(request.Context(), principal.UserID, provider, payload.Secret); err != nil {
		switch {
		case errors.Is(err, auth.ErrProviderChanged):
			httpx.WriteError(writer, request, http.StatusConflict, "PROVIDER_IDENTITY_CHANGED", "Create a new provider ID for a different identity directory.")
		case errors.Is(err, auth.ErrProviderUnavailable):
			httpx.WriteError(writer, request, http.StatusConflict, "MANAGED_SECRETS_DISABLED", "Managed secrets and a provider secret are required.")
		default:
			handler.internalError(writer, request, err)
		}
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

func (handler *ExternalAuthHandler) AdminDisable(writer http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorizeAdmin(writer, request)
	if !ok {
		return
	}
	if !requireAdminElevation(writer, request, principal, handler.sessions, handler.logger) {
		return
	}
	if err := handler.store.DisableProvider(request.Context(), request.PathValue("providerId")); err != nil {
		httpx.WriteError(writer, request, http.StatusNotFound, "PROVIDER_NOT_FOUND", "Provider was not found.")
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

func (handler *ExternalAuthHandler) AdminTest(writer http.ResponseWriter, request *http.Request) {
	principal, ok := handler.authorizeAdmin(writer, request)
	if !ok {
		return
	}
	if !requireAdminElevation(writer, request, principal, handler.sessions, handler.logger) {
		return
	}
	provider, err := handler.store.GetProviderForTest(request.Context(), request.PathValue("providerId"))
	if err != nil {
		httpx.WriteError(writer, request, http.StatusNotFound, "PROVIDER_NOT_FOUND", "Configured provider was not found.")
		return
	}
	if provider.Kind == "ldap" {
		err = auth.TestLDAPProvider(provider)
		if err != nil {
			httpx.WriteError(writer, request, http.StatusBadGateway, "PROVIDER_UNAVAILABLE", "Provider connection failed.")
			return
		}
		writeJSON(writer, http.StatusOK, map[string]bool{"connected": true})
		return
	}
	handler.startOAuth(writer, request, "test", principal)
}

func (handler *ExternalAuthHandler) authorizeAdmin(writer http.ResponseWriter, request *http.Request) (auth.Principal, bool) {
	principal, ok := httpx.PrincipalFromContext(request.Context())
	if !ok {
		httpx.WriteError(writer, request, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication is required.")
		return auth.Principal{}, false
	}
	role, err := handler.members.RoleForUser(request.Context(), principal.UserID)
	if err != nil {
		httpx.WriteError(writer, request, http.StatusForbidden, "FORBIDDEN", "Instance access is required.")
		return auth.Principal{}, false
	}
	if role != metadata.InstanceRoleOwner {
		httpx.WriteError(writer, request, http.StatusForbidden, "FORBIDDEN", "Instance Owner access is required.")
		return auth.Principal{}, false
	}
	return principal, true
}

func (handler *ExternalAuthHandler) StartLogin(writer http.ResponseWriter, request *http.Request) {
	if !handler.requireOrigin(writer, request) {
		return
	}
	handler.startOAuth(writer, request, "login", auth.Principal{})
}

func (handler *ExternalAuthHandler) StartLink(writer http.ResponseWriter, request *http.Request) {
	principal, ok := httpx.PrincipalFromContext(request.Context())
	if !ok {
		httpx.WriteError(writer, request, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication is required.")
		return
	}
	handler.startOAuth(writer, request, "link", principal)
}

func (handler *ExternalAuthHandler) startOAuth(writer http.ResponseWriter, request *http.Request, purpose string, principal auth.Principal) {
	var provider auth.Provider
	var err error
	if purpose == "test" {
		provider, err = handler.store.GetProviderForTest(request.Context(), request.PathValue("providerId"))
	} else {
		provider, err = handler.store.GetProvider(request.Context(), request.PathValue("providerId"))
	}
	if err != nil || provider.Kind == "ldap" {
		httpx.WriteError(writer, request, http.StatusNotFound, "PROVIDER_NOT_FOUND", "Authentication method is unavailable.")
		return
	}
	var payload struct {
		ReturnTo string `json:"returnTo"`
	}
	if purpose != "test" && !decodeJSONBody(writer, request, &payload) {
		return
	}
	allowed, err := handler.oauthStartAllowed(request)
	if err != nil {
		handler.internalError(writer, request, err)
		return
	}
	if !allowed {
		httpx.WriteError(writer, request, http.StatusTooManyRequests, "LOGIN_RATE_LIMITED", "Too many login attempts. Try again later.")
		return
	}
	state, err := randomFlowToken()
	if err != nil {
		handler.internalError(writer, request, err)
		return
	}
	nonce, err := randomFlowToken()
	if err != nil {
		handler.internalError(writer, request, err)
		return
	}
	verifier, err := randomFlowToken()
	if err != nil {
		handler.internalError(writer, request, err)
		return
	}
	binding, err := randomFlowToken()
	if err != nil {
		handler.internalError(writer, request, err)
		return
	}
	authorizationURL, err := auth.OAuthAuthorizationURL(request.Context(), provider, handler.callbackURL(provider.ID), state, nonce, verifier)
	if err != nil {
		httpx.WriteError(writer, request, http.StatusBadGateway, "PROVIDER_UNAVAILABLE", "Authentication method is unavailable.")
		return
	}
	digest := sha256.Sum256([]byte(binding))
	flow := oauthFlow{ProviderID: provider.ID, Version: provider.Version, Purpose: purpose, ReturnTo: safeServerReturnTo(payload.ReturnTo), Nonce: nonce, Verifier: verifier, BindingHash: hex.EncodeToString(digest[:])}
	if purpose == "link" || purpose == "test" {
		flow.UserID = principal.UserID.String()
		flow.SessionID = principal.SessionID.String()
	}
	data, err := json.Marshal(flow)
	if err != nil {
		handler.internalError(writer, request, err)
		return
	}
	if err := handler.redis.Set(request.Context(), "openrum:oauth:"+state, data, oauthFlowTTL).Err(); err != nil {
		handler.internalError(writer, request, err)
		return
	}
	http.SetCookie(writer, &http.Cookie{Name: flowCookieName(state), Value: binding, Path: "/api/v1/auth/providers/", MaxAge: int(oauthFlowTTL.Seconds()), HttpOnly: true, Secure: handler.secureCookie, SameSite: http.SameSiteLaxMode})
	writeJSON(writer, http.StatusOK, map[string]string{"authorizationUrl": authorizationURL})
}

func (handler *ExternalAuthHandler) Callback(writer http.ResponseWriter, request *http.Request) {
	state := request.URL.Query().Get("state")
	if len(state) < 32 || len(state) > 128 {
		handler.redirectFailure(writer, request, "login", "expired")
		return
	}
	data, err := handler.redis.GetDel(request.Context(), "openrum:oauth:"+state).Bytes()
	if err != nil {
		handler.redirectFailure(writer, request, "login", "expired")
		return
	}
	var flow oauthFlow
	if json.Unmarshal(data, &flow) != nil || flow.ProviderID != request.PathValue("providerId") {
		handler.redirectFailure(writer, request, "login")
		return
	}
	bindingCookie, err := request.Cookie(flowCookieName(state))
	if err != nil {
		handler.redirectFlowFailure(writer, request, flow, "external")
		return
	}
	http.SetCookie(writer, &http.Cookie{Name: flowCookieName(state), Path: "/api/v1/auth/providers/", MaxAge: -1, HttpOnly: true, Secure: handler.secureCookie, SameSite: http.SameSiteLaxMode})
	digest := sha256.Sum256([]byte(bindingCookie.Value))
	expected, err := hex.DecodeString(flow.BindingHash)
	if err != nil || subtle.ConstantTimeCompare(digest[:], expected) != 1 {
		handler.redirectFlowFailure(writer, request, flow, "external")
		return
	}
	if providerError := request.URL.Query().Get("error"); providerError != "" || request.URL.Query().Get("code") == "" {
		reason := "external"
		if providerError == "access_denied" {
			reason = "cancelled"
		}
		handler.redirectFlowFailure(writer, request, flow, reason)
		return
	}
	var provider auth.Provider
	if flow.Purpose == "test" {
		provider, err = handler.store.GetProviderForTest(request.Context(), flow.ProviderID)
	} else {
		provider, err = handler.store.GetProvider(request.Context(), flow.ProviderID)
	}
	if err != nil || provider.Version != flow.Version {
		handler.redirectFlowFailure(writer, request, flow, "external")
		return
	}
	identity, err := auth.ExchangeOAuthIdentity(request.Context(), provider, handler.callbackURL(provider.ID), request.URL.Query().Get("code"), flow.Nonce, flow.Verifier)
	if err != nil {
		handler.logger.Warn().Str("provider", provider.ID).Msg("external login rejected")
		handler.redirectFlowFailure(writer, request, flow, "external")
		return
	}
	if flow.Purpose == "link" || flow.Purpose == "test" {
		cookie, cookieErr := request.Cookie(auth.SessionCookieName)
		if cookieErr != nil {
			handler.redirectFlowFailure(writer, request, flow, "external")
			return
		}
		principal, authErr := handler.sessions.Authenticate(request.Context(), cookie.Value)
		if authErr != nil || principal.UserID.String() != flow.UserID || principal.SessionID.String() != flow.SessionID || principal.AccessStatus != "approved" {
			handler.redirectFlowFailure(writer, request, flow, "external")
			return
		}
		if flow.Purpose == "test" {
			if principal.InstanceRole != string(metadata.InstanceRoleOwner) {
				handler.redirectFlowFailure(writer, request, flow, "external")
				return
			}
			http.Redirect(writer, request, "/settings/instance/authentication?test=success", http.StatusSeeOther)
			return
		}
		if err := handler.store.LinkIdentity(request.Context(), principal.UserID, provider, identity.Subject); err != nil {
			handler.redirectFlowFailure(writer, request, flow, "external")
			return
		}
		http.Redirect(writer, request, "/settings/account?link=success", http.StatusSeeOther)
		return
	}
	user, err := handler.store.ResolveIdentity(request.Context(), provider, identity.Subject, identity.Email, identity.Name)
	if err != nil {
		handler.redirectFlowFailure(writer, request, flow, "external")
		return
	}
	target, ok := handler.issueSession(writer, request, user, flow.ReturnTo)
	if !ok {
		return
	}
	http.Redirect(writer, request, target, http.StatusSeeOther)
}

func (handler *ExternalAuthHandler) LDAPLogin(writer http.ResponseWriter, request *http.Request) {
	if !handler.requireOrigin(writer, request) {
		return
	}
	handler.ldapAuthenticate(writer, request, false, auth.Principal{})
}

func (handler *ExternalAuthHandler) LDAPLink(writer http.ResponseWriter, request *http.Request) {
	principal, ok := httpx.PrincipalFromContext(request.Context())
	if !ok {
		httpx.WriteError(writer, request, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication is required.")
		return
	}
	handler.ldapAuthenticate(writer, request, true, principal)
}

func (handler *ExternalAuthHandler) ldapAuthenticate(writer http.ResponseWriter, request *http.Request, link bool, principal auth.Principal) {
	provider, err := handler.store.GetProvider(request.Context(), request.PathValue("providerId"))
	if err != nil || provider.Kind != "ldap" {
		httpx.WriteError(writer, request, http.StatusNotFound, "PROVIDER_NOT_FOUND", "Authentication method is unavailable.")
		return
	}
	var payload struct {
		Username string `json:"username"`
		Password string `json:"password"`
		ReturnTo string `json:"returnTo"`
	}
	if !decodeJSONBody(writer, request, &payload) {
		return
	}
	account := provider.ID + ":" + strings.ToLower(strings.TrimSpace(payload.Username))
	ip := remoteIPAddress(request)
	if !handler.limiter.Allow(request.Context(), ip, account) {
		httpx.WriteError(writer, request, http.StatusTooManyRequests, "LOGIN_RATE_LIMITED", "Too many login attempts. Try again later.")
		return
	}
	identity, err := auth.AuthenticateLDAP(provider, payload.Username, payload.Password)
	if err != nil {
		handler.limiter.Failed(request.Context(), ip, account)
		httpx.WriteError(writer, request, http.StatusUnauthorized, "INVALID_CREDENTIALS", "Directory credentials are invalid.")
		return
	}
	handler.limiter.Succeeded(request.Context(), account)
	if link {
		if err := handler.store.LinkIdentity(request.Context(), principal.UserID, provider, identity.Subject); err != nil {
			httpx.WriteError(writer, request, http.StatusConflict, "IDENTITY_CONFLICT", "Directory identity cannot be linked.")
			return
		}
		writer.WriteHeader(http.StatusNoContent)
		return
	}
	user, err := handler.store.ResolveIdentity(request.Context(), provider, identity.Subject, identity.Email, identity.Name)
	if err != nil {
		httpx.WriteError(writer, request, http.StatusConflict, "IDENTITY_CONFLICT", "Use an existing sign-in method and link this identity in Account settings.")
		return
	}
	target, ok := handler.issueSession(writer, request, user, safeServerReturnTo(payload.ReturnTo))
	if !ok {
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"userId": user.ID.String(), "email": user.Email, "displayName": user.DisplayName, "accessStatus": user.AccessStatus, "returnTo": target})
}

func (handler *ExternalAuthHandler) issueSession(writer http.ResponseWriter, request *http.Request, user auth.ExternalUser, returnTo string) (string, bool) {
	previous := ""
	if cookie, err := request.Cookie(auth.SessionCookieName); err == nil {
		previous = cookie.Value
	}
	credentials, err := handler.sessions.Rotate(request.Context(), user.ID, previous, remoteIPAddress(request), request.UserAgent())
	if err != nil {
		handler.internalError(writer, request, err)
		return "", false
	}
	setAuthenticationCookies(writer, credentials, handler.secureCookie)
	if user.AccessStatus == "pending" {
		returnTo = "/awaiting-access?returnTo=" + url.QueryEscape(returnTo)
	}
	return returnTo, true
}

func (handler *ExternalAuthHandler) Identities(writer http.ResponseWriter, request *http.Request) {
	principal, ok := httpx.PrincipalFromContext(request.Context())
	if !ok {
		return
	}
	identities, err := handler.store.ListIdentities(request.Context(), principal.UserID)
	if err != nil {
		handler.internalError(writer, request, err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"identities": identities})
}

func (handler *ExternalAuthHandler) Unlink(writer http.ResponseWriter, request *http.Request) {
	principal, ok := httpx.PrincipalFromContext(request.Context())
	if !ok {
		return
	}
	id, err := uuid.Parse(request.PathValue("identityId"))
	if err != nil {
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "Identity ID is invalid.")
		return
	}
	if err := handler.store.UnlinkIdentity(request.Context(), principal.UserID, id); err != nil {
		if errors.Is(err, auth.ErrIdentityLastMethod) {
			httpx.WriteError(writer, request, http.StatusConflict, "LAST_LOGIN_METHOD", "The last login method cannot be removed.")
			return
		}
		httpx.WriteError(writer, request, http.StatusNotFound, "IDENTITY_NOT_FOUND", "Identity was not found.")
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

func (handler *ExternalAuthHandler) callbackURL(id string) string {
	return strings.TrimRight(handler.baseURL.String(), "/") + "/api/v1/auth/providers/" + url.PathEscape(id) + "/callback"
}

func (handler *ExternalAuthHandler) requireOrigin(writer http.ResponseWriter, request *http.Request) bool {
	expected := handler.baseURL.Scheme + "://" + handler.baseURL.Host
	if request.Header.Get("Origin") != expected {
		httpx.WriteError(writer, request, http.StatusForbidden, "CSRF_FAILED", "Request origin could not be verified.")
		return false
	}
	return true
}

func (handler *ExternalAuthHandler) redirectFailure(writer http.ResponseWriter, request *http.Request, purpose string, reason ...string) {
	handler.redirectFailureWithReturnTo(writer, request, purpose, "", reason...)
}

func (handler *ExternalAuthHandler) redirectFlowFailure(writer http.ResponseWriter, request *http.Request, flow oauthFlow, reason string) {
	handler.redirectFailureWithReturnTo(writer, request, flow.Purpose, flow.ReturnTo, reason)
}

func (handler *ExternalAuthHandler) redirectFailureWithReturnTo(writer http.ResponseWriter, request *http.Request, purpose, returnTo string, reason ...string) {
	code := "external"
	if len(reason) > 0 && (reason[0] == "cancelled" || reason[0] == "expired") {
		code = reason[0]
	}
	target := "/login?error=" + code
	switch purpose {
	case "link":
		target = "/settings/account?link=failed"
		if code != "external" {
			target = "/settings/account?link=" + code
		}
	case "test":
		target = "/settings/instance/authentication?test=failed"
		if code != "external" {
			target = "/settings/instance/authentication?test=" + code
		}
	}
	if purpose == "login" && returnTo != "" && returnTo != "/" {
		target += "&returnTo=" + url.QueryEscape(safeServerReturnTo(returnTo))
	}
	http.Redirect(writer, request, target, http.StatusSeeOther)
}

func (handler *ExternalAuthHandler) internalError(writer http.ResponseWriter, request *http.Request, err error) {
	handler.logger.Error().Err(err).Str("request_id", httpx.RequestIDFromContext(request.Context())).Msg("external authentication failed")
	httpx.WriteError(writer, request, http.StatusInternalServerError, "INTERNAL_ERROR", "An internal error occurred.")
}

func randomFlowToken() (string, error) {
	data := make([]byte, 32)
	if _, err := rand.Read(data); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(data), nil
}

func (handler *ExternalAuthHandler) oauthStartAllowed(request *http.Request) (bool, error) {
	digest := sha256.Sum256([]byte(remoteIPAddress(request)))
	key := "openrum:oauth:start:" + hex.EncodeToString(digest[:])
	count, err := handler.redis.Eval(request.Context(), `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], 60) end
return count`, []string{key}).Int64()
	return count <= oauthStartLimit, err
}

func flowCookieName(state string) string { return "openrum_oauth_" + state[:12] }

func safeServerReturnTo(raw string) string {
	if !strings.HasPrefix(raw, "/") || strings.HasPrefix(raw, "//") {
		return "/"
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.IsAbs() || parsed.Host != "" || strings.HasPrefix(parsed.Path, "//") || strings.Contains(raw, "\\") || strings.ContainsAny(raw, "\r\n") || parsed.Path == "/login" || parsed.Path == "/setup" || parsed.Path == "/awaiting-access" {
		return "/"
	}
	result := parsed.RequestURI()
	if parsed.Fragment != "" {
		result += "#" + parsed.EscapedFragment()
	}
	return result
}
