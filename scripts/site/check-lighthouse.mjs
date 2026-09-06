import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const origin = "http://127.0.0.1:4323";
const routes = [
  ["Landing", "/"],
  ["Quickstart", "/docs/getting-started/quickstart/"],
  ["SDK install", "/docs/sdk/browser/"],
  ["Self-host", "/self-host/"],
];
const minimumScore = 0.9;
const temporaryDirectory = await mkdtemp(join(tmpdir(), "openrum-lighthouse-"));
const server = spawn(
  "pnpm",
  ["--filter", "@openrum/site", "preview", "--host", "127.0.0.1", "--port", "4323"],
  {
    cwd: process.cwd(),
    env: { ...process.env, ASTRO_PREVIEW_BACKGROUND: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

let serverOutput = "";
server.stdout.on("data", (chunk) => (serverOutput += chunk));
server.stderr.on("data", (chunk) => (serverOutput += chunk));

try {
  await waitForServer();
  const failures = [];

  for (const [name, route] of routes) {
    const reportPath = join(temporaryDirectory, `${name.toLowerCase().replaceAll(" ", "-")}.json`);
    await run(
      "pnpm",
      [
        "exec",
        "lighthouse",
        `${origin}${route}`,
        "--quiet",
        "--output=json",
        `--output-path=${reportPath}`,
        "--only-categories=performance,accessibility,seo",
        "--chrome-flags=--headless --no-sandbox --disable-gpu",
        "--max-wait-for-load=45000",
      ],
      {
        ...process.env,
        CHROME_PATH: chromium.executablePath(),
      },
    );

    const report = JSON.parse(await readFile(reportPath, "utf8"));
    const scores = Object.fromEntries(
      ["performance", "accessibility", "seo"].map((category) => [
        category,
        report.categories[category].score,
      ]),
    );
    const lcp = report.audits["largest-contentful-paint"].numericValue;
    const cls = report.audits["cumulative-layout-shift"].numericValue;
    const totalBlockingTime = report.audits["total-blocking-time"].numericValue;

    for (const [category, score] of Object.entries(scores)) {
      if (score < minimumScore) failures.push(`${name}: ${category} score ${score * 100} < 90`);
    }
    if (lcp >= 2_500) failures.push(`${name}: LCP ${Math.round(lcp)}ms >= 2500ms`);
    if (cls >= 0.1) failures.push(`${name}: CLS ${cls.toFixed(3)} >= 0.1`);
    if (totalBlockingTime >= 200) {
      failures.push(`${name}: total blocking time ${Math.round(totalBlockingTime)}ms >= 200ms`);
    }

    console.log(
      `${name}: performance ${Math.round(scores.performance * 100)}, accessibility ${Math.round(scores.accessibility * 100)}, SEO ${Math.round(scores.seo * 100)}, LCP ${Math.round(lcp)}ms, CLS ${cls.toFixed(3)}, TBT ${Math.round(totalBlockingTime)}ms`,
    );
  }

  if (failures.length) throw new Error(`Lighthouse gate failed:\n${failures.join("\n")}`);
  console.log("Lighthouse gate passed for all public-site acceptance pages.");
} finally {
  server.kill("SIGTERM");
  await rm(temporaryDirectory, { recursive: true, force: true });
}

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`Public-site preview exited before readiness:\n${serverOutput}`);
    }
    try {
      const response = await fetch(origin);
      if (response.ok) return;
    } catch {
      // The preview process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for public-site preview:\n${serverOutput}`);
}

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const process = spawn(command, args, { cwd: globalThis.process.cwd(), env, stdio: "inherit" });
    process.once("error", reject);
    process.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}
