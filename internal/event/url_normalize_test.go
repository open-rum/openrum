package event

import "testing"

func TestNormalizeURLRemovesSensitivePartsAndDynamicSegments(t *testing.T) {
	safe, normalized, ok := NormalizeURL("HTTPS://Shop.Example.com:443/orders/018f4d9c-83a1-76c9-81c2-3020ab667004?token=secret#card")
	if !ok {
		t.Fatal("URL rejected")
	}
	if safe != "https://shop.example.com/orders/018f4d9c-83a1-76c9-81c2-3020ab667004" {
		t.Fatalf("safe=%q", safe)
	}
	if normalized != "https://shop.example.com/orders/:id" {
		t.Fatalf("normalized=%q", normalized)
	}
}

func TestNormalizeRouteUsesStableIdentifierPlaceholders(t *testing.T) {
	if got := NormalizeRoute("/users/1042/orders/abcdef0123456789"); got != "/users/:id/orders/:id" {
		t.Fatalf("route=%q", got)
	}
	if got := NormalizeRoute("https://example.com/users/1"); got != "" {
		t.Fatalf("absolute route=%q", got)
	}
}
