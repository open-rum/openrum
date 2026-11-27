package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"openrum/internal/auth"
	"openrum/internal/httpx"
	"openrum/internal/mailer"
	"openrum/internal/metadata"
)

type fakePasswordResetStore struct {
	requestOutcome metadata.PasswordResetOutcome
	requestErr     error
	confirmUserID  uuid.UUID
	confirmErr     error

	lastEmail     string
	lastTokenHash []byte
	lastToken     string
	lastHash      string
}

func (store *fakePasswordResetStore) Request(_ context.Context, email string, tokenHash []byte) (metadata.PasswordResetOutcome, error) {
	store.lastEmail = email
	store.lastTokenHash = append([]byte(nil), tokenHash...)
	return store.requestOutcome, store.requestErr
}

func (store *fakePasswordResetStore) Confirm(_ context.Context, token, newPasswordHash string) (uuid.UUID, error) {
	store.lastToken = token
	store.lastHash = newPasswordHash
	return store.confirmUserID, store.confirmErr
}

type fakePasswordResetMail struct {
	configured bool
	configErr  error
	sendErr    error
	sent       []mailer.Message
}

func (mail *fakePasswordResetMail) Configured(context.Context) (bool, error) {
	return mail.configured, mail.configErr
}

func (mail *fakePasswordResetMail) Send(_ context.Context, message mailer.Message) error {
	if mail.sendErr != nil {
		return mail.sendErr
	}
	mail.sent = append(mail.sent, message)
	return nil
}

func newTestPasswordResetRouter(store passwordResetStore, mail passwordResetMailer) *httpx.Router {
	baseURL, _ := url.Parse("https://rum.example.com")
	handler := NewPasswordResetHandler(store, mail, nil, baseURL, zerolog.Nop())
	router := httpx.NewRouter(zerolog.Nop())
	router.HandleFunc("GET /api/v1/auth/password-reset/status", handler.Status)
	router.HandleFunc("POST /api/v1/auth/password-reset/request", handler.Request)
	router.HandleFunc("POST /api/v1/auth/password-reset/confirm", handler.Confirm)
	return router
}

func TestPasswordResetStatusReflectsMailConfiguration(t *testing.T) {
	for _, configured := range []bool{false, true} {
		router := newTestPasswordResetRouter(&fakePasswordResetStore{}, &fakePasswordResetMail{configured: configured})
		recorder := httptest.NewRecorder()
		request := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/auth/password-reset/status", nil)
		router.ServeHTTP(recorder, request)

		if recorder.Code != http.StatusOK {
			t.Fatalf("status=%d, want 200", recorder.Code)
		}
		var body struct {
			Enabled bool `json:"enabled"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
			t.Fatalf("decode body: %v", err)
		}
		if body.Enabled != configured {
			t.Fatalf("enabled=%v, want %v", body.Enabled, configured)
		}
	}
}

func TestPasswordResetRequestValidationAndMailAvailability(t *testing.T) {
	t.Run("invalid email returns 400", func(t *testing.T) {
		router := newTestPasswordResetRouter(&fakePasswordResetStore{}, &fakePasswordResetMail{configured: true})
		recorder := httptest.NewRecorder()
		request := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/v1/auth/password-reset/request", strings.NewReader(`{"email":"not-an-email"}`))
		request.Header.Set("Content-Type", "application/json")
		router.ServeHTTP(recorder, request)

		if recorder.Code != http.StatusBadRequest {
			t.Fatalf("status=%d, want 400", recorder.Code)
		}
	})

	t.Run("unconfigured SMTP returns 503 EMAIL_UNAVAILABLE", func(t *testing.T) {
		router := newTestPasswordResetRouter(&fakePasswordResetStore{}, &fakePasswordResetMail{configured: false})
		recorder := httptest.NewRecorder()
		request := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/v1/auth/password-reset/request", strings.NewReader(`{"email":"owner@example.com"}`))
		request.Header.Set("Content-Type", "application/json")
		router.ServeHTTP(recorder, request)

		if recorder.Code != http.StatusServiceUnavailable {
			t.Fatalf("status=%d, want 503", recorder.Code)
		}
		if !strings.Contains(recorder.Body.String(), "EMAIL_UNAVAILABLE") {
			t.Fatalf("body=%s, want EMAIL_UNAVAILABLE", recorder.Body.String())
		}
	})

	t.Run("known account mails reset link and returns 202", func(t *testing.T) {
		store := &fakePasswordResetStore{requestOutcome: metadata.PasswordResetSend}
		mail := &fakePasswordResetMail{configured: true}
		router := newTestPasswordResetRouter(store, mail)

		recorder := httptest.NewRecorder()
		request := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/v1/auth/password-reset/request", strings.NewReader(`{"email":"Owner@Example.com"}`))
		request.Header.Set("Content-Type", "application/json")
		router.ServeHTTP(recorder, request)

		if recorder.Code != http.StatusAccepted {
			t.Fatalf("status=%d, want 202", recorder.Code)
		}
		if store.lastEmail != "owner@example.com" {
			t.Fatalf("email=%q, want normalized owner@example.com", store.lastEmail)
		}
		if len(store.lastTokenHash) != 32 {
			t.Fatalf("token hash len=%d, want 32", len(store.lastTokenHash))
		}
		if len(mail.sent) != 1 {
			t.Fatalf("sent=%d messages, want 1", len(mail.sent))
		}
		if !strings.Contains(mail.sent[0].Body, "https://rum.example.com/reset-password/orpr_") {
			t.Fatalf("reset email body missing expected link: %s", mail.sent[0].Body)
		}
	})

	t.Run("unknown account still returns 202 without sending mail", func(t *testing.T) {
		store := &fakePasswordResetStore{requestOutcome: metadata.PasswordResetNoMail}
		mail := &fakePasswordResetMail{configured: true}
		router := newTestPasswordResetRouter(store, mail)

		recorder := httptest.NewRecorder()
		request := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/v1/auth/password-reset/request", strings.NewReader(`{"email":"nobody@example.com"}`))
		request.Header.Set("Content-Type", "application/json")
		router.ServeHTTP(recorder, request)

		if recorder.Code != http.StatusAccepted {
			t.Fatalf("status=%d, want 202", recorder.Code)
		}
		if len(mail.sent) != 0 {
			t.Fatalf("sent=%d messages, want 0", len(mail.sent))
		}
	})

	t.Run("mail delivery error returns 502", func(t *testing.T) {
		store := &fakePasswordResetStore{requestOutcome: metadata.PasswordResetSend}
		mail := &fakePasswordResetMail{configured: true, sendErr: errors.New("smtp refused")}
		router := newTestPasswordResetRouter(store, mail)

		recorder := httptest.NewRecorder()
		request := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/v1/auth/password-reset/request", strings.NewReader(`{"email":"owner@example.com"}`))
		request.Header.Set("Content-Type", "application/json")
		router.ServeHTTP(recorder, request)

		if recorder.Code != http.StatusBadGateway {
			t.Fatalf("status=%d, want 502", recorder.Code)
		}
	})
}

func TestPasswordResetConfirm(t *testing.T) {
	t.Run("weak password returns 400", func(t *testing.T) {
		router := newTestPasswordResetRouter(&fakePasswordResetStore{}, &fakePasswordResetMail{configured: true})
		recorder := httptest.NewRecorder()
		request := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/v1/auth/password-reset/confirm", strings.NewReader(`{"token":"orpr_abc","password":"short"}`))
		request.Header.Set("Content-Type", "application/json")
		router.ServeHTTP(recorder, request)

		if recorder.Code != http.StatusBadRequest {
			t.Fatalf("status=%d, want 400", recorder.Code)
		}
	})

	t.Run("invalid or expired token returns 410", func(t *testing.T) {
		store := &fakePasswordResetStore{confirmErr: metadata.ErrPasswordResetInvalid}
		router := newTestPasswordResetRouter(store, &fakePasswordResetMail{configured: true})
		recorder := httptest.NewRecorder()
		request := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/v1/auth/password-reset/confirm", strings.NewReader(`{"token":"orpr_expired","password":"NewPassword123!"}`))
		request.Header.Set("Content-Type", "application/json")
		router.ServeHTTP(recorder, request)

		if recorder.Code != http.StatusGone {
			t.Fatalf("status=%d, want 410", recorder.Code)
		}
		if !strings.Contains(recorder.Body.String(), "PASSWORD_RESET_INVALID") {
			t.Fatalf("body=%s, want PASSWORD_RESET_INVALID", recorder.Body.String())
		}
	})

	t.Run("valid token hashes new password and returns 204", func(t *testing.T) {
		store := &fakePasswordResetStore{confirmUserID: uuid.New()}
		router := newTestPasswordResetRouter(store, &fakePasswordResetMail{configured: true})
		recorder := httptest.NewRecorder()
		request := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/v1/auth/password-reset/confirm", strings.NewReader(`{"token":"orpr_valid","password":"NewPassword123!"}`))
		request.Header.Set("Content-Type", "application/json")
		router.ServeHTTP(recorder, request)

		if recorder.Code != http.StatusNoContent {
			t.Fatalf("status=%d, want 204", recorder.Code)
		}
		if store.lastToken != "orpr_valid" {
			t.Fatalf("token=%q, want orpr_valid", store.lastToken)
		}
		ok, err := auth.VerifyPassword("NewPassword123!", store.lastHash)
		if err != nil || !ok {
			t.Fatalf("expected stored hash to verify against NewPassword123!, err=%v", err)
		}
	})
}
