import assert from "node:assert/strict";
import { test } from "node:test";
import { OpenRUMClient, type CapturedEvent, type ClientOptions } from "../src/client.ts";
import { consoleLoggingIntegration } from "../src/integrations/console.ts";
import { logLevels } from "../src/logs.ts";

function harness(options: Partial<ClientOptions> = {}) {
  const captured: CapturedEvent[] = [];
  const client = new OpenRUMClient(
    { dsn: "https://test@rum.example.test/ingest", ...options },
    {
      sink: { add: (item) => captured.push(item) },
      pageReader: () => ({ url: "https://shop.example.test/checkout", route: "/checkout" }),
    },
  );
  return { client, captured };
}

void test("explicit logger calls need no feature flag and support all six levels", async () => {
  const compatible = harness({ enableLogs: false });
  assert.equal(compatible.captured.length, 0);
  compatible.client.logger.error("explicit log despite legacy flag");
  compatible.client.capture({ type: "log", level: "error", message: "explicit capture" });
  assert.equal(compatible.captured.length, 2);
  await compatible.client.close();
  const { client, captured } = harness();
  for (const level of logLevels) client.logger[level]("checkout", { quantity: 2, cached: false });
  assert.deepEqual(
    captured.map((item) => item.event.type),
    Array(6).fill("log"),
  );
  assert.ok(captured.every((item) => item.priority === "low"));
  assert.equal(captured[0]?.context.page.route, "/checkout");
  if (captured[0]?.event.type === "log")
    assert.deepEqual(captured[0].event.attributes, { quantity: "2", cached: "false" });
  await client.close();
  client.logger.info("closed");
  assert.equal(captured.length, 6);
});

void test("captureConsole is its own opt-in and needs no enableLogs flag", async () => {
  const calls: unknown[][] = [];
  const original = globalThis.console;
  const target = {
    ...original,
    warn: (...args: unknown[]) => calls.push(args),
  } as Console;
  globalThis.console = target;
  try {
    const { client, captured } = harness({ captureConsole: ["warn"], enableLogs: false });
    target.warn("captured warning", 503);
    assert.deepEqual(calls, [["captured warning", 503]]);
    assert.equal(captured.length, 1);
    assert.equal(captured[0]?.event.type, "log");
    if (captured[0]?.event.type === "log") {
      assert.equal(captured[0].event.level, "warn");
      assert.equal(captured[0].event.message, "captured warning 503");
    }
    await client.close();
    target.warn("local only");
    assert.equal(captured.length, 1);
  } finally {
    globalThis.console = original;
  }
});

void test("logs snapshot setUser identity at capture time, including switches and logout", async () => {
  const { client, captured } = harness();
  client.logger.info("before login");
  client.setUser("customer-123");
  client.logger.info("signed in");
  client.setUser("customer-456");
  client.logger.info("switched account");
  client.setUser(undefined);
  client.logger.info("signed out");
  assert.deepEqual(
    captured.map((item) => item.context.user_id),
    [undefined, "customer-123", "customer-456", undefined],
  );
  const anonymousId = captured[0]?.context.anonymous_user_id;
  assert.ok(anonymousId);
  assert.ok(captured.every((item) => item.context.anonymous_user_id === anonymousId));
  await client.close();
});

void test("log privacy scrub bounds strings, strips sensitive keys and never invokes getters", () => {
  const { client, captured } = harness();
  const attributes = { password: "private", contact: "person@example.com", order: "123" };
  Object.defineProperty(attributes, "danger", {
    enumerable: true,
    get: () => {
      throw new Error("getter invoked");
    },
  });
  client.logger.warn("person@example.com Bearer secretvalue " + "x".repeat(6000), attributes);
  const event = captured[0]?.event;
  assert.equal(event?.type, "log");
  if (event?.type !== "log") assert.fail("missing log");
  assert.ok(event.message.length <= 4096);
  assert.doesNotMatch(JSON.stringify(event), /person@example.com|secretvalue|private|danger/);
  assert.equal(event.attributes?.order, "123");
  assert.equal(client.diagnostics().internalErrors, 0);
});

void test("beforeSendLog can drop or transform logs and cannot bypass the privacy floor", () => {
  const { client, captured } = harness({
    beforeSendLog: (log) =>
      log.level === "debug" ? null : { ...log, message: "person@example.com" },
  });
  client.logger.debug("drop");
  client.logger.error("keep");
  assert.equal(captured.length, 1);
  assert.doesNotMatch(JSON.stringify(captured), /person@example.com/);
  assert.doesNotThrow(() =>
    harness({
      beforeSendLog: () => {
        throw new Error("hook failure");
      },
    }).client.logger.info("safe"),
  );
  const sampled = harness({ eventSampleRate: 0 });
  sampled.client.logger.fatal("sampled out");
  assert.equal(sampled.captured.length, 0);
});

void test("recursive logging inside beforeSendLog is suppressed", () => {
  const { client, captured } = harness({
    beforeSendLog: (log) => {
      client.logger.info("recursive");
      return log;
    },
  });
  client.logger.info("outer");
  assert.equal(captured.length, 1);
});

void test("console forwarding preserves arguments and restores shared instrumentation out of order", async () => {
  const originalCalls: unknown[][] = [];
  const original = (...args: unknown[]) => {
    originalCalls.push(args);
  };
  const target = {
    log: original,
    info: original,
    debug: original,
    warn: original,
    error: original,
  };
  const integration = consoleLoggingIntegration({ levels: ["warn", "error"], console: target });
  const first = harness({ integrations: [integration] });
  const second = harness({ integrations: [integration] });
  const object = {
    password: "not serialized",
    toJSON() {
      throw new Error("never called");
    },
  };
  target.warn("slow", object);
  assert.equal(originalCalls.length, 1);
  assert.equal(originalCalls[0]?.[1], object);
  assert.equal(first.captured.length, 1);
  assert.doesNotMatch(JSON.stringify(first.captured), /not serialized/);
  await first.client.close();
  target.warn("still open");
  assert.equal(first.captured.length, 1);
  assert.equal(second.captured.length, 2);
  await second.client.close();
  assert.equal(target.warn, original);
  assert.equal(target.error, original);
});
