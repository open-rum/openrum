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
    { updateSampling: (sampling) => updates.push(sampling) },
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
    { updateSampling: (sampling) => updates.push(sampling) },
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
