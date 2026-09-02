import assert from "node:assert/strict";
import { test } from "node:test";
import type { CapturedEvent } from "../src/client.ts";
import { buildEnvelope, encodeEnvelope, encodedEnvelopeFits } from "../src/transport/envelope.ts";
import { PersistentQueue } from "../src/transport/queue.ts";
import { Sender, type SenderRuntime } from "../src/transport/sender.ts";
import type { StorageLike } from "../src/session.ts";

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

class ControlledSenderRuntime implements SenderRuntime {
  online = true;
  readonly fetchCalls: Array<{ input: string; init: RequestInit }> = [];
  readonly timers = new Map<number, { callback: () => void; delay: number }>();
  readonly listeners = new Map<string, Set<EventListener>>();
  readonly beaconCalls: Array<{ url: string; data: BodyInit }> = [];
  readonly responses: Array<Response | Error> = [];
  storage?: StorageLike;
  #nextTimer = 1;

  async fetch(input: string, init: RequestInit): Promise<Response> {
    this.fetchCalls.push({ input, init });
    const response = this.responses.shift() ?? new Response(null, { status: 202 });
    if (response instanceof Error) throw response;
    return response;
  }

  isOnline(): boolean {
    return this.online;
  }

  setTimeout(callback: () => void, delay: number): number {
    const handle = this.#nextTimer++;
    this.timers.set(handle, { callback, delay });
    return handle;
  }

  clearTimeout(handle: number): void {
    this.timers.delete(handle);
  }

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  sendBeacon(url: string, data: BodyInit): boolean {
    this.beaconCalls.push({ url, data });
    return true;
  }

  random(): number {
    return 0;
  }

  now(): number {
    return Date.parse("2026-09-02T10:00:00.000Z");
  }

  emit(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener(new Event(type));
  }
}

function capturedEvent(
  index: number,
  priority: CapturedEvent["priority"] = "normal",
  pageID = "00000000-0000-4000-8000-000000000010",
): CapturedEvent {
  return {
    priority,
    context: {
      environment: "production",
      session_id: "00000000-0000-4000-8000-000000000001",
      page_id: pageID,
      anonymous_user_id: "anon-test",
      page: { url: "https://example.test/" },
    },
    event: {
      type: "custom",
      event_id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      timestamp: "2026-09-02T10:00:00.000Z",
      name: `event_${index}`,
    },
  };
}

void test("persistent queue restores data, groups contexts, and evicts low priority first", () => {
  const storage = new MemoryStorage();
  const queue = new PersistentQueue({ storage, storageKey: "test", maxBufferedEvents: 3 });
  queue.add(capturedEvent(1, "low"));
  queue.add(capturedEvent(2, "critical"));
  queue.add(capturedEvent(3, "normal"));
  queue.add(capturedEvent(4, "low"));
  assert.deepEqual(
    queue.peekBatch().map((item) => item.event.event_id),
    [
      capturedEvent(2).event.event_id,
      capturedEvent(3).event.event_id,
      capturedEvent(4).event.event_id,
    ],
  );
  assert.equal(queue.stats().droppedEvents, 1);

  const restored = new PersistentQueue({ storage, storageKey: "test" });
  restored.add(capturedEvent(5, "normal", "00000000-0000-4000-8000-000000000099"));
  assert.equal(restored.peekBatch().length, 3);
  restored.removePrefix(3);
  assert.equal(restored.peekBatch().length, 1);
});

void test("sender batches at 100 events and acknowledges only successful responses", async () => {
  const runtime = new ControlledSenderRuntime();
  const sender = new Sender(
    { endpoint: "https://rum.example.test/ingest/v1/envelope", writeKey: "orr_pk_test" },
    runtime,
  );
  for (let index = 1; index <= 101; index += 1) sender.add(capturedEvent(index));
  assert.equal(runtime.timers.size, 1);
  await sender.flush();

  assert.equal(runtime.fetchCalls.length, 2);
  const batchSizes = runtime.fetchCalls.map((call) => {
    const body = call.init.body as Uint8Array;
    return (JSON.parse(new TextDecoder().decode(body)) as { events: unknown[] }).events.length;
  });
  assert.deepEqual(batchSizes, [100, 1]);
  assert.equal(
    (runtime.fetchCalls[0]?.init.headers as Record<string, string>)["x-openrum-key"],
    "orr_pk_test",
  );
  assert.equal(sender.stats().queuedEvents, 0);
  assert.equal(sender.stats().acceptedBatches, 2);
  await sender.close();
});

void test("offline events persist and are delivered by a later sender", async () => {
  const storage = new MemoryStorage();
  const offlineRuntime = new ControlledSenderRuntime();
  offlineRuntime.online = false;
  offlineRuntime.storage = storage;
  const options = {
    endpoint: "https://rum.example.test/ingest/v1/envelope",
    writeKey: "orr_pk_test",
    storageKey: "offline-test",
  };
  const offlineSender = new Sender(options, offlineRuntime);
  offlineSender.add(capturedEvent(1));
  await offlineSender.flush();
  assert.equal(offlineRuntime.fetchCalls.length, 0);
  assert.equal(offlineSender.stats().queuedEvents, 1);
  await offlineSender.close();

  const onlineRuntime = new ControlledSenderRuntime();
  onlineRuntime.storage = storage;
  const onlineSender = new Sender(options, onlineRuntime);
  await onlineSender.flush();
  assert.equal(onlineRuntime.fetchCalls.length, 1);
  assert.equal(onlineSender.stats().queuedEvents, 0);
  await onlineSender.close();
});

void test("429 and 503 remain queued, respect Retry-After, and retry to acceptance", async () => {
  const runtime = new ControlledSenderRuntime();
  runtime.responses.push(
    new Response(null, { status: 429, headers: { "retry-after": "2" } }),
    new Response(null, { status: 503 }),
    new Response(null, { status: 202 }),
  );
  const sender = new Sender({ endpoint: "/ingest", writeKey: "key" }, runtime);
  sender.add(capturedEvent(1));

  await sender.flush();
  assert.equal(sender.stats().queuedEvents, 1);
  assert.equal([...runtime.timers.values()].at(-1)?.delay, 2_000);
  await sender.flush();
  assert.equal(sender.stats().queuedEvents, 1);
  assert.equal([...runtime.timers.values()].at(-1)?.delay, 1_000);
  await sender.flush();
  assert.equal(sender.stats().queuedEvents, 0);
  assert.equal(sender.stats().retryableFailures, 2);
  await sender.close();
});

void test("invalid or revoked keys disable delivery and stop blind retries", async () => {
  const runtime = new ControlledSenderRuntime();
  runtime.responses.push(new Response(null, { status: 401 }));
  const sender = new Sender({ endpoint: "/ingest", writeKey: "revoked" }, runtime);
  sender.add(capturedEvent(1));
  sender.add(capturedEvent(2));
  await sender.flush();
  assert.equal(sender.stats().disabled, true);
  assert.equal(sender.stats().queuedEvents, 0);
  sender.add(capturedEvent(3));
  await sender.flush();
  assert.equal(runtime.fetchCalls.length, 1);
  await sender.close();
});

void test("close uses keepalive and a configured pre-authenticated beacon can flush pagehide", async () => {
  const runtime = new ControlledSenderRuntime();
  const sender = new Sender({ endpoint: "/ingest", writeKey: "key" }, runtime);
  sender.add(capturedEvent(1));
  await sender.close();
  assert.equal(runtime.fetchCalls[0]?.init.keepalive, true);

  const beaconRuntime = new ControlledSenderRuntime();
  const beaconSender = new Sender(
    { endpoint: "/ingest", writeKey: "key", beaconEndpoint: "/beacon-ticket/abc" },
    beaconRuntime,
  );
  beaconSender.add(capturedEvent(2));
  beaconRuntime.emit("pagehide");
  assert.equal(beaconRuntime.beaconCalls.length, 1);
  assert.equal(beaconRuntime.beaconCalls[0]?.url, "/beacon-ticket/abc");
  assert.equal(beaconSender.stats().queuedEvents, 0);
  await beaconSender.close();
});

void test("gzip encoding is bounded and reversible for compressible envelopes", async () => {
  const event = capturedEvent(1);
  if (event.event.type !== "custom") assert.fail("expected custom event");
  event.event.attributes = Object.fromEntries(
    Array.from({ length: 20 }, (_, index) => [`key_${index}`, "x".repeat(500)]),
  );
  const envelope = buildEnvelope([event], { name: "@openrum/browser", version: "0.1.0" });
  const encoded = await encodeEnvelope(envelope);
  assert.equal(encoded.compressed, true);
  assert.ok(encoded.body.byteLength < encoded.rawBytes);
  assert.equal(encodedEnvelopeFits(encoded, false), true);
  const compressedBody = encoded.body.buffer.slice(
    encoded.body.byteOffset,
    encoded.body.byteOffset + encoded.body.byteLength,
  ) as ArrayBuffer;
  const decompressed = await new Response(
    new Blob([compressedBody]).stream().pipeThrough(new DecompressionStream("gzip")),
  ).json();
  assert.deepEqual(decompressed, envelope);
});
