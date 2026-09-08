import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const pages = [
  "index.astro",
  "product.astro",
  "self-host.astro",
  "community.astro",
  "benchmarks.astro",
];
test("public pages keep Quickstart/GitHub adoption and avoid SaaS funnel claims", async () => {
  const source = (
    await Promise.all(
      pages.map((page) => readFile(new URL(`../src/pages/${page}`, import.meta.url), "utf8")),
    )
  ).join("\n");
  assert.doesNotMatch(source, /pricing|start free trial|hosted demo/i);
  const landing = await readFile(
    new URL("../src/components/landing/LandingPage.astro", import.meta.url),
    "utf8",
  );
  assert.match(landing, /getting-started\/quickstart\//);
  assert.match(landing, /GitHub/);
});

test("robots and Open Graph asset are static and privacy-safe", async () => {
  const robots = await readFile(new URL("../public/robots.txt", import.meta.url), "utf8");
  const og = await readFile(new URL("../public/og.svg", import.meta.url), "utf8");
  assert.match(robots, /Sitemap:/);
  assert.doesNotMatch(og, /<script|(?:href|src)="https?:\/\//i);
});
