package sourcemap

import "testing"

func TestCacheParsesOnceAndEvictsByWeight(t *testing.T) {
	first := []byte(`{"version":3,"sources":["a.ts"],"mappings":"AAAA"}`)
	second := []byte(`{"version":3,"sources":["b.ts"],"mappings":"AAAA"}`)
	cache := NewCache(int64(len(first) + 1))
	if _, err := cache.GetOrParse("a", "", first); err != nil {
		t.Fatal(err)
	}
	if _, err := cache.GetOrParse("a", "", first); err != nil || cache.parseCalls != 1 {
		t.Fatalf("parse calls=%d err=%v", cache.parseCalls, err)
	}
	if _, err := cache.GetOrParse("b", "", second); err != nil {
		t.Fatal(err)
	}
	if _, ok := cache.entries["a"]; ok {
		t.Fatal("expected oldest map to be evicted")
	}
}
