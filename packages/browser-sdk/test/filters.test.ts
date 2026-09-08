import assert from "node:assert/strict";
import { test } from "node:test";

import type { EventContext, EventV1 } from "@openrum/protocol";

import { compileFilters, matchesGlob, parseFilterSettings } from "../src/filters.ts";

function context(overrides: Partial<EventContext> = {}): EventContext {
  return {
    environment: "production",
    session_id: "00000000-0000-4000-8000-000000000001",
    page_id: "00000000-0000-4000-8000-000000000002",
    anonymous_user_id: "anon",
    page: { url: "https://shop.example.com/cart" },
    ...overrides,
  } as EventContext;
}

function errorEvent(overrides: Record<string, unknown> = {}): EventV1 {
  return {
    type: "error",
    event_id: "00000000-0000-4000-8000-000000000003",
    timestamp: "2026-09-07T00:00:00.000Z",
    error: {
      name: "TypeError",
      message: "undefined is not a function",
      handled: false,
      mechanism: "window.onerror",
      ...(overrides.error as Record<string, unknown>),
    },
  } as unknown as EventV1;
}

// The server compiles the same patterns with RE2, so both engines have to agree
// character for character or the client would drop what the server would keep.
void test("glob semantics match the server", () => {
  assert.equal(matchesGlob("exact", "exact"), true);
  assert.equal(matchesGlob("exact", "exactly"), false);
  assert.equal(matchesGlob("ResizeObserver loop*", "ResizeObserver loop limit exceeded"), true);
  assert.equal(matchesGlob("*", ""), true);
  assert.equal(matchesGlob("a*b*c", "a-b-c"), true);
  assert.equal(matchesGlob("a*b*c", "a-c-b"), false);
  assert.equal(matchesGlob("a*a", "a"), false);
  assert.equal(matchesGlob("a*a", "aa"), true);
  assert.equal(matchesGlob("CANARY-*", "canary-17"), true);
  assert.equal(matchesGlob("*/vendor/analytics.js", "at f (https://x/vendor/analytics.js"), true);
  assert.equal(
    matchesGlob("*/vendor/analytics.js", "at f (https://x/vendor/analytics.js:1:2)"),
    false,
  );
});

void test("no configured filters compiles to nothing", () => {
  assert.equal(compileFilters(undefined), undefined);
  assert.equal(compileFilters({}), undefined);
  // Anything still measuring must not be acted on here, or the server-side
  // counter it exists for would never see the event.
  assert.equal(compileFilters({ builtin: { extension: "dry_run" } }), undefined);
  assert.equal(
    compileFilters({ rules: [{ id: "r1", kind: "release", pattern: "*", mode: "dry_run" }] }),
    undefined,
  );
});

void test("extension errors are dropped only when enforced", () => {
  const filters = compileFilters({ builtin: { extension: "enforced" } });
  assert.ok(filters);
  const extension = errorEvent({
    error: { stack: "at handler (chrome-extension://abcdef/content.js:1:1)" },
  });
  assert.equal(filters.shouldDrop(extension, context()), true);
  assert.equal(
    filters.shouldDrop(errorEvent({ error: { stack: "at boot (app.js:1:1)" } }), context()),
    false,
  );
});

void test("localhost pages are recognised the way the server recognises them", () => {
  const filters = compileFilters({ builtin: { localhost: "enforced" } });
  assert.ok(filters);
  const pageView = { type: "page_view" } as unknown as EventV1;
  for (const url of [
    "http://localhost:5173/",
    "http://127.0.0.1:5173/",
    "http://[::1]:5173/",
    "http://macbook.local/",
  ]) {
    assert.equal(filters.shouldDrop(pageView, context({ page: { url } })), true, url);
  }
  // An intranet address is real traffic for a self-hosted deployment.
  for (const url of [
    "https://10.4.1.9/orders",
    "https://shop.example.com/",
    "https://localhost.example.com/",
  ]) {
    assert.equal(filters.shouldDrop(pageView, context({ page: { url } })), false, url);
  }
});

void test("rules match the fields the server matches", () => {
  const filters = compileFilters({
    rules: [
      { id: "r1", kind: "error_message", pattern: "TypeError: undefined*", mode: "enforced" },
      { id: "r2", kind: "error_url", pattern: "*vendor/analytics.js*", mode: "enforced" },
      { id: "r3", kind: "release", pattern: "canary-*", mode: "enforced" },
    ],
  });
  assert.ok(filters);
  assert.equal(filters.shouldDrop(errorEvent(), context()), true);
  assert.equal(
    filters.shouldDrop(
      errorEvent({
        error: {
          name: "RangeError",
          message: "out of range",
          stack: "at f (vendor/analytics.js:1:1)",
        },
      }),
      context(),
    ),
    true,
  );
  assert.equal(
    filters.shouldDrop(
      { type: "page_view" } as unknown as EventV1,
      context({ release: "canary-17" }),
    ),
    true,
  );
  assert.equal(
    filters.shouldDrop(
      { type: "page_view" } as unknown as EventV1,
      context({ release: "stable-4" }),
    ),
    false,
  );
});

void test("an unknown rule kind is left to the server", () => {
  const filters = compileFilters({
    rules: [{ id: "r1", kind: "from_the_future" as never, pattern: "*", mode: "enforced" }],
  });
  assert.ok(filters);
  assert.equal(filters.shouldDrop(errorEvent(), context()), false);
});

void test("malformed settings are rejected whole", () => {
  assert.deepEqual(parseFilterSettings(undefined), {});
  assert.deepEqual(parseFilterSettings(null), {});
  assert.equal(parseFilterSettings("nope"), undefined);
  assert.equal(parseFilterSettings({ builtin: { bot: "sometimes" } }), undefined);
  assert.equal(parseFilterSettings({ rules: "no" }), undefined);
  assert.equal(
    parseFilterSettings({ rules: [{ id: "", pattern: "x", mode: "enforced", kind: "release" }] }),
    undefined,
  );
  assert.equal(
    parseFilterSettings({ rules: [{ id: "r", pattern: "", mode: "enforced", kind: "release" }] }),
    undefined,
  );
  assert.equal(
    parseFilterSettings({
      rules: [{ id: "r", pattern: "x".repeat(201), mode: "enforced", kind: "release" }],
    }),
    undefined,
  );
  assert.equal(
    parseFilterSettings({
      rules: Array.from({ length: 51 }, (_, index) => ({
        id: `r${index}`,
        pattern: "x",
        mode: "enforced",
        kind: "release",
      })),
    }),
    undefined,
  );
  assert.deepEqual(parseFilterSettings({ builtin: { extension: "enforced" }, rules: [] }), {
    builtin: { extension: "enforced" },
    rules: [],
  });
});
