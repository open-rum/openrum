package notify

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

var ErrUnsafeWebhookURL = errors.New("unsafe webhook URL")

type IPResolver interface {
	LookupIP(context.Context, string, string) ([]net.IP, error)
}

func NewSafeWebhookClient(resolver IPResolver) *http.Client {
	if resolver == nil {
		resolver = net.DefaultResolver
	}
	dialer := &net.Dialer{Timeout: 5 * time.Second, KeepAlive: 30 * time.Second}
	transport := &http.Transport{
		Proxy: nil,
		DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(address)
			if err != nil {
				return nil, ErrUnsafeWebhookURL
			}
			addresses, err := resolver.LookupIP(ctx, "ip", host)
			if err != nil || len(addresses) == 0 {
				return nil, fmt.Errorf("resolve webhook host: %w", err)
			}
			for _, address := range addresses {
				if !safePublicIP(address) {
					return nil, ErrUnsafeWebhookURL
				}
			}
			return dialer.DialContext(ctx, network, net.JoinHostPort(addresses[0].String(), port))
		},
		TLSHandshakeTimeout:   5 * time.Second,
		ResponseHeaderTimeout: 10 * time.Second,
		IdleConnTimeout:       30 * time.Second,
	}
	client := &http.Client{Transport: transport, Timeout: 15 * time.Second}
	client.CheckRedirect = func(request *http.Request, via []*http.Request) error {
		if len(via) >= 5 {
			return errors.New("too many webhook redirects")
		}
		return ValidateWebhookURL(request.Context(), request.URL, resolver)
	}
	return client
}

func ValidateWebhookURL(ctx context.Context, target *url.URL, resolver IPResolver) error {
	if target == nil || target.Scheme != "https" || target.Hostname() == "" || target.User != nil || target.Fragment != "" {
		return ErrUnsafeWebhookURL
	}
	host := strings.TrimSuffix(strings.ToLower(target.Hostname()), ".")
	if host == "localhost" || strings.HasSuffix(host, ".localhost") {
		return ErrUnsafeWebhookURL
	}
	addresses, err := resolver.LookupIP(ctx, "ip", host)
	if err != nil || len(addresses) == 0 {
		return fmt.Errorf("resolve webhook host: %w", err)
	}
	for _, address := range addresses {
		if !safePublicIP(address) {
			return ErrUnsafeWebhookURL
		}
	}
	return nil
}

func safePublicIP(address net.IP) bool {
	if address == nil || address.IsPrivate() || address.IsLoopback() || address.IsLinkLocalUnicast() ||
		address.IsLinkLocalMulticast() || address.IsUnspecified() || address.IsMulticast() {
		return false
	}
	if ipv4 := address.To4(); ipv4 != nil && ipv4[0] == 100 && ipv4[1]&0xc0 == 64 {
		return false
	}
	return address.IsGlobalUnicast()
}
