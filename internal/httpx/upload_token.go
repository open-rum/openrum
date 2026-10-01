package httpx

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strings"

	"openrum/internal/metadata"
)

type uploadTokenContextKey struct{}

type UploadTokenAuthenticator interface {
	Authenticate(context.Context, string) (metadata.UploadTokenAccess, error)
}

// RequireSessionOrUploadToken admits either a Console session (with CSRF
// protection for unsafe methods) or an `Authorization: Bearer orut_…` upload
// token. Token requests skip CSRF because they carry no ambient browser
// credential. Handlers remain responsible for scoping the token to its project
// and for refusing actions tokens may not perform.
func RequireSessionOrUploadToken(sessions SessionAuthenticator, tokens UploadTokenAuthenticator, publicBaseURL *url.URL) func(http.Handler) http.Handler {
	requireSession := RequireSession(sessions)
	requireCSRF := RequireCSRF(publicBaseURL)
	return func(next http.Handler) http.Handler {
		sessionChain := requireSession(requireCSRF(next))
		return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			scheme, secret, found := strings.Cut(strings.TrimSpace(request.Header.Get("Authorization")), " ")
			if !found || !strings.EqualFold(scheme, "Bearer") {
				sessionChain.ServeHTTP(writer, request)
				return
			}
			access, err := tokens.Authenticate(request.Context(), strings.TrimSpace(secret))
			if err != nil {
				if errors.Is(err, metadata.ErrInvalidUploadToken) {
					WriteError(writer, request, http.StatusUnauthorized, "INVALID_UPLOAD_TOKEN", "The upload token is invalid or has been revoked.")
					return
				}
				WriteError(writer, request, http.StatusInternalServerError, "INTERNAL_ERROR", "An internal error occurred.")
				return
			}
			ctx := context.WithValue(request.Context(), uploadTokenContextKey{}, access)
			next.ServeHTTP(writer, request.WithContext(ctx))
		})
	}
}

func UploadTokenFromContext(ctx context.Context) (metadata.UploadTokenAccess, bool) {
	access, ok := ctx.Value(uploadTokenContextKey{}).(metadata.UploadTokenAccess)
	return access, ok
}
