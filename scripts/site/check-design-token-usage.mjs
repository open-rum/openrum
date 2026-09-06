import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const root = process.cwd();
const sourceRoots = ["apps/web/src", "apps/site/src", "packages/ui"];
const sourceExtensions = new Set([".astro", ".css", ".ts", ".tsx"]);
const rawColor = /#[0-9a-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch)\s*\(/gi;
const failures = [];

async function inspect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await inspect(path);
      continue;
    }
    if (!sourceExtensions.has(extname(path))) continue;
    const source = await readFile(path, "utf8");
    for (const match of source.matchAll(rawColor)) {
      const line = source.slice(0, match.index).split("\n").length;
      failures.push(`${relative(root, path)}:${line}: ${match[0]}`);
    }
  }
}

for (const sourceRoot of sourceRoots) await inspect(join(root, sourceRoot));

if (failures.length) {
  console.error(
    "Raw colors found outside packages/design-tokens. Add a semantic token instead:\n" +
      failures.join("\n"),
  );
  process.exit(1);
}

console.log("Design-token boundary passed: application sources contain no raw color literals.");
