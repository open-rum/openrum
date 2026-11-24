import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export const RELEASE_TARGETS = [
  {
    id: "product",
    label: "Product (image & Helm Chart)",
    tagPrefix: "v",
    tagGlob: "v*",
    tagMessagePrefix: "OpenRUM v",
    paths: [
      "services",
      "internal",
      "apps/web",
      "migrations",
      "deploy/helm",
      "Dockerfile",
      "go.mod",
      "go.sum",
      "go.work",
      "go.work.sum",
      "packages/protocol",
    ],
    readCurrentVersion: async (root) => {
      const chart = await readFile(join(root, "deploy/helm/openrum/Chart.yaml"), "utf8");
      const version = chart.match(/^version:\s*["']?([^\s"'#]+)/m)?.[1];
      if (!version) throw new Error("Missing version in deploy/helm/openrum/Chart.yaml");
      return version;
    },
  },
  {
    id: "browser",
    label: "@openrum/browser",
    tagPrefix: "browser-v",
    tagGlob: "browser-v*",
    tagMessagePrefix: "@openrum/browser ",
    paths: ["packages/browser-sdk", "packages/protocol"],
    readCurrentVersion: async (root) => {
      const manifest = JSON.parse(
        await readFile(join(root, "packages/browser-sdk/package.json"), "utf8"),
      );
      if (!manifest.version)
        throw new Error("Missing version in packages/browser-sdk/package.json");
      return manifest.version;
    },
  },
  {
    id: "sourcemap",
    label: "@openrum/sourcemap",
    tagPrefix: "sourcemap-v",
    tagGlob: "sourcemap-v*",
    tagMessagePrefix: "@openrum/sourcemap ",
    paths: ["packages/sourcemap"],
    readCurrentVersion: async (root) => {
      const manifest = JSON.parse(
        await readFile(join(root, "packages/sourcemap/package.json"), "utf8"),
      );
      if (!manifest.version) throw new Error("Missing version in packages/sourcemap/package.json");
      return manifest.version;
    },
  },
  {
    id: "cli",
    label: "@openrum/cli",
    tagPrefix: "cli-v",
    tagGlob: "cli-v*",
    tagMessagePrefix: "@openrum/cli ",
    paths: ["packages/cli", "packages/sourcemap"],
    readCurrentVersion: async (root) => {
      const manifest = JSON.parse(await readFile(join(root, "packages/cli/package.json"), "utf8"));
      if (!manifest.version) throw new Error("Missing version in packages/cli/package.json");
      return manifest.version;
    },
  },
];

export const TARGET_BY_ID = Object.fromEntries(
  RELEASE_TARGETS.map((target) => [target.id, target]),
);

// Push order recommended by docs/operations/releasing.md: npm packages (especially browser SDK)
// before the product release that announces them.
export const TAG_PUSH_ORDER = ["browser", "sourcemap", "cli", "product"];

export function isValidSemver(value) {
  return SEMVER_PATTERN.test(value);
}

export function incrementSemver(current, kind) {
  const match = SEMVER_PATTERN.exec(current);
  if (!match) {
    throw new Error(`Current version ${JSON.stringify(current)} is not valid semver`);
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (kind === "patch") return `${major}.${minor}.${patch + 1}`;
  if (kind === "minor") return `${major}.${minor + 1}.0`;
  if (kind === "major") return `${major + 1}.0.0`;
  throw new Error(`Unsupported increment kind: ${kind}`);
}

export function resolveVersion(current, spec) {
  if (spec === "patch" || spec === "minor" || spec === "major") {
    return incrementSemver(current, spec);
  }
  if (!isValidSemver(spec)) {
    throw new Error(
      `Invalid version ${JSON.stringify(spec)}; expected semver (e.g. 0.1.4, 0.2.0-alpha.1) or patch/minor/major`,
    );
  }
  return spec;
}

export function formatTag(target, version) {
  return `${target.tagPrefix}${version}`;
}
