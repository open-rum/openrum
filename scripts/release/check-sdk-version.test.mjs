import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const script = join(root, "scripts/release/check-sdk-version.mjs");
const real = JSON.parse(readFileSync(join(root, "packages/browser-sdk/package.json"), "utf8"));

function manifest(fields) {
  const path = join(mkdtempSync(join(tmpdir(), "openrum-sdk-")), "package.json");
  writeFileSync(path, JSON.stringify({ name: "@openrum/browser", version: "1.2.3", ...fields }));
  return path;
}

function check(tag, environment = {}) {
  const output = join(mkdtempSync(join(tmpdir(), "openrum-output-")), "github-output");
  writeFileSync(output, "");
  const result = spawnSync(process.execPath, [script], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, RELEASE_TAG: tag, GITHUB_OUTPUT: output, ...environment },
  });
  return { ...result, output: readFileSync(output, "utf8") };
}

test("accepts the tag that matches the real package and publishes it as latest", () => {
  const result = check(`browser-v${real.version}`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.output, /npm_tag=latest/);
});

test("publishes a prerelease under next so it is never the default install", () => {
  const result = check("browser-v1.2.3-alpha.1", {
    SDK_MANIFEST: manifest({ version: "1.2.3-alpha.1" }),
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.output, /version=1\.2\.3-alpha\.1/);
  assert.match(result.output, /npm_tag=next/);
});

test("rejects a tag that differs from the package version", () => {
  const result = check("browser-v9.9.9", { SDK_MANIFEST: manifest({}) });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /is 1\.2\.3; expected 9\.9\.9/);
});

test("rejects product tags, moving tags and a private package", () => {
  for (const tag of ["v0.1.1", "latest", "browser-v1.2"]) {
    const result = check(tag, { SDK_MANIFEST: manifest({}) });
    assert.notEqual(result.status, 0, tag);
    assert.match(result.stderr, /RELEASE_TAG must look like browser-v/);
  }
  const result = check("browser-v1.2.3", { SDK_MANIFEST: manifest({ private: true }) });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /is private/);
});
