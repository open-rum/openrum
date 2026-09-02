import { readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { spawnSync } from "node:child_process";

const ignoredDirectories = new Set([".git", "node_modules", "dist", "coverage", "output", "work"]);

function collectGoFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectGoFiles(path));
    if (entry.isFile() && extname(entry.name) === ".go") files.push(path);
  }
  return files;
}

const files = collectGoFiles(".").sort();
const write = process.argv.includes("--write");
const result = spawnSync("gofmt", [write ? "-w" : "-l", ...files], {
  encoding: "utf8",
  stdio: write ? "inherit" : "pipe",
});

if (result.error) throw result.error;
if (result.status !== 0) {
  process.stderr.write(result.stderr ?? "gofmt failed\n");
  process.exit(result.status ?? 1);
}
if (!write && result.stdout.trim()) {
  process.stderr.write(`Go files require formatting:\n${result.stdout}`);
  process.exit(1);
}
