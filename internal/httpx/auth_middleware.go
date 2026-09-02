package httpx

import (
	"context"
	"errors"
	"net/http"

	"openrum/internal/auth"
)

type principalContextKey struct{}

type SessionAuthenticator interface {
	Authenticate(context.Context, string) (auth.Principal, error)
}

func RequireSession(authenticator SessionAuthenticator) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			cookie, err := request.Cookie(auth.SessionCookieName)
			if err != nil {
				WriteError(writer, request, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication is required.")
				return
			}
			principal, err := authenticator.Authenticate(request.Context(), cookie.Value)
			if err != nil {
				if errors.Is(err, auth.ErrUnauthenticated) {
					WriteError(writer, request, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication is required.")
					return
				}
				WriteError(writer, request, http.StatusInternalServerError, "INTERNAL_ERROR", "An internal error occurred.")
				return
			}
			ctx := context.WithValue(request.Context(), principalContextKey{}, principal)
			next.ServeHTTP(writer, request.WithContext(ctx))
		})
	}
}

func PrincipalFromContext(ctx context.Context) (auth.Principal, bool) {
	principal, ok := ctx.Value(principalContextKey{}).(auth.Principal)
	return principal, ok
}
