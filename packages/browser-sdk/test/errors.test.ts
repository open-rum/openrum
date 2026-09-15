import assert from "node:assert/strict";
import { test } from "node:test";
import type { CapturedEvent, EventSink } from "../src/client.ts";
import { OpenRUMClient } from "../src/client.ts";
import { errorIntegration, type ErrorRuntime } from "../src/integrations/errors.ts";

class FakeErrorRuntime implements ErrorRuntime {
  readonly listeners = new Map<string, Set<EventListener>>();
  readonly onerror = () => "original";

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string, event: Event): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

function testClient(runtime: ErrorRuntime, captured: CapturedEvent[]): OpenRUMClient {
  let nextID = 1;
  const sink: EventSink = { add: (value) => captured.push(value) };
  return new OpenRUMClient(
    { dsn: "https://test@rum.example.test/ingest", integrations: [errorIntegration(runtime)] },
    {
      sink,
      randomUUID: () => `00000000-0000-4000-8000-${String(nextID++).padStart(12, "0")}`,
      pageReader: () => ({ url: "https://example.test/" }),
    },
  );
}

void test("captures bounded window errors without replacing the host handler", async () => {
  const runtime = new FakeErrorRuntime();
  const captured: CapturedEvent[] = [];
  const originalHandler = runtime.onerror;
  const client = testClient(runtime, captured);
  runtime.dispatch(
    "error",
    Object.assign(new Event("error"), {
      error: { name: "TypeError", message: "x".repeat(3_000), stack: "s".repeat(70_000) },
      filename: "https://example.test/assets/app.js?token=private#frame",
      lineno: 10,
      colno: 4,
    }),
  );

  assert.equal(runtime.onerror, originalHandler);
  assert.equal(captured.length, 1);
  const event = captured[0]?.event;
  assert.equal(event?.type, "error");
  if (event?.type !== "error") assert.fail("expected an error event");
  assert.equal(event.error.name, "TypeError");
  assert.equal(event.error.message.length, 2_048);
  assert.equal(event.error.stack?.length, 65_536);
  assert.equal(event.error.mechanism, "window.onerror");
  assert.doesNotMatch(event.error.message, /private/);
  assert.doesNotThrow(() => JSON.stringify(captured[0]));

  await client.close();
  runtime.dispatch("error", Object.assign(new Event("error"), { message: "after close" }));
  assert.equal(captured.length, 1);
});

void test("serializes unhandled rejection reasons, including circular objects", async () => {
  const runtime = new FakeErrorRuntime();
  const captured: CapturedEvent[] = [];
  const client = testClient(runtime, captured);
  const circular: { self?: unknown; detail: string } = { detail: "failed" };
  circular.self = circular;
  assert.doesNotThrow(() =>
    runtime.dispatch(
      "unhandledrejection",
      Object.assign(new Event("unhandledrejection"), { reason: circular }),
    ),
  );

  const event = captured[0]?.event;
  assert.equal(event?.type, "error");
  if (event?.type !== "error") assert.fail("expected an error event");
  assert.equal(event.error.name, "UnhandledRejection");
  assert.match(event.error.message, /Circular/);
  assert.equal(event.error.mechanism, "unhandledrejection");
  await client.close();
});
