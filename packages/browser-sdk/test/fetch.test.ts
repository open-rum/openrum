import assert from "node:assert/strict";
import { test } from "node:test";
import type { CapturedEvent, EventSink } from "../src/client.ts";
import { OpenRUMClient } from "../src/client.ts";
import { fetchIntegration, type FetchRuntime } from "../src/integrations/fetch.ts";

function createHarness(fetchImplementation: typeof fetch) {
  const captured: CapturedEvent[] = [];
  let clock = 10;
  const runtime: FetchRuntime = {
    fetch: fetchImplementation,
    location: { href: "https://shop.example.test/cart" },
    now: () => (clock += 5),
  };
  const sink: EventSink = { add: (event) => captured.push(event) };
  const client = new OpenRUMClient(
    {
      dsn: "https://test@rum.example.test/ingest/v1/envelope",
      apiSampleRate: 1,
      integrations: [fetchIntegration("https://rum.example.test/ingest/v1/envelope", runtime)],
    },
    { sink, pageReader: () => ({ url: runtime.location?.href ?? "" }) },
  );
  return { runtime, client, captured };
}

void test("captures fetch success, 4xx, and 5xx without query, body, or headers", async () => {
  const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  const harness = createHarness(async (input, init) => {
    requests.push({ input, init });
    const url = String(input);
    const status = url.includes("server-error") ? 503 : url.includes("missing") ? 404 : 201;
    return new Response("ignored body", {
      status,
      headers: { "content-length": "12", authorization: "must-not-capture" },
    });
  });
  const secretInit = {
    method: "POST",
    headers: { authorization: "Bearer private" },
    body: "credit-card=private",
  };
  await harness.runtime.fetch("https://api.example.test/orders?token=private#secret", secretInit);
  await harness.runtime.fetch("https://api.example.test/missing?email=private");
  await harness.runtime.fetch("https://api.example.test/server-error");

  assert.equal(requests.length, 3);
  assert.equal(harness.captured.length, 3);
  const serialized = JSON.stringify(harness.captured);
  assert.doesNotMatch(serialized, /private|credit-card|authorization/i);
  const events = harness.captured.map((item) => item.event);
  assert.deepEqual(
    events.map((event) => (event.type === "api" ? event.request.status : undefined)),
    [201, 404, 503],
  );
  assert.equal(events[1]?.type === "api" ? events[1].request.failure : undefined, undefined);
  assert.equal(events[2]?.type === "api" ? events[2].request.failure : undefined, "http");
  assert.equal(events[0]?.type === "api" ? events[0].request.transfer_size : undefined, 12);
  await harness.client.close();
});

void test("classifies network and abort failures, preserves rejection, and excludes ingest", async () => {
  const networkError = new TypeError("network down");
  let calls = 0;
  const harness = createHarness(async (input) => {
    calls += 1;
    if (String(input).includes("abort")) throw new DOMException("cancelled", "AbortError");
    if (String(input).includes("network")) throw networkError;
    return new Response(null, { status: 202 });
  });
  await assert.rejects(harness.runtime.fetch("https://api.example.test/network"), networkError);
  await assert.rejects(harness.runtime.fetch("https://api.example.test/abort"), {
    name: "AbortError",
  });
  await harness.runtime.fetch("https://rum.example.test/ingest/v1/envelope?batch=private");

  assert.equal(calls, 3);
  assert.equal(harness.captured.length, 2);
  assert.deepEqual(
    harness.captured.map((item) => (item.event.type === "api" ? item.event.request.failure : null)),
    ["network", "abort"],
  );
  await harness.client.close();
});

const orderRule = {
  id: "orders",
  method: "*",
  pattern: "https://api.example.test/orders/*",
  requestHeaders: ["x-request-id"],
  responseHeaders: ["etag", "content-type"],
};

function apiRequest(captured: CapturedEvent[], index: number) {
  const event = captured[index]?.event;
  assert.equal(event?.type, "api");
  return event?.type === "api" ? event.request : undefined;
}

void test("captures only the headers a rule lists, for the endpoints it names", async () => {
  const harness = createHarness(
    async () =>
      new Response("{}", {
        status: 200,
        headers: {
          etag: '"abc"',
          "content-type": "application/json",
          "x-other": "not-listed",
          "set-cookie": "sid=1",
        },
      }),
  );
  harness.client.updateCapture({ rules: [orderRule] });

  await harness.runtime.fetch("https://api.example.test/orders/42?token=private", {
    headers: { "X-Request-Id": "r-1", authorization: "Bearer private", accept: "application/json" },
  });
  await harness.runtime.fetch("https://api.example.test/users/42", {
    headers: { "x-request-id": "r-2" },
  });

  assert.deepEqual(apiRequest(harness.captured, 0)?.request_headers, { "x-request-id": "r-1" });
  assert.deepEqual(apiRequest(harness.captured, 0)?.response_headers, {
    etag: '"abc"',
    "content-type": "application/json",
  });
  const unlisted = apiRequest(harness.captured, 1);
  assert.equal(unlisted?.request_headers, undefined, "an endpoint no rule names captures nothing");
  assert.equal(unlisted?.response_headers, undefined);
  assert.doesNotMatch(JSON.stringify(harness.captured), /private|x-other|sid=1|accept/i);
  await harness.client.close();
});

void test("a project with no rules reads no header at all", async () => {
  let read = 0;
  const harness = createHarness(async () => {
    const response = new Response("{}", { status: 200, headers: { etag: '"abc"' } });
    const original = response.headers.get.bind(response.headers);
    response.headers.get = (name: string) => {
      if (name !== "content-length") read += 1;
      return original(name);
    };
    return response;
  });
  await harness.runtime.fetch("https://api.example.test/orders/42", {
    headers: { "x-request-id": "r-1" },
  });
  assert.equal(read, 0);
  assert.equal(apiRequest(harness.captured, 0)?.request_headers, undefined);
  assert.equal(apiRequest(harness.captured, 0)?.response_headers, undefined);
  await harness.client.close();
});

void test("switching the rules off stops capture on the next request", async () => {
  const harness = createHarness(async () => new Response(null, { headers: { etag: '"abc"' } }));
  harness.client.updateCapture({ rules: [orderRule] });
  await harness.runtime.fetch("https://api.example.test/orders/1");
  harness.client.updateCapture({});
  await harness.runtime.fetch("https://api.example.test/orders/2");
  assert.deepEqual(apiRequest(harness.captured, 0)?.response_headers, { etag: '"abc"' });
  assert.equal(apiRequest(harness.captured, 1)?.response_headers, undefined);
  await harness.client.close();
});

void test("a rule that names a credential header still never reads it", async () => {
  const harness = createHarness(
    async () => new Response("{}", { headers: { "set-cookie": "sid=1", etag: '"abc"' } }),
  );
  // Bypasses parseCaptureSettings on purpose: the reader has its own refusal.
  harness.client.updateCapture({
    rules: [
      {
        id: "bad",
        method: "*",
        pattern: "https://api.example.test/*",
        requestHeaders: ["authorization"],
        responseHeaders: ["set-cookie", "etag"],
      },
    ],
  });
  await harness.runtime.fetch("https://api.example.test/x", {
    headers: { authorization: "Bearer private" },
  });
  const request = apiRequest(harness.captured, 0);
  assert.equal(request?.request_headers, undefined);
  assert.deepEqual(request?.response_headers, { etag: '"abc"' });
  await harness.client.close();
});

void test("reads request headers from a Request object, and prefers init headers", async () => {
  const harness = createHarness(async () => new Response("{}"));
  harness.client.updateCapture({ rules: [orderRule] });
  await harness.runtime.fetch(
    new Request("https://api.example.test/orders/1", {
      headers: { "x-request-id": "from-request" },
    }),
  );
  await harness.runtime.fetch(
    new Request("https://api.example.test/orders/2", {
      headers: { "x-request-id": "from-request" },
    }),
    { headers: { "x-request-id": "from-init" } },
  );
  assert.deepEqual(apiRequest(harness.captured, 0)?.request_headers, {
    "x-request-id": "from-request",
  });
  assert.deepEqual(apiRequest(harness.captured, 1)?.request_headers, {
    "x-request-id": "from-init",
  });
  await harness.client.close();
});

void test("a failed request keeps the request headers it sent", async () => {
  const harness = createHarness(async () => {
    throw new TypeError("network down");
  });
  harness.client.updateCapture({ rules: [orderRule] });
  await assert.rejects(
    harness.runtime.fetch("https://api.example.test/orders/9", {
      headers: { "x-request-id": "r-9" },
    }),
    TypeError,
  );
  const request = apiRequest(harness.captured, 0);
  assert.equal(request?.failure, "network");
  assert.deepEqual(request?.request_headers, { "x-request-id": "r-9" });
  assert.equal(request?.response_headers, undefined);
  await harness.client.close();
});

const bodyRule = {
  id: "orders",
  method: "*",
  pattern: "https://api.example.test/orders*",
  requestBody: true,
  responseBody: true,
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 25));
const secretOrder = JSON.stringify({
  items: [{ sku: "A-1" }],
  contact: { email: "buyer@example.com" },
  payment: { cardNumber: "4242 4242 4242 4242" },
});

void test("captures redacted bodies for an opted-in endpoint and leaves the page's response readable", async () => {
  const harness = createHarness(
    async () =>
      new Response(JSON.stringify({ orderId: "o-1", token: "tok_secret" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
  );
  harness.client.updateCapture({ rules: [bodyRule] });

  const response = await harness.runtime.fetch("https://api.example.test/orders", {
    method: "POST",
    body: secretOrder,
    headers: { "content-type": "application/json" },
  });
  // The page reads its own response after the SDK took a copy.
  assert.deepEqual(await response.json(), { orderId: "o-1", token: "tok_secret" });
  await settle();

  const request = apiRequest(harness.captured, 0);
  assert.equal(request?.status, 201);
  assert.match(request?.request_body ?? "", /"sku":"A-1"/);
  assert.doesNotMatch(JSON.stringify(harness.captured), /buyer@example|4242|tok_secret/);
  assert.match(request?.request_body ?? "", /"email":"\[REDACTED\]"/);
  assert.match(request?.response_body ?? "", /"orderId":"o-1"/);
  assert.match(request?.response_body ?? "", /"token":"\[REDACTED\]"/);
  await harness.client.close();
});

void test("reads only the direction a rule opted in", async () => {
  const harness = createHarness(
    async () => new Response('{"ok":true}', { headers: { "content-type": "application/json" } }),
  );
  harness.client.updateCapture({ rules: [{ ...bodyRule, requestBody: false }] });
  await harness.runtime.fetch("https://api.example.test/orders", { method: "POST", body: "{}" });
  await settle();
  const request = apiRequest(harness.captured, 0);
  assert.equal(request?.request_body, undefined);
  assert.equal(request?.response_body, '{"ok":true}');
  await harness.client.close();
});

void test("copies nothing when the project opted in to no body", async () => {
  let cloned = 0;
  const harness = createHarness(async () => {
    const response = new Response('{"ok":true}', {
      headers: { "content-type": "application/json" },
    });
    const clone = response.clone.bind(response);
    response.clone = () => {
      cloned += 1;
      return clone();
    };
    return response;
  });
  harness.client.updateCapture({
    rules: [
      { id: "h", method: "*", pattern: "https://api.example.test/*", responseHeaders: ["etag"] },
    ],
  });
  await harness.runtime.fetch("https://api.example.test/orders", { method: "POST", body: "{}" });
  assert.equal(cloned, 0);
  const request = apiRequest(harness.captured, 0);
  assert.equal(request?.request_body, undefined);
  assert.equal(request?.response_body, undefined);
  await harness.client.close();
});

void test("does not read binary responses, FormData or Blob request bodies", async () => {
  const harness = createHarness(
    async () =>
      new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } }),
  );
  harness.client.updateCapture({ rules: [bodyRule] });
  await harness.runtime.fetch("https://api.example.test/orders", {
    method: "POST",
    body: new FormData(),
  });
  await harness.runtime.fetch("https://api.example.test/orders", {
    method: "POST",
    body: new Blob(["secret"]),
  });
  await settle();
  for (const index of [0, 1]) {
    assert.equal(apiRequest(harness.captured, index)?.request_body, undefined);
    assert.equal(apiRequest(harness.captured, index)?.response_body, undefined);
  }
  await harness.client.close();
});

void test("a body too large to redact completely is omitted, not cut", async () => {
  const large = "x".repeat(70_000);
  const harness = createHarness(
    async () => new Response(large, { headers: { "content-type": "text/plain" } }),
  );
  harness.client.updateCapture({ rules: [bodyRule] });
  await harness.runtime.fetch("https://api.example.test/orders", { method: "POST", body: large });
  await settle();
  const request = apiRequest(harness.captured, 0);
  assert.equal(request?.response_body, "[omitted: body larger than 64 KB]");
  assert.equal(request?.request_body, "[omitted: body larger than 64 KB]");
  await harness.client.close();
});

void test("reads the body of a Request object and keeps it usable by the page", async () => {
  const harness = createHarness(async (input) => {
    const text = input instanceof Request ? await input.text() : "";
    return new Response(text, { headers: { "content-type": "application/json" } });
  });
  harness.client.updateCapture({ rules: [bodyRule] });
  const response = await harness.runtime.fetch(
    new Request("https://api.example.test/orders", {
      method: "POST",
      body: '{"sku":"A-1"}',
      headers: { "content-type": "application/json" },
    }),
  );
  assert.equal(await response.text(), '{"sku":"A-1"}');
  await settle();
  assert.equal(apiRequest(harness.captured, 0)?.request_body, '{"sku":"A-1"}');
  await harness.client.close();
});

void test("a failed request keeps the request body it sent", async () => {
  const harness = createHarness(async () => {
    throw new TypeError("network down");
  });
  harness.client.updateCapture({ rules: [bodyRule] });
  await assert.rejects(
    harness.runtime.fetch("https://api.example.test/orders", {
      method: "POST",
      body: '{"sku":"A-1"}',
    }),
    TypeError,
  );
  await settle();
  const request = apiRequest(harness.captured, 0);
  assert.equal(request?.failure, "network");
  assert.equal(request?.request_body, '{"sku":"A-1"}');
  assert.equal(request?.response_body, undefined);
  await harness.client.close();
});
