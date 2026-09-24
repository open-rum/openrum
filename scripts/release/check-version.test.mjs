import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const script = join(root, "scripts/release/check-version.mjs");
const chart = readFileSync(join(root, "deploy/helm/openrum/Chart.yaml"), "utf8");
const version = chart.match(/^version:\s*(\S+)/m)?.[1];
assert.ok(version, "Chart.yaml must declare a version");

function check(tag) {
  return spawnSync(process.execPath, [script], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, RELEASE_TAG: tag, GITHUB_OUTPUT: "" },
  });
}

test("accepts a tag matching the Chart and image", () => {
  const result = check(`v${version}`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Release metadata is aligned/);
});

test("rejects a tag that does not match the Chart", () => {
  const result = check("v999.0.0");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Chart\.version is .*expected 999\.0\.0/);
});

test("rejects moving release tags", () => {
  const result = check("latest");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /RELEASE_TAG must be a semantic version/);
});
