import assert from "node:assert/strict";
import { test } from "node:test";
import type { CapturedEvent, EventSink } from "../src/client.ts";
import { OpenRUMClient } from "../src/client.ts";

function harness() {
  const captured: CapturedEvent[] = [];
  const sink: EventSink = { add: (event) => captured.push(event) };
  let nextID = 1;
  const client = new OpenRUMClient(
    { writeKey: "test", endpoint: "/ingest" },
    {
      sink,
      randomUUID: () => `00000000-0000-4000-8000-${String(nextID++).padStart(12, "0")}`,
      nowISO: () => "2026-09-02T10:00:00.000Z",
      pageReader: () => ({ url: "https://example.test/" }),
    },
  );
  return { client, captured };
}

void test("captures bounded custom attributes and measurements with client-side scrubbing", () => {
  const { client, captured } = harness();
  const attributes: Record<string, unknown> = {
    member_level: "gold",
    contact: "person@example.test",
    authorization: "Bearer private-token",
    event_id: "reserved",
    too_long: "x".repeat(513),
    invalid: { nested: true },
  };
  for (let index = 0; index < 25; index += 1) attributes[`item_${index}`] = String(index);
  client.captureEvent("checkout_submit", {
    attributes,
    measurements: { cart_value: 499.5, invalid: Number.NaN, event_id: 10 },
  });

  assert.equal(captured.length, 1);
  const event = captured[0]?.event;
  assert.equal(event?.type, "custom");
  if (event?.type !== "custom") assert.fail("expected custom event");
  assert.equal(event.attributes?.member_level, "gold");
  assert.equal(event.attributes?.contact, "[REDACTED_EMAIL]");
  assert.equal(Object.keys(event.attributes ?? {}).length, 20);
  assert.equal(event.measurements?.cart_value, 499.5);
  assert.equal(event.measurements?.invalid, undefined);
  assert.doesNotMatch(JSON.stringify(event), /private-token|reserved|nested/);
  assert.ok(client.diagnostics().droppedAttributes >= 11);
});

void test("drops invalid event names and protects pseudonymous user and tag context", () => {
  const { client, captured } = harness();
  client.captureEvent("x".repeat(81));
  client.captureEvent("openrum.internal");
  assert.equal(captured.length, 0);
  assert.equal(client.diagnostics().droppedEvents, 2);

  client.setUser("person@example.test");
  assert.equal(client.getContext().user_id, undefined);
  client.setUser("customer_42");
  client.setTag("access_token", "private");
  client.setTag("channel", "organic");
  assert.equal(client.getContext().user_id, "customer_42");
  assert.deepEqual(client.getContext().tags, { channel: "organic" });
});

void test("keeps the latest 50 scrubbed breadcrumbs and attaches them to errors", () => {
  const { client, captured } = harness();
  client.addBreadcrumb({ category: "invalid", message: "x".repeat(513) });
  for (let index = 0; index < 51; index += 1) {
    client.addBreadcrumb({
      category: "ui.click",
      message: `click ${index} by person@example.test`,
      data: { target: `button-${index}`, password: "private" },
    });
  }
  client.capture({
    type: "error",
    error: { name: "TypeError", message: "failed", handled: false },
  });

  const event = captured[0]?.event;
  assert.equal(event?.type, "error");
  if (event?.type !== "error") assert.fail("expected error event");
  assert.equal(event.breadcrumbs?.length, 50);
  assert.match(event.breadcrumbs?.[0]?.message ?? "", /^click 1 /);
  assert.match(event.breadcrumbs?.[0]?.message ?? "", /REDACTED_EMAIL/);
  assert.equal(event.breadcrumbs?.[0]?.data?.password, undefined);
  assert.equal(client.diagnostics().droppedBreadcrumbs, 1);
  assert.ok(client.diagnostics().droppedAttributes >= 51);
});
