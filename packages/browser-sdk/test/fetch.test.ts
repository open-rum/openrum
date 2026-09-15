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
