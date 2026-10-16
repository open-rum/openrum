import assert from "node:assert/strict";
import { test } from "node:test";

import {
  collectHeaders,
  compileCapture,
  isSensitiveHeader,
  isValidHeaderName,
  maxHeaders,
  maxHeaderValueLength,
  parseCaptureSettings,
} from "../src/capture.ts";

void test("credential and client-address headers are refused however they are spelled", () => {
  for (const name of [
    "authorization",
    "Proxy-Authorization",
    "cookie",
    "set-cookie",
    "x-api-key",
    "X_API_KEY",
    "x-auth-token",
    "x-csrf-token",
    "x-xsrf-token",
    "x-amz-security-token",
    "x-signature",
    "x-forwarded-for",
    "x-real-ip",
    "x-session-id",
    "x-user-email",
    "x-client-ip",
  ]) {
    assert.equal(isSensitiveHeader(name), true, name);
  }
  for (const name of [
    "content-type",
    "cache-control",
    "etag",
    "x-request-id",
    "traceparent",
    "x-ratelimit-remaining",
    "access-control-allow-origin",
    "accept",
    "content-length",
    "retry-after",
    "vary",
    "server-timing",
  ]) {
    assert.equal(isSensitiveHeader(name), false, name);
  }
});

void test("header names are lower-case tokens", () => {
  assert.equal(isValidHeaderName("x-request-id"), true);
  assert.equal(isValidHeaderName("ETag"), false);
  assert.equal(isValidHeaderName(""), false);
  assert.equal(isValidHeaderName("-x"), false);
  assert.equal(isValidHeaderName("x_y"), false);
  assert.equal(isValidHeaderName("a".repeat(65)), false);
});

void test("parses a well-formed document and normalizes the method", () => {
  const settings = parseCaptureSettings({
    rules: [
      { id: "a", method: "post", pattern: "https://api.example.com/*", responseHeaders: ["etag"] },
    ],
  });
  assert.deepEqual(settings, {
    rules: [
      {
        id: "a",
        method: "POST",
        pattern: "https://api.example.com/*",
        requestHeaders: [],
        responseHeaders: ["etag"],
        requestBody: false,
        responseBody: false,
      },
    ],
  });
});

void test("any malformed rule yields no rules at all", () => {
  const good = { id: "g", method: "GET", pattern: "https://a.test/*", responseHeaders: ["etag"] };
  for (const bad of [
    { ...good, id: "" },
    { ...good, method: 3 },
    { ...good, pattern: "" },
    { ...good, pattern: "x".repeat(301) },
    { ...good, responseHeaders: ["ETag"] },
    { ...good, responseHeaders: "etag" },
    { ...good, requestHeaders: ["authorization"] },
    { ...good, requestHeaders: Array.from({ length: maxHeaders + 1 }, (_, i) => `x-h${i}`) },
    null,
  ]) {
    assert.deepEqual(parseCaptureSettings({ rules: [good, bad] }), {}, JSON.stringify(bad));
  }
  assert.deepEqual(parseCaptureSettings({ rules: "nope" }), {});
  assert.deepEqual(parseCaptureSettings(undefined), {});
  assert.deepEqual(parseCaptureSettings("x"), {});
  assert.deepEqual(parseCaptureSettings({ rules: Array(21).fill(good) }), {});
});

void test("no rules compile to nothing", () => {
  assert.equal(compileCapture(undefined), undefined);
  assert.equal(compileCapture({}), undefined);
  assert.equal(compileCapture({ rules: [] }), undefined);
});

void test("selects the union of the rules that match method and URL", () => {
  const compiled = compileCapture({
    rules: [
      {
        id: "orders",
        method: "GET",
        pattern: "https://api.example.com/orders/*",
        responseHeaders: ["etag"],
      },
      {
        id: "family",
        method: "*",
        pattern: "https://api.example.com/*",
        requestHeaders: ["accept"],
        responseHeaders: ["content-type", "etag"],
      },
      {
        id: "billing",
        method: "POST",
        pattern: "https://billing.example.com/*",
        responseHeaders: ["x-trace"],
      },
    ],
  });
  assert.ok(compiled);
  assert.deepEqual(compiled.select("GET", "https://api.example.com/orders/12345"), {
    request: ["accept"],
    response: ["etag", "content-type"],
    requestBody: false,
    responseBody: false,
  });
  assert.deepEqual(compiled.select("POST", "https://api.example.com/orders/1")?.response, [
    "content-type",
    "etag",
  ]);
  assert.equal(compiled.select("GET", "https://billing.example.com/x"), undefined);
  assert.equal(compiled.select("GET", "https://elsewhere.example.org/x"), undefined);
  assert.deepEqual([...compiled.requestNames], ["accept"]);
});

void test("collects only readable string headers, scrubbed and bounded", () => {
  const source: Record<string, string | null> = {
    "content-type": " application/json ",
    "x-contact": "ops@example.com",
    "x-long": "a".repeat(maxHeaderValueLength + 40),
    "x-missing": null,
  };
  const headers = collectHeaders(
    [
      "content-type",
      "x-contact",
      "x-long",
      "x-missing",
      "authorization",
      "x-token-ish",
      "Bad Name",
    ],
    (name) => source[name],
  );
  assert.deepEqual(Object.keys(headers ?? {}).sort(), ["content-type", "x-contact", "x-long"]);
  assert.equal(headers?.["content-type"], "application/json");
  assert.equal(headers?.["x-contact"], "[REDACTED_EMAIL]");
  assert.equal(headers?.["x-long"]?.length, maxHeaderValueLength);
});

void test("never reads a refused name, and survives a throwing accessor", () => {
  const read: string[] = [];
  const headers = collectHeaders(["authorization", "etag", "x-boom"], (name) => {
    read.push(name);
    if (name === "x-boom") throw new Error("boom");
    return "v";
  });
  assert.deepEqual(read, ["etag", "x-boom"]);
  assert.deepEqual(headers, { etag: "v" });
  assert.equal(
    collectHeaders([], () => "v"),
    undefined,
  );
  assert.equal(
    collectHeaders(["etag"], () => null),
    undefined,
  );
});

void test("a snapshot never exceeds the header count limit", () => {
  const names = Array.from({ length: maxHeaders + 10 }, (_, index) => `x-h${index}`);
  assert.equal(Object.keys(collectHeaders(names, () => "v") ?? {}).length, maxHeaders);
});

void test("body flags are optional booleans, and anything else voids the document", () => {
  const rule = { id: "b", method: "post", pattern: "https://a.test/orders" };
  const parsed = parseCaptureSettings({
    rules: [{ ...rule, requestBody: true, responseBody: false }],
  });
  assert.equal(parsed.rules?.[0]?.requestBody, true);
  assert.equal(parsed.rules?.[0]?.responseBody, false);
  assert.deepEqual(parseCaptureSettings({ rules: [{ ...rule, requestBody: "yes" }] }), {});
  assert.deepEqual(parseCaptureSettings({ rules: [{ ...rule, responseBody: 1 }] }), {});
});

void test("a rule that only opts a body in is selected, and bodies combine by union", () => {
  const compiled = compileCapture({
    rules: [
      { id: "a", method: "POST", pattern: "https://a.test/orders", requestBody: true },
      { id: "b", method: "*", pattern: "https://a.test/*", responseBody: true },
    ],
  });
  assert.ok(compiled);
  assert.deepEqual(compiled.select("POST", "https://a.test/orders"), {
    request: [],
    response: [],
    requestBody: true,
    responseBody: true,
  });
  assert.equal(compiled.select("GET", "https://a.test/orders")?.requestBody, false);
  assert.equal(compiled.select("GET", "https://a.test/orders")?.responseBody, true);
  assert.equal(compiled.select("GET", "https://elsewhere.test/x"), undefined);
  assert.deepEqual([...compiled.requestNames], []);
});
