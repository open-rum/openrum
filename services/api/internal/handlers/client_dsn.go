package handlers

import "net/url"

func clientDSN(endpoint, writeKey string) string {
	parsed, err := url.Parse(endpoint)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" ||
		parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || writeKey == "" {
		return ""
	}
	parsed.User = url.User(writeKey)
	return parsed.String()
}
