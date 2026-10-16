import assert from "node:assert/strict";
import test from "node:test";
import { startRemoteConfig, type ConfigRuntime, type RemoteSDKConfig } from "../src/config.ts";
import type { SamplingOptions } from "../src/sampling.ts";

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

void test("applies remote sampling, caps refresh at five minutes, and expires emergency override", async () => {
  let timestamp = Date.parse("2026-09-03T08:00:00Z");
  const config: RemoteSDKConfig = {
    version: 4,
    effectiveAt: "2026-09-03T07:59:00Z",
    expiresAt: "2026-09-03T09:00:00Z",
    refreshAfterSeconds: 900,
    eventSampleRate: 0.8,
    apiSampleRate: 0.4,
    errorSampleRate: 1,
    emergency: true,
    emergencySampleRate: 0.1,
    emergencyExpiresAt: "2026-09-03T08:00:30Z",
  };
  const updates: Partial<SamplingOptions>[] = [];
  const timers: Array<{ callback: () => void; delay: number }> = [];
  const runtime: ConfigRuntime = {
    fetch: async (_input, init) => {
      assert.equal((init?.headers as Record<string, string>)["X-OpenRUM-Key"], "orr_pk_test");
      return new Response(JSON.stringify(config), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
    location: { href: "https://shop.example.test/checkout" },
    localStorage: new MemoryStorage(),
    now: () => timestamp,
    setTimeout: ((callback: () => void, delay: number) => {
      timers.push({ callback, delay });
      return timers.length as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout,
    clearTimeout: (() => undefined) as typeof clearTimeout,
  };
  const stop = startRemoteConfig(
    {
      updateSampling: (sampling) => updates.push(sampling),
      updateFilters: () => undefined,
      updateCapture: () => undefined,
    },
    { endpoint: "https://rum.example.test/ingest/v1/envelope", writeKey: "orr_pk_test" },
    runtime,
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(updates.at(-1), {
    eventSampleRate: 0.1,
    apiSampleRate: 0.1,
    errorSampleRate: 0.1,
  });
  assert.equal(timers.at(-1)?.delay, 30_000);

  timestamp += 30_001;
  timers.at(-1)?.callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(updates.at(-1), {
    eventSampleRate: 0.8,
    apiSampleRate: 0.4,
    errorSampleRate: 1,
  });
  assert.ok((timers.at(-1)?.delay ?? Infinity) <= 300_000);
  stop();
});

void test("keeps local sampling when remote payload is invalid", async () => {
  const updates: Partial<SamplingOptions>[] = [];
  startRemoteConfig(
    {
      updateSampling: (sampling) => updates.push(sampling),
      updateFilters: () => undefined,
      updateCapture: () => undefined,
    },
    { endpoint: "https://rum.example.test/ingest/v1/envelope", writeKey: "orr_pk_test" },
    {
      fetch: async () =>
        new Response(JSON.stringify({ version: 1, eventSampleRate: 2 }), { status: 200 }),
      now: () => Date.parse("2026-09-03T08:00:00Z"),
      setTimeout: (() => 1) as unknown as typeof setTimeout,
      clearTimeout: (() => undefined) as typeof clearTimeout,
    },
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(updates, []);
});

function remoteConfig(extra: Record<string, unknown> = {}) {
  return {
    version: 2,
    effectiveAt: "2026-10-13T07:59:00Z",
    expiresAt: "2026-10-13T09:00:00Z",
    refreshAfterSeconds: 300,
    eventSampleRate: 1,
    apiSampleRate: 1,
    errorSampleRate: 1,
    emergency: false,
    ...extra,
  };
}

async function appliedCapture(payload: Record<string, unknown>) {
  const applied: unknown[] = [];
  startRemoteConfig(
    {
      updateSampling: () => undefined,
      updateFilters: () => undefined,
      updateCapture: (settings) => applied.push(settings),
    },
    { endpoint: "https://rum.example.test/ingest/v1/envelope", writeKey: "orr_pk_test" },
    {
      fetch: async () => new Response(JSON.stringify(payload), { status: 200 }),
      now: () => Date.parse("2026-10-13T08:00:00Z"),
      setTimeout: (() => 1) as unknown as typeof setTimeout,
      clearTimeout: (() => undefined) as typeof clearTimeout,
    },
  );
  await new Promise((resolve) => setImmediate(resolve));
  return applied;
}

void test("hands the project's API capture rules to the client", async () => {
  const rules = [
    {
      id: "orders",
      method: "get",
      pattern: "https://api.example.com/orders/*",
      requestHeaders: ["x-request-id"],
      responseHeaders: ["etag"],
    },
  ];
  const applied = await appliedCapture(remoteConfig({ apiCapture: { rules } }));
  assert.deepEqual(applied.at(-1), {
    rules: [
      {
        id: "orders",
        method: "GET",
        pattern: "https://api.example.com/orders/*",
        requestHeaders: ["x-request-id"],
        responseHeaders: ["etag"],
        requestBody: false,
        responseBody: false,
      },
    ],
  });
});

void test("a server without the feature, or an empty project, captures nothing", async () => {
  assert.deepEqual((await appliedCapture(remoteConfig())).at(-1), {});
  assert.deepEqual((await appliedCapture(remoteConfig({ apiCapture: {} }))).at(-1), {});
});

void test("an unreadable capture document switches capture off instead of rejecting the config", async () => {
  const applied = await appliedCapture(
    remoteConfig({
      apiCapture: { rules: [{ id: "r", method: "GET", pattern: "x", requestHeaders: ["cookie"] }] },
    }),
  );
  // The sampling half is still applied, and the rules are empty, not stale.
  assert.deepEqual(applied.at(-1), {});
});
