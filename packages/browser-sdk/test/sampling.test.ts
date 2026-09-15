import assert from "node:assert/strict";
import { test } from "node:test";
import type { CapturedEvent, EventSink } from "../src/client.ts";
import { OpenRUMClient } from "../src/client.ts";
import {
  defaultSamplingOptions,
  deterministicFraction,
  eventPriority,
  shouldSample,
} from "../src/sampling.ts";

void test("sampling decisions are repeatable per session and independent by event class", () => {
  const options = { eventSampleRate: 0.5, apiSampleRate: 0.5, errorSampleRate: 0.5 };
  for (let index = 0; index < 1_000; index += 1) {
    const sessionID = `session-${index}`;
    assert.equal(shouldSample(sessionID, "api", options), shouldSample(sessionID, "api", options));
    assert.equal(
      shouldSample(sessionID, "page_view", options),
      shouldSample(sessionID, "custom", options),
    );
  }
  const independent = Array.from({ length: 1_000 }, (_, index) => `session-${index}`).some(
    (sessionID) =>
      shouldSample(sessionID, "api", options) !== shouldSample(sessionID, "error", options),
  );
  assert.equal(independent, true);
});

void test("deterministic sampling distribution stays within tolerance", () => {
  const sessions = 50_000;
  const rate = 0.2;
  let accepted = 0;
  for (let index = 0; index < sessions; index += 1) {
    if (deterministicFraction(`session-${index}:api`) < rate) accepted += 1;
  }
  const observed = accepted / sessions;
  assert.ok(Math.abs(observed - rate) < 0.01, `observed rate ${observed}`);
});

void test("errors sample independently from APIs and captured events carry rate and priority", () => {
  const captured: CapturedEvent[] = [];
  const sink: EventSink = { add: (event) => captured.push(event) };
  const client = new OpenRUMClient(
    {
      dsn: "https://test@rum.example.test/ingest",
      eventSampleRate: 0,
      apiSampleRate: 0,
      errorSampleRate: 1,
    },
    {
      sink,
      randomUUID: () => "00000000-0000-4000-8000-000000000001",
      pageReader: () => ({ url: "https://example.test/" }),
    },
  );
  client.capture({ type: "page_view", navigation_type: "navigate" });
  client.capture({
    type: "api",
    request: { method: "GET", url: "https://api.example.test/orders", duration_ms: 10 },
  });
  client.capture({ type: "error", error: { name: "Error", message: "failed", handled: false } });

  assert.equal(captured.length, 1);
  assert.equal(captured[0]?.event.type, "error");
  assert.equal(captured[0]?.event.sample_rate, 1);
  assert.equal(captured[0]?.priority, "critical");
  assert.equal(client.diagnostics().droppedEvents, 2);
  assert.equal(eventPriority("api"), "low");
  assert.equal(eventPriority("web_vital"), "normal");
  assert.equal(shouldSample("any", "error", defaultSamplingOptions), true);
});
