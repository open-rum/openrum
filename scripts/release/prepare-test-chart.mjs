import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const [version, namespace, destination] = process.argv.slice(2);

if (!/^0\.1\.0-test\.[0-9]+\.[0-9]+$/.test(version ?? "")) {
  throw new Error("Expected a unique 0.1.0-test.<run>.<attempt> version.");
}

if (!/^[a-z0-9-]+$/.test(namespace ?? "")) {
  throw new Error("Expected a GitHub package namespace.");
}

if (!destination) {
  throw new Error("Expected a destination directory.");
}

const chartDir = join(destination, "openrum");
await mkdir(destination, { recursive: true });
await cp("deploy/helm/openrum", chartDir, { recursive: true });

async function replaceOnce(file, current, next) {
  const source = await readFile(file, "utf8");
  if (source.split(current).length !== 2) {
    throw new Error(`Expected exactly one ${current} entry in ${file}.`);
  }
  await writeFile(file, source.replace(current, next));
}

await replaceOnce(join(chartDir, "Chart.yaml"), "version: 0.1.0", `version: ${version}`);
await replaceOnce(join(chartDir, "Chart.yaml"), 'appVersion: "0.1.0"', `appVersion: "${version}"`);
await replaceOnce(
  join(chartDir, "values.yaml"),
  "repository: ghcr.io/openrum/openrum",
  `repository: ghcr.io/${namespace}/openrum`,
);
await replaceOnce(join(chartDir, "values.yaml"), 'tag: "0.1.0"', `tag: "${version}"`);
