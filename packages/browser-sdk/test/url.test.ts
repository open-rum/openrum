import assert from "node:assert/strict";
import { test } from "node:test";
import { isIngestURL, sanitizeURL } from "../src/privacy/url.ts";

void test("sanitizes credentials, query, and fragments and rejects non-HTTP schemes", () => {
  assert.equal(
    sanitizeURL("https://user:password@example.test/path?token=private#fragment"),
    "https://example.test/path",
  );
  assert.equal(
    sanitizeURL("/orders?email=private", "https://api.example.test/cart"),
    "https://api.example.test/orders",
  );
  assert.equal(sanitizeURL("data:text/plain,private"), undefined);
  assert.equal(sanitizeURL("not an absolute URL"), undefined);
});

void test("self-exclusion requires the exact normalized ingest URL", () => {
  assert.equal(
    isIngestURL(
      "/ingest/v1/envelope?retry=1",
      "https://rum.example.test/ingest/v1/envelope",
      "https://rum.example.test/app",
    ),
    true,
  );
  assert.equal(
    isIngestURL("/ingest/v1/envelope/other", "/ingest/v1/envelope", "https://rum.example.test/app"),
    false,
  );
});
