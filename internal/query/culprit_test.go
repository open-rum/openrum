package query

import "testing"

func TestCulpritFromStack(t *testing.T) {
	for _, tc := range []struct {
		name, stack string
		function    string
		file        string
	}{
		{"chrome with function", "TypeError: x\n    at renderVariant (https://cdn.example.com/assets/product-detail.js:184:22)\n    at ProductDetail (https://cdn.example.com/assets/product-detail.js:96:5)", "renderVariant", "assets/product-detail.js"},
		{"chrome anonymous", "Error: x\n    at https://cdn.example.com/assets/app.js:3:9", "", "assets/app.js"},
		{"skips dependency frames", "Error: x\n    at run (https://cdn.example.com/node_modules/lib/index.js:3:4)\n    at submit (https://cdn.example.com/assets/app.js:1:42)", "submit", "assets/app.js"},
		{"only dependency frames", "Error: x\n    at run (https://cdn.example.com/node_modules/lib/index.js:3:4)", "run", "node_modules/lib/index.js"},
		{"firefox", "submit@https://example.com/app.js?v=2:4:8\n@https://example.com/other.js:9:1", "submit", "app.js"},
		{"relative path", "TypeError: y\n    at applyCoupon (checkout/coupon.js:44:12)", "applyCoupon", "checkout/coupon.js"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := culpritFromStack(tc.stack)
			if got == nil || got.Function != tc.function || got.File != tc.file {
				t.Fatalf("culprit = %+v, want %s in %s", got, tc.function, tc.file)
			}
		})
	}
	if culpritFromStack("Error: boom") != nil || culpritFromStack("") != nil {
		t.Fatal("a stack without frames has no culprit")
	}
}
