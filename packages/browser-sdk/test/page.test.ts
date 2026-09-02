import assert from "node:assert/strict";
import { test } from "node:test";
import type { CapturedEvent, EventSink } from "../src/client.ts";
import { OpenRUMClient } from "../src/client.ts";
import { pageIntegration, type PageRuntime } from "../src/integrations/page.ts";

class FakePageRuntime implements PageRuntime {
  readonly listeners = new Map<string, Set<EventListener>>();
  readonly location = { href: "https://example.test/start" };
  readonly performance = { getEntriesByType: () => [{ type: "reload" }] };
  readonly originalPushState = (_data: unknown, _unused: string, url?: string | URL | null) => {
    if (url) this.location.href = new URL(String(url), this.location.href).toString();
    return "push-result";
  };
  readonly originalReplaceState = (_data: unknown, _unused: string, url?: string | URL | null) => {
    if (url) this.location.href = new URL(String(url), this.location.href).toString();
    return "replace-result";
  };
  readonly history = {
    pushState: this.originalPushState,
    replaceState: this.originalReplaceState,
  };

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string, event = new Event(type)): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

void test("captures initial and client-side page views and restores history", async () => {
  const runtime = new FakePageRuntime();
  const captured: CapturedEvent[] = [];
  const sink: EventSink = { add: (value) => captured.push(value) };
  let nextID = 1;
  const client = new OpenRUMClient(
    { writeKey: "test", endpoint: "/ingest", integrations: [pageIntegration(runtime)] },
    {
      sink,
      randomUUID: () => `00000000-0000-4000-8000-${String(nextID++).padStart(12, "0")}`,
      pageReader: () => ({
        url: runtime.location.href,
        route: new URL(runtime.location.href).pathname,
      }),
    },
  );

  assert.equal(captured[0]?.event.type, "page_view");
  if (captured[0]?.event.type !== "page_view") assert.fail("expected page view");
  assert.equal(captured[0].event.navigation_type, "reload");
  const initialPageID = captured[0].context.page_id;

  const pushResult = runtime.history.pushState({}, "", "/checkout?secret=1");
  assert.equal(pushResult, "push-result");
  assert.equal(captured[1]?.event.type, "page_view");
  if (captured[1]?.event.type !== "page_view") assert.fail("expected route page view");
  assert.equal(captured[1].event.navigation_type, "route_change");
  assert.equal(captured[1].context.page.url, "https://example.test/checkout");
  assert.notEqual(captured[1].context.page_id, initialPageID);

  runtime.dispatch("popstate");
  assert.equal(captured.length, 3);
  await client.close();
  assert.equal(runtime.history.pushState, runtime.originalPushState);
  assert.equal(runtime.history.replaceState, runtime.originalReplaceState);
  runtime.dispatch("popstate");
  assert.equal(captured.length, 3);
});
