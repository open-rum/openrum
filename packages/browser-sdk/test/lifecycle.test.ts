import assert from "node:assert/strict";
import { test } from "node:test";
import type { CapturedEvent, EventSink, Integration } from "../src/client.ts";
import { OpenRUMClient } from "../src/client.ts";
import { close, getClient, init } from "../src/index.ts";
import { SessionManager, type StorageLike } from "../src/session.ts";

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function deterministicUUIDs(): () => string {
  let counter = 1;
  return () => `00000000-0000-4000-8000-${String(counter++).padStart(12, "0")}`;
}

void test("session and anonymous identifiers persist safely and renew after inactivity", () => {
  const sessionStorage = new MemoryStorage();
  const localStorage = new MemoryStorage();
  const diagnostics = {
    internalErrors: 0,
    droppedEvents: 0,
    droppedAttributes: 0,
    droppedBreadcrumbs: 0,
    filteredEvents: 0,
  };
  const randomUUID = deterministicUUIDs();
  let now = 1_000;
  const manager = new SessionManager(diagnostics, {
    sessionStorage,
    localStorage,
    randomUUID,
    now: () => now,
    sessionTimeoutMs: 100,
  });

  const first = manager.snapshot();
  now = 1_099;
  const active = manager.snapshot();
  assert.equal(active.sessionId, first.sessionId);
  assert.equal(active.pageId, first.pageId);
  assert.equal(active.anonymousUserId, first.anonymousUserId);

  now = 1_199;
  const renewed = manager.snapshot();
  assert.notEqual(renewed.sessionId, first.sessionId);
  assert.equal(renewed.anonymousUserId, first.anonymousUserId);
  assert.notEqual(manager.startPage(), first.pageId);
});

void test("context strips URL details and capture supplies immutable event identity", () => {
  const captured: CapturedEvent[] = [];
  const sink: EventSink = { add: (value) => captured.push(value) };
  const client = new OpenRUMClient(
    {
      writeKey: "orr_pk_test",
      endpoint: "https://rum.example.test/ingest/v1/envelope",
      environment: "production",
      release: "2026.09.02",
    },
    {
      sink,
      randomUUID: deterministicUUIDs(),
      nowISO: () => "2026-09-02T10:00:00.000Z",
      sessionStorage: new MemoryStorage(),
      localStorage: new MemoryStorage(),
      pageReader: () => ({
        url: "https://shop.example.test/checkout?token=secret#payment",
        route: "/checkout",
        title: "Checkout",
        referrer: "https://search.example.test/?q=private",
      }),
    },
  );
  client.setUser("user-42");
  client.setTag("channel", "organic");
  client.capture({ type: "custom", name: "checkout_submit" });

  assert.equal(captured.length, 1);
  assert.equal(captured[0]?.context.page.url, "https://shop.example.test/checkout");
  assert.equal(captured[0]?.context.page.referrer, "https://search.example.test/");
  assert.equal(captured[0]?.context.user_id, "user-42");
  assert.deepEqual(captured[0]?.context.tags, { channel: "organic" });
  assert.equal(captured[0]?.event.timestamp, "2026-09-02T10:00:00.000Z");
  assert.match(captured[0]?.event.event_id ?? "", /^[0-9a-f-]{36}$/);

  const firstPageID = captured[0]?.context.page_id;
  client.startPage({ url: "https://shop.example.test/receipt?order=private#done" });
  const nextContext = client.getContext();
  assert.notEqual(nextContext.page_id, firstPageID);
  assert.equal(nextContext.page.url, "https://shop.example.test/receipt");
});

void test("init is idempotent, close tears down once, and a later init creates a new client", async () => {
  await close();
  let setups = 0;
  let teardowns = 0;
  const integration: Integration = {
    name: "test",
    setup: () => {
      setups += 1;
      return () => {
        teardowns += 1;
      };
    },
  };
  const first = init({ writeKey: "one", endpoint: "/ingest", integrations: [integration] });
  const duplicate = init({ writeKey: "two", endpoint: "/other", integrations: [integration] });
  assert.equal(duplicate, first);
  assert.equal(getClient(), first);
  assert.equal(setups, 1);

  await close();
  await close();
  assert.equal(teardowns, 1);
  assert.equal(getClient(), undefined);

  const next = init({ writeKey: "three", endpoint: "/ingest", integrations: [integration] });
  assert.notEqual(next, first);
  assert.equal(setups, 2);
  await close();
});

void test("storage, integrations, sinks, and teardown failures never escape to the host", async () => {
  const brokenStorage: StorageLike = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  const client = new OpenRUMClient(
    {
      writeKey: "key",
      endpoint: "/ingest",
      integrations: [
        {
          name: "broken setup",
          setup: () => {
            throw new Error("setup");
          },
        },
        {
          name: "broken teardown",
          setup: () => () => {
            throw new Error("teardown");
          },
        },
      ],
    },
    {
      sessionStorage: brokenStorage,
      localStorage: brokenStorage,
      pageReader: () => {
        throw new Error("location blocked");
      },
      sink: {
        add: () => {
          throw new Error("sink");
        },
      },
      randomUUID: deterministicUUIDs(),
    },
  );

  assert.doesNotThrow(() => client.capture({ type: "custom", name: "safe" }));
  await assert.doesNotReject(client.close());
  assert.ok(client.diagnostics().internalErrors >= 7);
});
