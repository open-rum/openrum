import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { incrementSemver, isValidSemver, resolveVersion } from "./targets.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const statusScript = join(root, "scripts/release/status.mjs");
const bumpScript = join(root, "scripts/release/bump.mjs");

function writeFixtureFile(baseDir, relPath, content) {
  const fullPath = join(baseDir, relPath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, "utf8");
}

function createRepoFixture(version = "0.1.3") {
  const dir = mkdtempSync(join(tmpdir(), "openrum-release-fixture-"));

  writeFixtureFile(
    dir,
    "deploy/helm/openrum/Chart.yaml",
    `apiVersion: v2\nname: openrum\nversion: ${version}\nappVersion: "${version}"\n`,
  );
  writeFixtureFile(
    dir,
    "deploy/helm/openrum/values.yaml",
    `image:\n  repository: ghcr.io/open-rum/openrum\n  tag: "${version}"\n`,
  );
  writeFixtureFile(
    dir,
    "packages/browser-sdk/package.json",
    JSON.stringify({ name: "@openrum/browser", version }, null, 2) + "\n",
  );
  writeFixtureFile(
    dir,
    "packages/browser-sdk/src/transport/sender.ts",
    `const SDK_VERSION = "${version}";\n`,
  );
  writeFixtureFile(
    dir,
    "packages/protocol/src/dsn.ts",
    `export const OPENRUM_BROWSER_SDK_VERSION = "${version}";\n`,
  );
  writeFixtureFile(
    dir,
    "services/api/internal/handlers/browser_sdk.go",
    [
      "package handlers",
      "const (",
      `\tBrowserSDKVersion          = "${version}"`,
      `\tBrowserSDKPublicPath       = "/sdk/browser/${version}/openrum.min.js"`,
      `\tBrowserSDKLegacyPublicPath = "/api/v1/sdk/browser/${version}/openrum.min.js"`,
      ")",
      "",
    ].join("\n"),
  );
  writeFixtureFile(
    dir,
    "apps/web/src/features/onboarding/onboarding.test.tsx",
    `expect(html).toContain('src="https://rum.example.com/sdk/browser/${version}/openrum.min.js"');\n`,
  );
  writeFixtureFile(
    dir,
    "packages/sourcemap/package.json",
    JSON.stringify({ name: "@openrum/sourcemap", version }, null, 2) + "\n",
  );
  writeFixtureFile(
    dir,
    "packages/cli/package.json",
    JSON.stringify({ name: "@openrum/cli", version }, null, 2) + "\n",
  );

  for (const path of [
    "apps/site/src/content/docs/docs/getting-started/production-deployment/install.mdx",
    "apps/site/src/content/docs/zh/docs/getting-started/production-deployment/install.mdx",
    "apps/site/src/content/docs/docs/self-hosting/overview.mdx",
    "apps/site/src/content/docs/zh/docs/self-hosting/overview.mdx",
    "apps/site/src/content/docs/docs/self-hosting/kubernetes.md",
    "apps/site/src/content/docs/zh/docs/self-hosting/kubernetes.md",
    "apps/site/src/content/docs/docs/self-hosting/email.mdx",
    "apps/site/src/content/docs/zh/docs/self-hosting/email.mdx",
  ]) {
    writeFixtureFile(dir, path, `helm install --version ${version}\n`);
  }

  for (const path of [
    "README.md",
    "README.zh-CN.md",
    "packages/browser-sdk/README.md",
    "apps/site/src/content/docs/docs/sdk/browser/index.mdx",
    "apps/site/src/content/docs/zh/docs/sdk/browser/index.mdx",
    "apps/site/src/content/docs/docs/sdk/browser/react.mdx",
    "apps/site/src/content/docs/zh/docs/sdk/browser/react.mdx",
    "apps/site/src/content/docs/docs/sdk/browser/vue.mdx",
    "apps/site/src/content/docs/zh/docs/sdk/browser/vue.mdx",
    "apps/site/src/content/docs/docs/sdk/browser/nextjs.mdx",
    "apps/site/src/content/docs/zh/docs/sdk/browser/nextjs.mdx",
    "apps/site/src/content/docs/docs/sdk/browser/astro.mdx",
    "apps/site/src/content/docs/zh/docs/sdk/browser/astro.mdx",
    "apps/site/src/content/docs/docs/sdk/browser/tanstack-router.mdx",
    "apps/site/src/content/docs/zh/docs/sdk/browser/tanstack-router.mdx",
    "apps/site/src/content/docs/docs/reference/sdk-options.md",
    "apps/site/src/content/docs/zh/docs/reference/sdk-options.md",
    "apps/site/src/content/docs/docs/reference/http-api.md",
    "apps/site/src/content/docs/zh/docs/reference/http-api.md",
  ]) {
    writeFixtureFile(dir, path, `appliesTo: "@openrum/browser ${version}"\n`);
  }

  for (const path of [
    "apps/site/src/content/docs/docs/reference/cli.md",
    "apps/site/src/content/docs/zh/docs/reference/cli.md",
  ]) {
    writeFixtureFile(dir, path, `appliesTo: "@openrum/cli ${version}"\n`);
  }

  return dir;
}

function initGitRepo(dir, version = "0.1.3") {
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@example.com",
  };
  const git = (...args) => execFileSync("git", args, { cwd: dir, env, stdio: "pipe" });
  git("init");
  git("add", ".");
  git("commit", "-m", "chore: initial release");
  git("tag", "-a", `v${version}`, "-m", `OpenRUM v${version}`);
  git("tag", "-a", `browser-v${version}`, "-m", `@openrum/browser ${version}`);
  git("tag", "-a", `sourcemap-v${version}`, "-m", `@openrum/sourcemap ${version}`);
  git("tag", "-a", `cli-v${version}`, "-m", `@openrum/cli ${version}`);
  return git;
}

test("semver helpers validate and increment versions", () => {
  assert.equal(isValidSemver("0.1.4"), true);
  assert.equal(isValidSemver("0.2.0-alpha.1"), true);
  assert.equal(isValidSemver("v0.1.4"), false);
  assert.equal(incrementSemver("0.1.3", "patch"), "0.1.4");
  assert.equal(incrementSemver("0.1.3", "minor"), "0.2.0");
  assert.equal(incrementSemver("0.1.3", "major"), "1.0.0");
  assert.equal(resolveVersion("0.1.3", "patch"), "0.1.4");
  assert.equal(resolveVersion("0.1.3", "0.2.0-beta.1"), "0.2.0-beta.1");
  assert.throws(() => resolveVersion("0.1.3", "latest"), /Invalid version/);
});

test("release:status reports clean, changed and pending-tag targets", () => {
  const dir = createRepoFixture("0.1.3");
  const git = initGitRepo(dir, "0.1.3");

  // Clean state right after tagging
  let result = spawnSync(process.execPath, [statusScript, "--root", dir, "--json"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  let payload = JSON.parse(result.stdout);
  for (const item of payload.targets) {
    assert.equal(item.state, "clean");
    assert.equal(item.commitCount, 0);
  }

  // Modify only packages/cli -> only cli should report changes
  writeFixtureFile(dir, "packages/cli/src/openrum.ts", "export const cli = 1;\n");
  git("add", "packages/cli/src/openrum.ts");
  git("commit", "-m", "fix(cli): improve help text");

  result = spawnSync(process.execPath, [statusScript, "--root", dir, "--json"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  payload = JSON.parse(result.stdout);
  const byId = Object.fromEntries(payload.targets.map((item) => [item.id, item]));
  assert.equal(byId.cli.state, "changes");
  assert.equal(byId.cli.suggestedVersion, "0.1.4");
  assert.equal(byId.cli.commitCount, 1);
  assert.equal(byId.product.state, "clean");
  assert.equal(byId.browser.state, "clean");
  assert.equal(byId.sourcemap.state, "clean");

  // Bump cli manifest without tagging -> cli reports pending-tag
  writeFixtureFile(
    dir,
    "packages/cli/package.json",
    JSON.stringify({ name: "@openrum/cli", version: "0.1.4" }, null, 2) + "\n",
  );
  result = spawnSync(process.execPath, [statusScript, "--root", dir, "--json"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  payload = JSON.parse(result.stdout);
  assert.equal(payload.targets.find((item) => item.id === "cli")?.state, "pending-tag");
});

test("release:bump updates all selected target files and isolates untouched targets", () => {
  const dir = createRepoFixture("0.1.3");

  // Single-target bump: cli only
  const cliOnly = spawnSync(
    process.execPath,
    [bumpScript, "--root", dir, "--cli", "patch", "--no-generate", "--no-check"],
    { encoding: "utf8" },
  );
  assert.equal(cliOnly.status, 0, cliOnly.stderr);
  assert.equal(
    JSON.parse(readFileSync(join(dir, "packages/cli/package.json"), "utf8")).version,
    "0.1.4",
  );
  assert.match(
    readFileSync(join(dir, "apps/site/src/content/docs/zh/docs/reference/cli.md"), "utf8"),
    /@openrum\/cli 0\.1\.4/,
  );
  // Other targets remain untouched
  assert.equal(
    JSON.parse(readFileSync(join(dir, "packages/browser-sdk/package.json"), "utf8")).version,
    "0.1.3",
  );
  assert.match(
    readFileSync(join(dir, "deploy/helm/openrum/Chart.yaml"), "utf8"),
    /version: 0\.1\.3/,
  );

  // Bump all targets to 0.2.0
  const allBump = spawnSync(
    process.execPath,
    [bumpScript, "--root", dir, "--all", "0.2.0", "--no-generate", "--no-check"],
    { encoding: "utf8" },
  );
  assert.equal(allBump.status, 0, allBump.stderr);
  assert.match(
    readFileSync(join(dir, "deploy/helm/openrum/Chart.yaml"), "utf8"),
    /version: 0\.2\.0/,
  );
  assert.match(
    readFileSync(join(dir, "deploy/helm/openrum/Chart.yaml"), "utf8"),
    /appVersion: "0\.2\.0"/,
  );
  assert.match(
    readFileSync(join(dir, "deploy/helm/openrum/values.yaml"), "utf8"),
    /tag: "0\.2\.0"/,
  );
  assert.match(
    readFileSync(join(dir, "packages/browser-sdk/src/transport/sender.ts"), "utf8"),
    /SDK_VERSION = "0\.2\.0"/,
  );
  assert.match(
    readFileSync(join(dir, "packages/protocol/src/dsn.ts"), "utf8"),
    /OPENRUM_BROWSER_SDK_VERSION = "0\.2\.0"/,
  );
  assert.match(
    readFileSync(join(dir, "services/api/internal/handlers/browser_sdk.go"), "utf8"),
    /\/sdk\/browser\/0\.2\.0\/openrum\.min\.js/,
  );
  assert.equal(
    JSON.parse(readFileSync(join(dir, "packages/sourcemap/package.json"), "utf8")).version,
    "0.2.0",
  );
  assert.match(allBump.stdout, /git tag -a browser-v0\.2\.0/);
  assert.match(allBump.stdout, /git tag -a v0\.2\.0/);
});

test("release:bump dry-run works on the real repository without modifying files", () => {
  const result = spawnSync(process.execPath, [bumpScript, "--all", "patch", "--dry-run"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Dry run — planned version updates/);
  assert.match(result.stdout, /deploy\/helm\/openrum\/Chart\.yaml/);
  assert.match(result.stdout, /packages\/browser-sdk\/package\.json/);
  assert.match(result.stdout, /packages\/sourcemap\/package\.json/);
  assert.match(result.stdout, /packages\/cli\/package\.json/);
});
