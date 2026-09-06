import { readFile, readdir, stat } from "node:fs/promises";
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
let totalAssets = 0;
let externalScripts = 0;
const failures = [];
for (const file of files) {
  const size = (await stat(file)).size;
  if (extname(file) === ".html") {
    if (size > budget.maxHtmlBytes) failures.push(`${file}: HTML ${size} bytes`);
    const html = await readFile(file, "utf8");
    externalScripts += [...html.matchAll(/<script[^>]+src=["']https?:\/\//gi)].length;
  } else {
    totalAssets += size;
    if (size > budget.maxAssetBytes) failures.push(`${file}: asset ${size} bytes`);
  }
}
if (totalAssets > budget.maxTotalAssetBytes) {
  failures.push(`all non-HTML assets: ${totalAssets} bytes`);
}
if (externalScripts > budget.maxExternalScripts) {
  failures.push(`external scripts: ${externalScripts}`);
}
if (failures.length) {
  console.error(`Public-site performance budget failed:\n${failures.join("\n")}`);
  process.exit(1);
}
console.log(
  `Public-site budget passed: ${files.length} files, ${totalAssets} non-HTML bytes, no external scripts.`,
);
