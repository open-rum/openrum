import assert from "node:assert/strict";
import { test } from "node:test";
import type { CapturedEvent, EventSink } from "../src/client.ts";
import { OpenRUMClient } from "../src/client.ts";
import {
  behaviorIntegration,
  describeTarget,
  type BehaviorElement,
  type BehaviorRuntime,
} from "../src/integrations/behavior.ts";

class FakeRuntime implements BehaviorRuntime {
  listener?: EventListener;

  addEventListener(_type: "click", listener: EventListener): void {
    this.listener = listener;
  }

  removeEventListener(_type: "click", listener: EventListener): void {
    if (this.listener === listener) this.listener = undefined;
  }

  click(target: BehaviorElement): void {
    this.listener?.({ target } as unknown as Event);
  }
}

function element(attributes: Record<string, string>, tagName = "BUTTON"): BehaviorElement {
  const target: BehaviorElement = {
    tagName,
    getAttribute: (name) => attributes[name] ?? null,
  };
  target.closest = () => target;
  return target;
}

function harness(runtime: FakeRuntime, maxClicksPerMinute = 60) {
  const captured: CapturedEvent[] = [];
  const sink: EventSink = { add: (event) => captured.push(event) };
  let now = 1_000;
  const client = new OpenRUMClient(
    {
      writeKey: "test",
      endpoint: "/ingest",
      integrations: [behaviorIntegration(runtime, { maxClicksPerMinute, now: () => now })],
    },
    {
      sink,
      pageReader: () => ({ url: "https://example.test/checkout" }),
    },
  );
  return { client, captured, advance: (milliseconds: number) => (now += milliseconds) };
}

void test("captures only a bounded, explicit description of an interactive target", () => {
  const runtime = new FakeRuntime();
  const { captured } = harness(runtime);
  runtime.click(
    element({
      "data-openrum-name": "checkout.submit",
      "aria-label": "Pay for person@example.test",
      class: "customer-42 card-number-4242",
      href: "/receipt?token=private",
      value: "secret input value",
      role: "button",
    }),
  );

  assert.equal(captured.length, 1);
  const event = captured[0]?.event;
  assert.equal(event?.type, "custom");
  if (event?.type !== "custom") assert.fail("expected custom event");
  assert.equal(event.name, "ui.click");
  assert.deepEqual(event.attributes, {
    element: "button",
    role: "button",
    name: "checkout.submit",
  });
  assert.doesNotMatch(JSON.stringify(event), /person@|customer-42|4242|token|secret input/);
});

void test("does not collect text input values and enforces a per-minute event budget", () => {
  const runtime = new FakeRuntime();
  const { captured, advance } = harness(runtime, 2);
  runtime.click(element({ type: "text", value: "private" }, "INPUT"));
  runtime.click(element({ "data-openrum-name": "second" }));
  runtime.click(element({ "data-openrum-name": "over-budget" }));
  assert.equal(captured.length, 2);
  assert.deepEqual(
    captured.map((item) =>
      item.event.type === "custom" ? item.event.attributes?.name : undefined,
    ),
    [undefined, "second"],
  );
  assert.equal(
    captured[0]?.event.type === "custom" && captured[0].event.attributes?.input_type,
    undefined,
  );

  advance(60_000);
  runtime.click(element({ "data-openrum-name": "new-window" }));
  assert.equal(captured.length, 3);
});

void test("ignores non-interactive targets without an explicit safe name", () => {
  assert.equal(describeTarget(element({ value: "private" }, "DIV")), undefined);
});
