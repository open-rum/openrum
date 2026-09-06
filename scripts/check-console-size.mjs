import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { gzipSync } from "node:zlib";

const config = JSON.parse(readFileSync("apps/web/performance-budget.json", "utf8"));
if (
  !Number.isInteger(config.maxInitialJavaScriptGzipBytes) ||
  config.maxInitialJavaScriptGzipBytes <= 0
) {
  throw new Error("console initial JavaScript budget must be a positive integer");
}
const html = readFileSync(config.entryHtml, "utf8");
const sources = [...html.matchAll(/<script[^>]+type="module"[^>]+src="([^"]+)"/g)].map(
  (match) => match[1],
);
if (!sources.length) throw new Error("console build has no initial module script");
const base = dirname(config.entryHtml);
const bytes = sources.reduce((total, source) => {
  const artifact = resolve(base, source.replace(/^\//, ""));
  return total + gzipSync(readFileSync(artifact), { level: 9 }).byteLength;
}, 0);
if (bytes > config.maxInitialJavaScriptGzipBytes) {
  throw new Error(
    `console initial JavaScript gzip is ${bytes} bytes; budget is ${config.maxInitialJavaScriptGzipBytes} bytes`,
  );
}
console.log(
  `Console initial JavaScript gzip size: ${bytes}/${config.maxInitialJavaScriptGzipBytes} bytes`,
);
