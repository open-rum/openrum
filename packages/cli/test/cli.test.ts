import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { OpenRUMSourceMapOptions } from "@openrum/source-map";
import type { Context } from "../src/context.ts";
import { findRepositoryRoot } from "../src/devstack.ts";
import { main } from "../src/main.ts";
import pkg from "../package.json" with { type: "json" };

function harness(overrides: Partial<Context> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const uploads: OpenRUMSourceMapOptions[] = [];
  const forwards: { root: string; args: string[] }[] = [];
  const context: Context = {
    env: {},
    cwd: tmpdir(),
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    upload: async (options) => {
      uploads.push(options);
      return {} as never;
    },
    forward: async (root, args) => {
      forwards.push({ root, args });
      return 0;
    },
    ...overrides,
  };
  return { context, out, err, uploads, forwards };
}

function fakeRepository(): string {
  const root = mkdtempSync(join(tmpdir(), "openrum-repo-"));
  mkdirSync(join(root, "deploy", "compose"), { recursive: true });
  writeFileSync(join(root, "deploy", "compose", "docker-compose.yml"), "services: {}\n");
  mkdirSync(join(root, "apps", "web"), { recursive: true });
  return root;
}

test("prints usage for help and exits 2 with no command", async () => {
  const help = harness();
  assert.equal(await main(["help"], help.context), 0);
  assert.match(help.out.join(""), /Usage: openrum <command>/);
  assert.match(help.out.join(""), /sourcemaps upload/);
  const bare = harness();
  assert.equal(await main([], bare.context), 2);
});

test("prints the package version", async () => {
  const run = harness();
  assert.equal(await main(["--version"], run.context), 0);
  assert.equal(run.out.join("").trim(), pkg.version);
});

test("rejects unknown commands without running anything", async () => {
  const run = harness();
  assert.equal(await main(["frobnicate"], run.context), 2);
  assert.match(run.err.join(""), /unknown command "frobnicate"/);
  assert.equal(run.uploads.length + run.forwards.length, 0);
});

test("sourcemaps upload reads flags first and the environment second", async () => {
  const run = harness({
    env: {
      OPENRUM_BASE_URL: "https://env.example",
      OPENRUM_PROJECT_ID: "env-project",
      OPENRUM_RELEASE: "env-release",
      OPENRUM_UPLOAD_TOKEN: "orut_env",
      OPENRUM_REPLACE: "true",
    },
  });
  const code = await main(
    [
      "sourcemaps",
      "upload",
      "--release",
      "flag-release",
      "--out-dir=build",
      "--url-prefix",
      "static/app/",
    ],
    run.context,
  );
  assert.equal(code, 0);
  assert.equal(run.uploads.length, 1);
  assert.deepEqual(
    {
      baseUrl: run.uploads[0]?.baseUrl,
      projectId: run.uploads[0]?.projectId,
      release: run.uploads[0]?.release,
      outDir: run.uploads[0]?.outDir,
      urlPrefix: run.uploads[0]?.urlPrefix,
      token: run.uploads[0]?.token,
      replace: run.uploads[0]?.replace,
    },
    {
      baseUrl: "https://env.example",
      projectId: "env-project",
      release: "flag-release",
      outDir: "build",
      urlPrefix: "static/app/",
      token: "orut_env",
      replace: true,
    },
  );
});

test("sourcemaps upload reports a failure on stderr and exits 1", async () => {
  const run = harness({
    upload: async () => {
      throw new Error("The release is required.");
    },
  });
  assert.equal(await main(["sourcemaps", "upload"], run.context), 1);
  assert.equal(run.err.join(""), "The release is required.\n");
});

test("sourcemaps help lists every option and exits 0", async () => {
  const run = harness();
  assert.equal(await main(["sourcemaps", "upload", "--help"], run.context), 0);
  const text = run.out.join("");
  for (const flag of [
    "--base-url",
    "--project-id",
    "--release",
    "--url-prefix",
    "--replace",
    "--token",
  ])
    assert.ok(text.includes(flag), flag);
  assert.equal(run.uploads.length, 0);
  const typo = harness();
  assert.equal(await main(["sourcemaps", "push"], typo.context), 2);
});

test("local stack commands run from inside a repository checkout", async () => {
  const root = fakeRepository();
  const run = harness({ cwd: join(root, "apps", "web") });
  assert.equal(await main(["seed", "--yes"], run.context), 0);
  assert.deepEqual(run.forwards, [{ root, args: ["seed", "--yes"] }]);
});

test("local stack commands explain themselves outside a checkout", async () => {
  const outside = mkdtempSync(join(tmpdir(), "openrum-outside-"));
  assert.equal(findRepositoryRoot(outside), undefined);
  const run = harness({ cwd: outside });
  assert.equal(await main(["dev"], run.context), 1);
  assert.match(run.err.join(""), /only works inside a checkout/);
  assert.equal(run.forwards.length, 0);
});

test("a forwarded command's exit code is the CLI's exit code", async () => {
  const root = fakeRepository();
  const run = harness({ cwd: root, forward: async () => 3 });
  assert.equal(await main(["status"], run.context), 3);
});
