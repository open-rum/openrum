import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

async function contentFiles(root, prefix = "") {
  const entries = await readdir(root, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const url = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, root);
      return entry.isDirectory() ? contentFiles(url, relative) : relative;
    }),
  );
  return files
    .flat()
    .filter((file) => /\.mdx?$/.test(file))
    .sort();
}

test("English and Chinese documentation have exact page parity", async () => {
  const englishRoot = new URL("../src/content/docs/docs/", import.meta.url);
  const chineseRoot = new URL("../src/content/docs/zh/docs/", import.meta.url);
  const [english, chinese] = await Promise.all([
    contentFiles(englishRoot),
    contentFiles(chineseRoot),
  ]);
  assert.deepEqual(chinese, english);
  for (const file of chinese) {
    const source = await readFile(new URL(file, chineseRoot), "utf8");
    assert.doesNotMatch(source, /\]\(\/docs\//, `${file} contains an English internal link`);
  }
  for (const file of english) {
    const source = await readFile(new URL(file, englishRoot), "utf8");
    assert.doesNotMatch(source, /Alpha \/ main/, `${file} exposes an internal branch name`);
  }
  for (const component of ["SiteFooter.astro", "DocsFooter.astro"]) {
    const source = await readFile(
      new URL(`../src/components/${component}`, import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(source, /Alpha \/ main/, `${component} exposes an internal branch name`);
  }
});

test("published local benchmark gates agree with retained k6 evidence", async () => {
  const evidence = JSON.parse(
    await readFile(
      new URL("../src/content/evidence/local-capacity-2026-09-18.json", import.meta.url),
      "utf8",
    ),
  );
  const source = new URL("../../../docs/benchmarks/results/2026-09-18/", import.meta.url);
  const ingest = JSON.parse(await readFile(new URL("ingest.json", source), "utf8"));
  const query = JSON.parse(await readFile(new URL("query.json", source), "utf8"));
  assert.equal(evidence.productionClaim, false);
  assert.equal(evidence.hardware.memoryGiB, 24);
  assert.equal(evidence.acceptedEvents, ingest.metrics.openrum_accepted_events.count);
  assert.equal(evidence.acceptedEvents, evidence.storedEvents);
  assert.equal(evidence.storedEvents, evidence.uniqueEventIds);
  assert.equal(
    evidence.ingestP95Milliseconds,
    Math.round(ingest.metrics.http_req_duration["p(95)"] * 100) / 100,
  );
  assert.equal(
    evidence.queryP95Milliseconds,
    Math.round(query.metrics.http_req_duration["p(95)"] * 100) / 100,
  );
  // k6 summary exports true for a failed threshold, not for a passed one.
  const failed = [ingest, query].some((report) =>
    Object.values(report.metrics).some((metric) =>
      Object.values(metric.thresholds || {}).some(Boolean),
    ),
  );
  assert.equal(evidence.passed, !failed);
  assert.ok(evidence.attempts.some((attempt) => attempt.query.failurePercent > 1));
});

test("public landing page keeps Quickstart/GitHub adoption and avoids SaaS funnel claims", async () => {
  const source = await readFile(new URL("../src/pages/index.astro", import.meta.url), "utf8");
  assert.doesNotMatch(source, /pricing|start free trial|hosted demo/i);
  const landing = await readFile(
    new URL("../src/components/landing/LandingPage.astro", import.meta.url),
    "utf8",
  );
  assert.match(landing, /getting-started\/quickstart\//);
  assert.match(landing, /GitHub/);
});

test("docs header uses compact public labels", async () => {
  const header = await readFile(
    new URL("../src/components/docs/DocsHeader.astro", import.meta.url),
    "utf8",
  );
  const sidebar = await readFile(
    new URL("../src/components/docs/DocsSidebar.astro", import.meta.url),
    "utf8",
  );
  const config = await readFile(new URL("../astro.config.mjs", import.meta.url), "utf8");
  assert.match(header, /<span class="docs-wordmark">Docs<\/span>/);
  assert.doesNotMatch(header, /BrandWordmark|OpenRUM 文档/);
  assert.match(header, /DocsThemeMenu|DocsLanguageMenu/);
  assert.doesNotMatch(sidebar, /docs-sidebar-topic/);
  assert.match(config, /label: "Start"/);
  assert.match(config, /translations: \{ zh: "开始", "zh-CN": "开始" \}/);
  assert.match(config, /label: "Deploy production"/);
});

test("robots and Open Graph asset are static and privacy-safe", async () => {
  const robots = await readFile(new URL("../public/robots.txt", import.meta.url), "utf8");
  const og = await readFile(new URL("../public/og.svg", import.meta.url), "utf8");
  assert.match(robots, /Sitemap:/);
  assert.doesNotMatch(og, /<script|(?:href|src)="https?:\/\//i);
});
