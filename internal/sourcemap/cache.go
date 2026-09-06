package sourcemap

import (
	"container/list"
	"sync"
)

type cacheEntry struct {
	key    string
	value  *ParsedMap
	weight int64
}

type Cache struct {
	mutex      sync.Mutex
	maximum    int64
	used       int64
	entries    map[string]*list.Element
	order      *list.List
	parseCalls int
}

func NewCache(maximumBytes int64) *Cache {
	if maximumBytes <= 0 {
		maximumBytes = MaxMapBytes
	}
	return &Cache{maximum: maximumBytes, entries: make(map[string]*list.Element), order: list.New()}
}

func (cache *Cache) GetOrParse(key, mapURL string, contents []byte) (*ParsedMap, error) {
	cache.mutex.Lock()
	defer cache.mutex.Unlock()
	if element := cache.entries[key]; element != nil {
		cache.order.MoveToFront(element)
		return element.Value.(*cacheEntry).value, nil
	}
	parsed, err := Parse(mapURL, contents)
	cache.parseCalls++
	if err != nil {
		return nil, err
	}
	weight := int64(len(contents))
	if weight > cache.maximum {
		return nil, &ResolveError{Code: FailureResourceLimit}
	}
	for cache.used+weight > cache.maximum && cache.order.Len() > 0 {
		oldest := cache.order.Back()
		entry := oldest.Value.(*cacheEntry)
		delete(cache.entries, entry.key)
		cache.used -= entry.weight
		cache.order.Remove(oldest)
	}
	entry := &cacheEntry{key: key, value: parsed, weight: weight}
	cache.entries[key] = cache.order.PushFront(entry)
	cache.used += weight
	return parsed, nil
}
