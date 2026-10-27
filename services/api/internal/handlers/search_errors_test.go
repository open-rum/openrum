package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"

	"openrum/internal/query"
	"openrum/internal/search"
)

func TestWriteSearchErrorSaysWhereTheSearchWentWrong(t *testing.T) {
	now := time.Now().UTC()
	_, err := query.NormalizeLogFilters(query.LogFilters{
		ProjectID: uuid.New(), From: now.Add(-time.Hour), To: now, Query: "level:info OR level:warn",
	})
	if err == nil {
		t.Fatal("OR was accepted")
	}
	recorder := httptest.NewRecorder()
	if !writeSearchError(recorder, httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil), err) {
		t.Fatal("a search error was not recognized")
	}
	var body struct {
		Error struct {
			Code   string            `json:"code"`
			Search searchErrorDetail `json:"search"`
		} `json:"error"`
	}
	if recorder.Code != http.StatusBadRequest || json.Unmarshal(recorder.Body.Bytes(), &body) != nil ||
		body.Error.Code != "INVALID_SEARCH" || body.Error.Search.Code != search.CodeBooleanKeyword || body.Error.Search.Position != 11 {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	if writeSearchError(httptest.NewRecorder(), httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil), errors.New("other")) {
		t.Fatal("an unrelated error was answered as a search error")
	}
}
