package handlers

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"time"
)

const (
	BrowserSDKVersion          = "0.1.1"
	BrowserSDKPublicPath       = "/sdk/browser/0.1.1/openrum.min.js"
	BrowserSDKLegacyPublicPath = "/api/v1/sdk/browser/0.1.1/openrum.min.js"
)

type BrowserSDKHandler struct {
	bundle []byte
	etag   string
}

func NewBrowserSDKHandler(bundle []byte) (*BrowserSDKHandler, error) {
	if len(bundle) == 0 {
		return nil, errors.New("browser SDK bundle is empty")
	}
	digest := sha256.Sum256(bundle)
	return &BrowserSDKHandler{
		bundle: append([]byte(nil), bundle...),
		etag:   `"` + hex.EncodeToString(digest[:]) + `"`,
	}, nil
}

func (handler *BrowserSDKHandler) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	writer.Header().Set("Access-Control-Allow-Origin", "*")
	writer.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	writer.Header().Set("Content-Type", "text/javascript; charset=utf-8")
	writer.Header().Set("Cross-Origin-Resource-Policy", "cross-origin")
	writer.Header().Set("ETag", handler.etag)
	writer.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(
		writer,
		request,
		"openrum-browser-"+BrowserSDKVersion+".min.js",
		time.Time{},
		bytes.NewReader(handler.bundle),
	)
}
