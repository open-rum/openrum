import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";

const root = process.cwd();
const dist = join(root, "apps/site/dist");
const budget = JSON.parse(await readFile(join(root, "apps/site/performance-budget.json"), "utf8"));
const files = [];

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else files.push(path);
  }
}

await walk(dist);
let externalScripts = 0;
for (const file of files) {
  if (extname(file) === ".html") {
    const html = await readFile(file, "utf8");
    externalScripts += [...html.matchAll(/<script[^>]+src=["']https?:\/\//gi)].length;
  }
}
if (externalScripts > budget.maxExternalScripts) {
  console.error(
    `Public-site external-script policy failed: ${externalScripts} scripts exceed the allowed ${budget.maxExternalScripts}.`,
  );
  process.exit(1);
}
console.log(`Public-site external-script policy passed: ${externalScripts} external scripts.`);
