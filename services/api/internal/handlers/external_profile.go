package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"unicode/utf8"

	"openrum/internal/auth"
	"openrum/internal/httpx"
)

const (
	profileCookieName = "openrum_oauth_profile"
	profileCookiePath = "/api/v1/auth/register/"
)

// profileFlow is a first sign-in through a provider that gave no usable address. Nothing is
// created until the person types one, so the identity waits here, out of the URL, behind a
// cookie only this browser holds.
type profileFlow struct {
	ProviderID  string `json:"providerId"`
	Version     int64  `json:"version"`
	Subject     string `json:"subject"`
	DisplayName string `json:"displayName"`
	ReturnTo    string `json:"returnTo"`
}

func (handler *ExternalAuthHandler) askForEmail(writer http.ResponseWriter, request *http.Request, flow oauthFlow, provider auth.Provider, identity auth.ProviderIdentity) {
	token, err := randomFlowToken()
	if err != nil {
		handler.redirectFlowFailure(writer, request, flow, "external")
		return
	}
	data, err := json.Marshal(profileFlow{
		ProviderID: provider.ID, Version: provider.Version, Subject: identity.Subject,
		DisplayName: identity.Name, ReturnTo: flow.ReturnTo,
	})
	if err != nil {
		handler.redirectFlowFailure(writer, request, flow, "external")
		return
	}
	if err := handler.redis.Set(request.Context(), "openrum:oauth:profile:"+token, data, oauthFlowTTL).Err(); err != nil {
		handler.redirectFlowFailure(writer, request, flow, "external")
		return
	}
	http.SetCookie(writer, &http.Cookie{
		Name: profileCookieName, Value: token, Path: profileCookiePath, MaxAge: int(oauthFlowTTL.Seconds()),
		HttpOnly: true, Secure: handler.secureCookie, SameSite: http.SameSiteLaxMode,
	})
	http.Redirect(writer, request, "/register/complete", http.StatusSeeOther)
}

func (handler *ExternalAuthHandler) loadProfileFlow(writer http.ResponseWriter, request *http.Request) (string, profileFlow, bool) {
	cookie, err := request.Cookie(profileCookieName)
	if err != nil || len(cookie.Value) < 32 || len(cookie.Value) > 128 {
		httpx.WriteError(writer, request, http.StatusGone, "REGISTRATION_EXPIRED", "This sign-up has expired. Start again.")
		return "", profileFlow{}, false
	}
	data, err := handler.redis.Get(request.Context(), "openrum:oauth:profile:"+cookie.Value).Bytes()
	var flow profileFlow
	if err != nil || json.Unmarshal(data, &flow) != nil {
		httpx.WriteError(writer, request, http.StatusGone, "REGISTRATION_EXPIRED", "This sign-up has expired. Start again.")
		return "", profileFlow{}, false
	}
	return cookie.Value, flow, true
}

// Profile says who is finishing a sign-up, so the page can greet them and prefill the name.
func (handler *ExternalAuthHandler) Profile(writer http.ResponseWriter, request *http.Request) {
	_, flow, ok := handler.loadProfileFlow(writer, request)
	if !ok {
		return
	}
	provider, err := handler.store.GetProvider(request.Context(), flow.ProviderID)
	if err != nil || provider.Version != flow.Version {
		httpx.WriteError(writer, request, http.StatusGone, "REGISTRATION_EXPIRED", "This sign-up has expired. Start again.")
		return
	}
	writeJSON(writer, http.StatusOK, map[string]string{"providerLabel": provider.Label, "displayName": flow.DisplayName})
}

type completeProfileRequest struct {
	Email       string `json:"email"`
	DisplayName string `json:"displayName"`
}

// CompleteProfile creates the account with the address the person typed. The address is not
// verified, only required to be unused.
func (handler *ExternalAuthHandler) CompleteProfile(writer http.ResponseWriter, request *http.Request) {
	if !handler.requireOrigin(writer, request) {
		return
	}
	token, flow, ok := handler.loadProfileFlow(writer, request)
	if !ok {
		return
	}
	var payload completeProfileRequest
	if !decodeJSONBody(writer, request, &payload) {
		return
	}
	payload.Email = strings.ToLower(strings.TrimSpace(payload.Email))
	payload.DisplayName = strings.TrimSpace(payload.DisplayName)
	if !validEmail(payload.Email) {
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "Email is invalid.")
		return
	}
	if count := utf8.RuneCountInString(payload.DisplayName); count < 1 || count > 120 {
		httpx.WriteError(writer, request, http.StatusBadRequest, "VALIDATION_ERROR", "Name must be between 1 and 120 characters.")
		return
	}
	allowed, err := handler.oauthStartAllowed(request)
	if err != nil {
		handler.internalError(writer, request, err)
		return
	}
	if !allowed {
		httpx.WriteError(writer, request, http.StatusTooManyRequests, "RATE_LIMITED", "Too many attempts. Try again later.")
		return
	}
	provider, err := handler.store.GetProvider(request.Context(), flow.ProviderID)
	if err != nil || provider.Version != flow.Version {
		httpx.WriteError(writer, request, http.StatusGone, "REGISTRATION_EXPIRED", "This sign-up has expired. Start again.")
		return
	}
	user, err := handler.store.ResolveIdentity(request.Context(), provider, flow.Subject, payload.Email, payload.DisplayName, handler.approveNewAccounts(request.Context()))
	if err != nil {
		if errors.Is(err, auth.ErrIdentityConflict) {
			// The flow stays, so the person can try another address.
			httpx.WriteError(writer, request, http.StatusConflict, "EMAIL_TAKEN", "This email is already in use. Use another one.")
			return
		}
		handler.internalError(writer, request, err)
		return
	}
	_ = handler.redis.Del(request.Context(), "openrum:oauth:profile:"+token).Err()
	http.SetCookie(writer, &http.Cookie{Name: profileCookieName, Path: profileCookiePath, MaxAge: -1, HttpOnly: true, Secure: handler.secureCookie, SameSite: http.SameSiteLaxMode})
	target, ok := handler.issueSession(writer, request, user, flow.ReturnTo)
	if !ok {
		return
	}
	writeJSON(writer, http.StatusOK, map[string]string{"returnTo": target, "accessStatus": user.AccessStatus})
}
