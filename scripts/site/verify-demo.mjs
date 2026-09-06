import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const generator = await readFile(join(root, "services/api/cmd/demo/realistic_dataset.go"), "utf8");
const guide = await readFile(join(root, "docs/demo-data.md"), "utf8");
const investigation = await readFile(
  join(root, "apps/site/src/content/docs/docs/product/investigation.md"),
  "utf8",
);

const checks = [
  [generator, /realisticDemoSessions\s*=\s*30_000/, "30,000-session constant"],
  [generator, /rand\.NewSource\(20260903\)/, "fixed synthetic seed"],
  [generator, /deterministicDemoUUID/, "deterministic Event IDs"],
  [generator, /dataset_complete/, "idempotent completion marker"],
  [guide, /Complete local reset/, "local reset instructions"],
  [investigation, /Behavior → Session → Issue/, "documented investigation path"],
  [investigation, /mapped original source frame/, "mapped Source Map destination"],
];

for (const [source, pattern, label] of checks) {
  if (!pattern.test(source)) throw new Error(`Demo verification failed: missing ${label}`);
}

console.log(
  "Demo evidence verified: fixed seed, deterministic IDs, reset guide and mapped investigation path.",
);
