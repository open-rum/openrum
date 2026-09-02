package httpx

import (
	"encoding/json"
	"net/http"
	"unicode/utf8"
)

const maxPublicErrorMessageBytes = 256

type ErrorEnvelope struct {
	Error ErrorBody `json:"error"`
}

type ErrorBody struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	RequestID string `json:"requestId"`
}

func WriteError(response http.ResponseWriter, request *http.Request, status int, code, message string) {
	response.Header().Set("Content-Type", "application/json; charset=utf-8")
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(ErrorEnvelope{
		Error: ErrorBody{
			Code:      code,
			Message:   truncateUTF8(message, maxPublicErrorMessageBytes),
			RequestID: RequestIDFromContext(request.Context()),
		},
	})
}

func truncateUTF8(value string, limit int) string {
	if len(value) <= limit {
		return value
	}
	value = value[:limit]
	for !utf8.ValidString(value) {
		value = value[:len(value)-1]
	}
	return value
}
