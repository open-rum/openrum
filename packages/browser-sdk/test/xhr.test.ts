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

  getResponseHeader(name: string): string | null {
    return name.toLowerCase() === "content-length" ? (this.responseLength ?? null) : null;
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
  const sink: EventSink = { add: (event) => captured.push(event) };
  const client = new OpenRUMClient(
    {
      dsn: "https://test@rum.example.test/ingest/v1/envelope",
      apiSampleRate: 1,
      integrations: [xhrIntegration("/ingest/v1/envelope", runtime)],
    },
    { sink, pageReader: () => ({ url: runtime.location?.href ?? "" }) },
  );
  return { client, captured, originalOpen, originalSend };
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
