import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createLoadEvents } from "./events.mjs";

const require = createRequire(new URL("../../packages/protocol/package.json", import.meta.url));
const Ajv = require("ajv");
const ajv = new Ajv({ allErrors: true, strict: true });
require("ajv-formats")(ajv);
const validate = ajv.compile(
  JSON.parse(
    readFileSync(
      new URL("../../packages/protocol/schema/envelope-v1.json", import.meta.url),
      "utf8",
    ),
  ),
);
for (const workload of ["custom", "mixed"]) {
  test(`${workload} benchmark conforms to the real event protocol`, () => {
    const now = new Date().toISOString();
    const events = createLoadEvents(100, now, "protocol-test", randomUUID, workload);
    const envelope = {
      schema_version: "1.0",
      sent_at: now,
      sdk: { name: "openrum-k6", version: "1.0.0" },
      context: {
        environment: "production",
        session_id: randomUUID(),
        page_id: randomUUID(),
        anonymous_user_id: "test-visitor",
        page: { url: "https://load.example.com/run/protocol-test", route: "/benchmark" },
        tags: { load_run_id: "protocol-test" },
      },
      events,
    };
    assert.equal(validate(envelope), true, JSON.stringify(validate.errors));
    assert.equal(new Set(events.map((e) => e.event_id)).size, 100);
    if (workload === "mixed")
      assert.deepEqual(
        events.reduce((counts, e) => ({ ...counts, [e.type]: (counts[e.type] || 0) + 1 }), {}),
        { custom: 40, page_view: 20, api: 20, web_vital: 10, error: 10 },
      );
  });
}
