import assert from "node:assert/strict";
import { test } from "node:test";
import type { CapturedEvent, EventSink } from "../src/client.ts";
import { OpenRUMClient } from "../src/client.ts";
import { xhrIntegration, type XHRRuntime } from "../src/integrations/xhr.ts";

class FakeXHR extends EventTarget {
  status = 0;
  responseLength?: string;
  method = "";
  url = "";
  body: unknown;

  open(method: string, url: string | URL): void {
    this.method = method;
    this.url = String(url);
  }

  send(body?: unknown): void {
    this.body = body;
  }

  responseType = "";
  responseText = "";
  response: unknown = null;
  requestHeaders: Array<[string, string]> = [];
  responseHeaders: Record<string, string> = {};

  setRequestHeader(name: string, value: string): void {
    this.requestHeaders.push([name, value]);
  }

  getResponseHeader(name: string): string | null {
    const key = name.toLowerCase();
    if (key === "content-length") return this.responseLength ?? null;
    return this.responseHeaders[key] ?? null;
  }
}

function createHarness() {
  const captured: CapturedEvent[] = [];
  let clock = 0;
  const runtime: XHRRuntime = {
    XMLHttpRequest: FakeXHR,
    location: { href: "https://shop.example.test/" },
    now: () => (clock += 8),
  };
  const originalOpen = FakeXHR.prototype.open;
  const originalSend = FakeXHR.prototype.send;
  const originalSetRequestHeader = FakeXHR.prototype.setRequestHeader;
  const sink: EventSink = { add: (event) => captured.push(event) };
  const client = new OpenRUMClient(
    {
      dsn: "https://test@rum.example.test/ingest/v1/envelope",
      apiSampleRate: 1,
      integrations: [xhrIntegration("/ingest/v1/envelope", runtime)],
    },
    { sink, pageReader: () => ({ url: runtime.location?.href ?? "" }) },
  );
  return { client, captured, originalOpen, originalSend, originalSetRequestHeader };
}

void test("captures XHR success, server failure, abort, and restores the prototype", async () => {
  const harness = createHarness();
  const success = new FakeXHR();
  success.open("POST", "https://api.example.test/orders?token=private");
  success.send("private body");
  success.status = 201;
  success.responseLength = "44";
  success.dispatchEvent(new Event("loadend"));

  const failed = new FakeXHR();
  failed.open("GET", "https://api.example.test/orders/42");
  failed.send();
  failed.status = 503;
  failed.dispatchEvent(new Event("loadend"));

  const aborted = new FakeXHR();
  aborted.open("GET", "https://api.example.test/slow");
  aborted.send();
  aborted.dispatchEvent(new Event("abort"));
  aborted.dispatchEvent(new Event("loadend"));

  assert.equal(harness.captured.length, 3);
  assert.doesNotMatch(JSON.stringify(harness.captured), /private/);
  assert.deepEqual(
    harness.captured.map((item) => (item.event.type === "api" ? item.event.request.failure : null)),
    [undefined, "http", "abort"],
  );
  assert.equal(
    harness.captured[0]?.event.type === "api"
      ? harness.captured[0].event.request.transfer_size
      : undefined,
    44,
  );
  await harness.client.close();
  assert.equal(FakeXHR.prototype.open, harness.originalOpen);
  assert.equal(FakeXHR.prototype.send, harness.originalSend);
  assert.equal(FakeXHR.prototype.setRequestHeader, harness.originalSetRequestHeader);
});

void test("excludes the ingest endpoint even when it has a query", async () => {
  const harness = createHarness();
  const request = new FakeXHR();
  request.open("POST", "/ingest/v1/envelope?retry=1");
  request.send("payload");
  request.status = 202;
  request.dispatchEvent(new Event("loadend"));
  assert.equal(harness.captured.length, 0);
  await harness.client.close();
});

const rule = {
  id: "orders",
  method: "*",
  pattern: "https://api.example.test/orders/*",
  requestHeaders: ["x-request-id"],
  responseHeaders: ["etag"],
};

void test("records only listed request headers while they are set, and reads listed response headers", async () => {
  const harness = createHarness();
  harness.client.updateCapture({ rules: [rule] });
  const request = new FakeXHR();
  request.open("GET", "https://api.example.test/orders/42?token=private");
  request.setRequestHeader("X-Request-Id", "r-1");
  request.setRequestHeader("Authorization", "Bearer private");
  request.setRequestHeader("accept", "application/json");
  request.send();
  request.status = 200;
  request.responseHeaders = { etag: '"abc"', "set-cookie": "sid=1" };
  request.dispatchEvent(new Event("loadend"));

  const captured = harness.captured[0]?.event;
  assert.equal(captured?.type, "api");
  const api = captured?.type === "api" ? captured.request : undefined;
  assert.deepEqual(api?.request_headers, { "x-request-id": "r-1" });
  assert.deepEqual(api?.response_headers, { etag: '"abc"' });
  assert.doesNotMatch(JSON.stringify(harness.captured), /private|sid=1|accept/i);
  // The page's own request still got every header it set.
  assert.equal(request.requestHeaders.length, 3);
  await harness.client.close();
});

void test("keeps nothing when no rule exists, and nothing for an endpoint no rule names", async () => {
  const harness = createHarness();
  const plain = new FakeXHR();
  plain.open("GET", "https://api.example.test/orders/1");
  plain.setRequestHeader("x-request-id", "r-1");
  plain.send();
  plain.status = 200;
  plain.responseHeaders = { etag: '"abc"' };
  plain.dispatchEvent(new Event("loadend"));

  harness.client.updateCapture({ rules: [rule] });
  const other = new FakeXHR();
  other.open("GET", "https://api.example.test/users/1");
  other.setRequestHeader("x-request-id", "r-2");
  other.send();
  other.status = 200;
  other.responseHeaders = { etag: '"abc"' };
  other.dispatchEvent(new Event("loadend"));

  for (const item of harness.captured) {
    const api = item.event.type === "api" ? item.event.request : undefined;
    assert.equal(api?.request_headers, undefined);
    assert.equal(api?.response_headers, undefined);
  }
  await harness.client.close();
});

void test("repeated setRequestHeader calls combine like the browser sends them", async () => {
  const harness = createHarness();
  harness.client.updateCapture({ rules: [rule] });
  const request = new FakeXHR();
  request.open("GET", "https://api.example.test/orders/1");
  request.setRequestHeader("x-request-id", "a");
  request.setRequestHeader("x-request-id", "b");
  request.send();
  request.status = 200;
  request.dispatchEvent(new Event("loadend"));
  const captured = harness.captured[0]?.event;
  assert.deepEqual(captured?.type === "api" ? captured.request.request_headers : undefined, {
    "x-request-id": "a, b",
  });
  await harness.client.close();
});

const bodyRule = {
  id: "orders",
  method: "*",
  pattern: "https://api.example.test/orders*",
  requestBody: true,
  responseBody: true,
};

function finished(request: FakeXHR, body: unknown, status = 200) {
  request.send(body);
  request.status = status;
  request.dispatchEvent(new Event("loadend"));
}

function apiOf(harness: ReturnType<typeof createHarness>, index = 0) {
  const event = harness.captured[index]?.event;
  return event?.type === "api" ? event.request : undefined;
}

void test("captures redacted request and response bodies for an opted-in endpoint", async () => {
  const harness = createHarness();
  harness.client.updateCapture({ rules: [bodyRule] });
  const request = new FakeXHR();
  request.open("POST", "https://api.example.test/orders");
  request.responseHeaders = { "content-type": "application/json" };
  request.responseText = JSON.stringify({ orderId: "o-1", token: "tok_secret" });
  finished(request, JSON.stringify({ sku: "A-1", contact: { email: "buyer@example.com" } }), 201);

  const api = apiOf(harness);
  assert.match(api?.request_body ?? "", /"sku":"A-1"/);
  assert.match(api?.request_body ?? "", /"email":"\[REDACTED\]"/);
  assert.match(api?.response_body ?? "", /"orderId":"o-1"/);
  assert.doesNotMatch(JSON.stringify(harness.captured), /buyer@example|tok_secret/);
  await harness.client.close();
});

void test("reads only the direction a rule opted in, and nothing without a rule", async () => {
  const harness = createHarness();
  const plain = new FakeXHR();
  plain.open("POST", "https://api.example.test/orders");
  plain.responseText = '{"a":1}';
  finished(plain, '{"b":2}');
  assert.equal(apiOf(harness, 0)?.request_body, undefined);
  assert.equal(apiOf(harness, 0)?.response_body, undefined);

  harness.client.updateCapture({ rules: [{ ...bodyRule, responseBody: false }] });
  const request = new FakeXHR();
  request.open("POST", "https://api.example.test/orders");
  request.responseText = '{"a":1}';
  finished(request, '{"b":2}');
  assert.equal(apiOf(harness, 1)?.request_body, '{"b":2}');
  assert.equal(apiOf(harness, 1)?.response_body, undefined);
  await harness.client.close();
});

void test("skips binary bodies and reads a json responseType", async () => {
  const harness = createHarness();
  harness.client.updateCapture({ rules: [bodyRule] });
  const binary = new FakeXHR();
  binary.open("POST", "https://api.example.test/orders");
  binary.responseHeaders = { "content-type": "image/png" };
  binary.responseText = "not text";
  finished(binary, new Blob(["secret"]));
  assert.equal(apiOf(harness, 0)?.request_body, undefined);
  assert.equal(apiOf(harness, 0)?.response_body, undefined);

  const json = new FakeXHR();
  json.open("GET", "https://api.example.test/orders");
  json.responseType = "json";
  json.responseHeaders = { "content-type": "application/json" };
  json.response = { orderId: "o-2", password: "hunter2" };
  finished(json, undefined);
  assert.match(apiOf(harness, 1)?.response_body ?? "", /"orderId":"o-2"/);
  assert.doesNotMatch(apiOf(harness, 1)?.response_body ?? "", /hunter2/);
  await harness.client.close();
});

void test("omits a response too large to redact completely", async () => {
  const harness = createHarness();
  harness.client.updateCapture({ rules: [bodyRule] });
  const request = new FakeXHR();
  request.open("GET", "https://api.example.test/orders");
  request.responseText = "x".repeat(70_000);
  finished(request, undefined);
  assert.equal(apiOf(harness)?.response_body, "[omitted: body larger than 64 KB]");
  await harness.client.close();
});
