import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

void test("frontend and SDK budgets remain explicit production limits", () => {
  const consoleBudget = JSON.parse(readFileSync("apps/web/performance-budget.json", "utf8"));
  const sdkBudget = JSON.parse(readFileSync("packages/browser-sdk/size-limit.json", "utf8"));
  assert.equal(consoleBudget.maxInitialJavaScriptGzipBytes, 250 * 1024);
  assert.equal(sdkBudget.maxBytes, 30 * 1024);
});
