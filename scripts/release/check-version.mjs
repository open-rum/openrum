import { appendFile, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const tag = process.env.RELEASE_TAG ?? "";
const match =
  /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(tag);

if (!match) {
  throw new Error(
    `RELEASE_TAG must be a semantic version tag such as v0.1.0 or v0.1.0-alpha.1; received ${JSON.stringify(tag)}`,
  );
}

const version = tag.slice(1);
const chart = await readFile(join(root, "deploy/helm/openrum/Chart.yaml"), "utf8");
const values = await readFile(join(root, "deploy/helm/openrum/values.yaml"), "utf8");

function readScalar(source, field) {
  const value = source.match(new RegExp(`^${field}:\\s*["']?([^\\s"'#]+)`, "m"))?.[1];
  if (!value) throw new Error(`Missing ${field} in Helm release metadata`);
  return value;
}

const image = values.match(/^image:\s*\n((?:^[ \t].*(?:\n|$))*)/m)?.[1];
if (!image) throw new Error("Missing image values in Helm chart");
const imageRepository = image.match(/^  repository:\s*([^\s#]+)/m)?.[1];
const imageTag = image.match(/^  tag:\s*["']?([^\s"'#]+)/m)?.[1];

const expected = {
  "Chart.version": readScalar(chart, "version"),
  "Chart.appVersion": readScalar(chart, "appVersion"),
  "image.tag": imageTag,
};
for (const [field, actual] of Object.entries(expected)) {
  if (actual !== version)
    throw new Error(`${field} is ${actual ?? "missing"}; expected ${version} from ${tag}`);
}
if (imageRepository !== "ghcr.io/open-rum/openrum") {
  throw new Error(
    `image.repository must be ghcr.io/open-rum/openrum for the public chart; received ${imageRepository ?? "missing"}`,
  );
}

if (process.env.GITHUB_OUTPUT) {
  await appendFile(process.env.GITHUB_OUTPUT, `version=${version}\n`);
}
console.log(`Release metadata is aligned for ${tag}: image ${imageRepository}:${imageTag}`);
