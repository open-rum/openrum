package handlers

import (
	"encoding/json"
	"errors"
	"net/http"

	"openrum/internal/httpx"
	"openrum/internal/search"
)

type searchErrorDetail struct {
	Code     string `json:"code"`
	Position int    `json:"position"`
	Term     string `json:"term,omitempty"`
}

// writeSearchError answers a search the shared grammar refused, and says where, so the
// Console can point at the term instead of only saying the filters are invalid. It returns
// false when err is not a search error.
func writeSearchError(writer http.ResponseWriter, request *http.Request, err error) bool {
	var searchError *search.Error
	if !errors.As(err, &searchError) {
		return false
	}
	writer.Header().Set("Content-Type", "application/json; charset=utf-8")
	writer.WriteHeader(http.StatusBadRequest)
	_ = json.NewEncoder(writer).Encode(struct {
		Error struct {
			httpx.ErrorBody
			Search searchErrorDetail `json:"search"`
		} `json:"error"`
	}{Error: struct {
		httpx.ErrorBody
		Search searchErrorDetail `json:"search"`
	}{
		ErrorBody: httpx.ErrorBody{Code: "INVALID_SEARCH", Message: searchError.Error(), RequestID: httpx.RequestIDFromContext(request.Context())},
		Search:    searchErrorDetail{Code: searchError.Code, Position: searchError.Position, Term: searchError.Term},
	}})
	return true
}
