// Validates an SDK release tag against the package manifest and reports the npm dist-tag.
// Tags look like browser-v0.1.1 or browser-v0.1.1-alpha.1; the SDK has its own version
// lifecycle, separate from the product's vX.Y.Z tags (see docs/operations/releasing.md).
import { appendFile, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const tag = process.env.RELEASE_TAG ?? "";
const match =
  /^browser-v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(
    tag,
  );
if (!match) {
  throw new Error(
    `RELEASE_TAG must look like browser-v0.1.1 or browser-v0.1.1-alpha.1; received ${JSON.stringify(tag)}`,
  );
}

// SDK_MANIFEST lets the tests point at a fixture instead of the real manifest.
const manifest = JSON.parse(
  await readFile(
    process.env.SDK_MANIFEST ?? join(root, "packages/browser-sdk/package.json"),
    "utf8",
  ),
);
if (manifest.name !== "@openrum/browser") throw new Error(`Unexpected package ${manifest.name}`);
if (manifest.private) throw new Error(`${manifest.name} is private and cannot be published to npm`);

const version = tag.slice("browser-v".length);
if (manifest.version !== version)
  throw new Error(`${manifest.name} is ${manifest.version}; expected ${version} from ${tag}`);

// A prerelease must never become the version `npm install` picks by default.
const npmTag = match[4] ? "next" : "latest";
if (process.env.GITHUB_OUTPUT) {
  await appendFile(process.env.GITHUB_OUTPUT, `version=${version}\nnpm_tag=${npmTag}\n`);
}
console.log(`${manifest.name}@${version} is ready to publish under the ${npmTag} tag`);
