// Validates a package release tag against the package manifest and reports the npm dist-tag.
// Each npm package has its own version and tag prefix, separate from the product's vX.Y.Z tags
// (see docs/operations/releasing.md): browser-v0.1.1, sourcemap-v0.1.0, cli-v0.1.0, each
// optionally with a prerelease such as -alpha.1.
import { appendFile, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const packages = {
  browser: { directory: "packages/browser-sdk", name: "@openrum/browser" },
  sourcemap: { directory: "packages/sourcemap", name: "@openrum/sourcemap" },
  cli: { directory: "packages/cli", name: "@openrum/cli" },
};

const tag = process.env.RELEASE_TAG ?? "";
const match =
  /^(browser|sourcemap|cli)-v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(
    tag,
  );
if (!match) {
  throw new Error(
    `RELEASE_TAG must look like browser-v0.1.1, sourcemap-v0.1.0 or cli-v0.1.0, optionally with a prerelease such as -alpha.1; received ${JSON.stringify(tag)}`,
  );
}
const target = packages[match[1]];

// PACKAGE_MANIFEST lets the tests point at a fixture instead of the real manifest.
const manifest = JSON.parse(
  await readFile(
    process.env.PACKAGE_MANIFEST ?? join(root, target.directory, "package.json"),
    "utf8",
  ),
);
if (manifest.name !== target.name)
  throw new Error(`Tag ${tag} is for ${target.name}, but the manifest is ${manifest.name}`);
if (manifest.private) throw new Error(`${manifest.name} is private and cannot be published to npm`);

// npm signs provenance for a public repository and rejects the upload unless the package
// names that repository, which a dry run cannot otherwise discover.
const repositoryUrl = String(manifest.repository?.url ?? manifest.repository ?? "")
  .replace(/^git\+/, "")
  .replace(/\.git$/, "");
if (repositoryUrl !== "https://github.com/open-rum/openrum")
  throw new Error(
    `${manifest.name} must set repository.url to https://github.com/open-rum/openrum; received ${JSON.stringify(repositoryUrl)}`,
  );

const version = tag.slice(tag.indexOf("-v") + 2);
if (manifest.version !== version)
  throw new Error(`${manifest.name} is ${manifest.version}; expected ${version} from ${tag}`);

// A prerelease must never become the version `npm install` picks by default.
const npmTag = match[5] ? "next" : "latest";
if (process.env.GITHUB_OUTPUT) {
  await appendFile(
    process.env.GITHUB_OUTPUT,
    `version=${version}\nnpm_tag=${npmTag}\nname=${manifest.name}\ndirectory=${target.directory}\n`,
  );
}
console.log(`${manifest.name}@${version} is ready to publish under the ${npmTag} tag`);
