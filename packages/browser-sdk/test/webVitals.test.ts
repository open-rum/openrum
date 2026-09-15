import assert from "node:assert/strict";
import { test } from "node:test";
import type { CapturedEvent, EventSink } from "../src/client.ts";
import { OpenRUMClient } from "../src/client.ts";
import { webVitalsIntegration, type WebVitalsRuntime } from "../src/integrations/webVitals.ts";

type Report = Parameters<WebVitalsRuntime["onCLS"]>[0];

class ControlledWebVitals implements WebVitalsRuntime {
  readonly callbacks: Record<"CLS" | "INP" | "LCP" | "FCP" | "TTFB", Report[]> = {
    CLS: [],
    INP: [],
    LCP: [],
    FCP: [],
    TTFB: [],
  };
  readonly options: unknown[] = [];

  readonly onCLS: WebVitalsRuntime["onCLS"] = (callback, options) => {
    this.callbacks.CLS.push(callback);
    this.options.push(options);
  };

  readonly onINP: WebVitalsRuntime["onINP"] = (callback, options) => {
    this.callbacks.INP.push(callback);
    this.options.push(options);
  };

  readonly onLCP: WebVitalsRuntime["onLCP"] = (callback, options) => {
    this.callbacks.LCP.push(callback);
    this.options.push(options);
  };
  readonly onFCP: NonNullable<WebVitalsRuntime["onFCP"]> = (callback, options) => {
    this.callbacks.FCP.push(callback);
    this.options.push(options);
  };
  readonly onTTFB: NonNullable<WebVitalsRuntime["onTTFB"]> = (callback, options) => {
    this.callbacks.TTFB.push(callback);
    this.options.push(options);
  };

  emit(
    name: "CLS" | "INP" | "LCP" | "FCP" | "TTFB",
    value: number,
    navigationType:
      | "navigate"
      | "reload"
      | "back-forward"
      | "back-forward-cache"
      | "prerender"
      | "restore"
      | "soft-navigation" = "navigate",
  ): void {
    for (const callback of this.callbacks[name]) {
      callback({ name, value, delta: value, rating: "good", navigationType });
    }
  }
}

function createClient(runtime: ControlledWebVitals, captured: CapturedEvent[]): OpenRUMClient {
  let nextID = 1;
  const sink: EventSink = { add: (event) => captured.push(event) };
  return new OpenRUMClient(
    {
      dsn: "https://test@rum.example.test/ingest",
      integrations: [webVitalsIntegration(runtime)],
    },
    {
      sink,
      randomUUID: () => `00000000-0000-4000-8000-${String(nextID++).padStart(12, "0")}`,
      pageReader: () => ({ url: "https://example.test/" }),
    },
  );
}

void test("captures all five Web Vitals with rating, delta, and navigation type", async () => {
  const runtime = new ControlledWebVitals();
  const captured: CapturedEvent[] = [];
  const client = createClient(runtime, captured);
  runtime.emit("LCP", 2_134.2, "reload");
  runtime.emit("INP", 180, "soft-navigation");
  runtime.emit("CLS", 0.08, "back-forward-cache");
  runtime.emit("FCP", 1200);
  runtime.emit("TTFB", 400);

  assert.equal(captured.length, 5);
  const metrics = captured.map((item) =>
    item.event.type === "web_vital" ? item.event.metric : null,
  );
  assert.deepEqual(metrics, [
    { name: "LCP", value: 2_134.2, delta: 2_134.2, rating: "good", navigation_type: "reload" },
    { name: "INP", value: 180, delta: 180, rating: "good", navigation_type: "route_change" },
    { name: "CLS", value: 0.08, delta: 0.08, rating: "good", navigation_type: "back_forward" },
    { name: "FCP", value: 1200, delta: 1200, rating: "good", navigation_type: "navigate" },
    { name: "TTFB", value: 400, delta: 400, rating: "good", navigation_type: "navigate" },
  ]);
  assert.deepEqual(runtime.options, [
    { reportAllChanges: false, reportSoftNavs: true },
    { reportAllChanges: false, reportSoftNavs: true },
    { reportAllChanges: false, reportSoftNavs: true },
    { reportAllChanges: false, reportSoftNavs: true },
    { reportAllChanges: false, reportSoftNavs: true },
  ]);
  await client.close();
});

void test("registers observers once, ignores invalid values, and stops reporting after close", async () => {
  const runtime = new ControlledWebVitals();
  const firstEvents: CapturedEvent[] = [];
  const first = createClient(runtime, firstEvents);
  const secondEvents: CapturedEvent[] = [];
  const second = createClient(runtime, secondEvents);
  assert.equal(runtime.callbacks.CLS.length, 1);
  assert.equal(runtime.callbacks.INP.length, 1);
  assert.equal(runtime.callbacks.LCP.length, 1);
  assert.equal(runtime.callbacks.FCP.length, 1);
  assert.equal(runtime.callbacks.TTFB.length, 1);

  runtime.emit("CLS", Number.NaN);
  runtime.emit("FCP", Number.POSITIVE_INFINITY);
  runtime.emit("TTFB", -1);
  assert.equal(firstEvents.length, 0);
  assert.equal(secondEvents.length, 0);
  runtime.emit("CLS", 0.04);
  assert.equal(firstEvents.length, 1);
  assert.equal(secondEvents.length, 1);

  await first.close();
  runtime.emit("CLS", 0.05);
  assert.equal(firstEvents.length, 1);
  assert.equal(secondEvents.length, 2);
  await second.close();
  runtime.emit("FCP", 1000);
  runtime.emit("TTFB", 200);
  assert.equal(firstEvents.length, 1);
  assert.equal(secondEvents.length, 2);
});
