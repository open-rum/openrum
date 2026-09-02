package httpx

import (
	"crypto/sha256"
	"crypto/subtle"
	"net/http"
	"net/url"

	"openrum/internal/auth"
)

const CSRFHeader = "X-CSRF-Token"

func RequireCSRF(publicBaseURL *url.URL) func(http.Handler) http.Handler {
	expectedOrigin := publicBaseURL.Scheme + "://" + publicBaseURL.Host
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			if request.Method == http.MethodGet || request.Method == http.MethodHead || request.Method == http.MethodOptions {
				next.ServeHTTP(writer, request)
				return
			}
			origin, err := url.Parse(request.Header.Get("Origin"))
			if err != nil || origin.Scheme+"://"+origin.Host != expectedOrigin {
				WriteError(writer, request, http.StatusForbidden, "CSRF_FAILED", "Request origin could not be verified.")
				return
			}
			cookie, err := request.Cookie(auth.CSRFCookieName)
			if err != nil || !secureTokenEqual(cookie.Value, request.Header.Get(CSRFHeader)) {
				WriteError(writer, request, http.StatusForbidden, "CSRF_FAILED", "CSRF token could not be verified.")
				return
			}
			next.ServeHTTP(writer, request)
		})
	}
}

func secureTokenEqual(left, right string) bool {
	leftHash := sha256.Sum256([]byte(left))
	rightHash := sha256.Sum256([]byte(right))
	return left != "" && subtle.ConstantTimeCompare(leftHash[:], rightHash[:]) == 1
}
