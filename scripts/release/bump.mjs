// Bumps version numbers across manifests, code constants and bilingual documentation for
// selected OpenRUM release targets, then regenerates reference docs and runs version checks.
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatTag,
  RELEASE_TARGETS,
  resolveVersion,
  TAG_PUSH_ORDER,
  TARGET_BY_ID,
} from "./targets.mjs";

const defaultRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

const PRODUCT_DOC_FILES = [
  "apps/site/src/content/docs/docs/getting-started/production-deployment/install.mdx",
  "apps/site/src/content/docs/zh/docs/getting-started/production-deployment/install.mdx",
  "apps/site/src/content/docs/docs/self-hosting/overview.mdx",
  "apps/site/src/content/docs/zh/docs/self-hosting/overview.mdx",
  "apps/site/src/content/docs/docs/self-hosting/kubernetes.md",
  "apps/site/src/content/docs/zh/docs/self-hosting/kubernetes.md",
  "apps/site/src/content/docs/docs/self-hosting/email.mdx",
  "apps/site/src/content/docs/zh/docs/self-hosting/email.mdx",
];

const BROWSER_DOC_FILES = [
  "README.md",
  "README.zh-CN.md",
  "packages/browser-sdk/README.md",
  "apps/site/src/content/docs/docs/sdk/browser/index.mdx",
  "apps/site/src/content/docs/zh/docs/sdk/browser/index.mdx",
  "apps/site/src/content/docs/docs/sdk/browser/react.mdx",
  "apps/site/src/content/docs/zh/docs/sdk/browser/react.mdx",
  "apps/site/src/content/docs/docs/sdk/browser/vue.mdx",
  "apps/site/src/content/docs/zh/docs/sdk/browser/vue.mdx",
  "apps/site/src/content/docs/docs/sdk/browser/nextjs.mdx",
  "apps/site/src/content/docs/zh/docs/sdk/browser/nextjs.mdx",
  "apps/site/src/content/docs/docs/sdk/browser/astro.mdx",
  "apps/site/src/content/docs/zh/docs/sdk/browser/astro.mdx",
  "apps/site/src/content/docs/docs/sdk/browser/tanstack-router.mdx",
  "apps/site/src/content/docs/zh/docs/sdk/browser/tanstack-router.mdx",
  "apps/site/src/content/docs/docs/reference/sdk-options.md",
  "apps/site/src/content/docs/zh/docs/reference/sdk-options.md",
  "apps/site/src/content/docs/docs/reference/http-api.md",
  "apps/site/src/content/docs/zh/docs/reference/http-api.md",
];

const CLI_DOC_FILES = [
  "apps/site/src/content/docs/docs/reference/cli.md",
  "apps/site/src/content/docs/zh/docs/reference/cli.md",
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function versionTokenRegex(version) {
  return new RegExp(`(?<![\\d.])${escapeRegExp(version)}(?!\\d)`, "g");
}

function parseArgs(argv) {
  const options = {
    specs: {},
    dryRun: false,
    noGenerate: false,
    noCheck: false,
    root: defaultRoot,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--no-generate") {
      options.noGenerate = true;
    } else if (arg === "--no-check") {
      options.noCheck = true;
    } else if (arg === "--root") {
      options.root = resolve(argv[++i] ?? "");
    } else if (arg === "--all") {
      const value = argv[++i];
      if (!value) throw new Error("--all requires a version or patch/minor/major");
      for (const target of RELEASE_TARGETS) {
        options.specs[target.id] = value;
      }
    } else if (
      arg === "--product" ||
      arg === "--browser" ||
      arg === "--sourcemap" ||
      arg === "--cli"
    ) {
      const value = argv[++i];
      if (!value) throw new Error(`${arg} requires a version or patch/minor/major`);
      options.specs[arg.slice(2)] = value;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function printHelp() {
  console.log(`Usage: pnpm release:bump [targets] [options]

Update manifests, code constants and bilingual documentation for selected release targets.

Targets (pass an explicit semver like 0.1.4, 0.2.0-alpha.1, or patch / minor / major):
  --product <ver>     Bump Product (Helm Chart, values.yaml and deployment docs)
  --browser <ver>     Bump @openrum/browser (package.json, SDK/API constants and SDK docs)
  --sourcemap <ver>   Bump @openrum/sourcemap (package.json)
  --cli <ver>         Bump @openrum/cli (package.json and CLI reference docs)
  --all <ver>         Bump all four release targets

Options:
  --dry-run           Show planned changes without modifying files
  --no-generate       Skip running scripts/docs/generate-reference.mjs
  --no-check          Skip running scripts/release/check-*.mjs
  --root <dir>        Repository root directory
  -h, --help          Show this help message

Examples:
  pnpm release:bump --product 0.1.4
  pnpm release:bump --browser patch --cli patch
  pnpm release:bump --all 0.2.0 --dry-run`);
}

async function applyEdit(root, relPath, transform, { dryRun, touched }) {
  const fullPath = join(root, relPath);
  const original = await readFile(fullPath, "utf8");
  const updated = transform(original);
  if (updated === original) return false;
  touched.add(relPath);
  if (!dryRun) {
    await writeFile(fullPath, updated, "utf8");
  }
  return true;
}

function replaceOrThrow(content, pattern, replacement, description) {
  const updated = content.replace(pattern, replacement);
  if (updated === content) {
    throw new Error(`Failed to update ${description}`);
  }
  return updated;
}

function updatePackageJsonVersion(content, nextVersion, relPath) {
  return replaceOrThrow(
    content,
    /^(\s*"version":\s*")[^"]+(")/m,
    `$1${nextVersion}$2`,
    `version in ${relPath}`,
  );
}

async function bumpProduct(root, prev, next, ctx) {
  await applyEdit(
    root,
    "deploy/helm/openrum/Chart.yaml",
    (content) => {
      let out = replaceOrThrow(
        content,
        /^(version:\s*)["']?[^\s"'#]+["']?/m,
        `$1${next}`,
        "version in deploy/helm/openrum/Chart.yaml",
      );
      out = replaceOrThrow(
        out,
        /^(appVersion:\s*")[^"]+(")/m,
        `$1${next}$2`,
        "appVersion in deploy/helm/openrum/Chart.yaml",
      );
      return out;
    },
    ctx,
  );

  await applyEdit(
    root,
    "deploy/helm/openrum/values.yaml",
    (content) =>
      replaceOrThrow(
        content,
        /(^image:\s*\n(?:^[ \t].*\n)*?^[ \t]+tag:\s*")[^"]+(")/m,
        `$1${next}$2`,
        "image.tag in deploy/helm/openrum/values.yaml",
      ),
    ctx,
  );

  const token = versionTokenRegex(prev);
  for (const docPath of PRODUCT_DOC_FILES) {
    await applyEdit(root, docPath, (content) => content.replace(token, next), ctx);
  }
}

async function bumpBrowser(root, prev, next, ctx) {
  await applyEdit(
    root,
    "packages/browser-sdk/package.json",
    (content) => updatePackageJsonVersion(content, next, "packages/browser-sdk/package.json"),
    ctx,
  );

  await applyEdit(
    root,
    "packages/browser-sdk/src/transport/sender.ts",
    (content) =>
      replaceOrThrow(
        content,
        /^(const SDK_VERSION = ")[^"]+(";)/m,
        `$1${next}$2`,
        "SDK_VERSION in packages/browser-sdk/src/transport/sender.ts",
      ),
    ctx,
  );

  await applyEdit(
    root,
    "packages/protocol/src/dsn.ts",
    (content) =>
      replaceOrThrow(
        content,
        /^(export const OPENRUM_BROWSER_SDK_VERSION = ")[^"]+(";)/m,
        `$1${next}$2`,
        "OPENRUM_BROWSER_SDK_VERSION in packages/protocol/src/dsn.ts",
      ),
    ctx,
  );

  await applyEdit(
    root,
    "services/api/internal/handlers/browser_sdk.go",
    (content) => {
      let out = replaceOrThrow(
        content,
        /^(\s*BrowserSDKVersion\s*=\s*")[^"]+(")/m,
        `$1${next}$2`,
        "BrowserSDKVersion in browser_sdk.go",
      );
      out = replaceOrThrow(
        out,
        /^(\s*BrowserSDKPublicPath\s*=\s*"\/sdk\/browser\/)[^/]+(\/openrum\.min\.js")/m,
        `$1${next}$2`,
        "BrowserSDKPublicPath in browser_sdk.go",
      );
      out = replaceOrThrow(
        out,
        /^(\s*BrowserSDKLegacyPublicPath\s*=\s*"\/api\/v1\/sdk\/browser\/)[^/]+(\/openrum\.min\.js")/m,
        `$1${next}$2`,
        "BrowserSDKLegacyPublicPath in browser_sdk.go",
      );
      return out;
    },
    ctx,
  );

  await applyEdit(
    root,
    "apps/web/src/features/onboarding/onboarding.test.tsx",
    (content) =>
      content.replaceAll(
        `/sdk/browser/${prev}/openrum.min.js`,
        `/sdk/browser/${next}/openrum.min.js`,
      ),
    ctx,
  );

  const token = versionTokenRegex(prev);
  for (const docPath of BROWSER_DOC_FILES) {
    await applyEdit(root, docPath, (content) => content.replace(token, next), ctx);
  }
}

async function bumpSourcemap(root, _prev, next, ctx) {
  await applyEdit(
    root,
    "packages/sourcemap/package.json",
    (content) => updatePackageJsonVersion(content, next, "packages/sourcemap/package.json"),
    ctx,
  );
}

async function bumpCli(root, prev, next, ctx) {
  await applyEdit(
    root,
    "packages/cli/package.json",
    (content) => updatePackageJsonVersion(content, next, "packages/cli/package.json"),
    ctx,
  );

  const token = versionTokenRegex(prev);
  for (const docPath of CLI_DOC_FILES) {
    await applyEdit(root, docPath, (content) => content.replace(token, next), ctx);
  }
}

const BUMPERS = {
  product: bumpProduct,
  browser: bumpBrowser,
  sourcemap: bumpSourcemap,
  cli: bumpCli,
};

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const selectedIds = Object.keys(options.specs);
  if (selectedIds.length === 0) {
    printHelp();
    process.exitCode = 1;
    return;
  }

  const plan = [];
  for (const id of TAG_PUSH_ORDER) {
    if (!(id in options.specs)) continue;
    const target = TARGET_BY_ID[id];
    const current = await target.readCurrentVersion(options.root);
    const next = resolveVersion(current, options.specs[id]);
    if (next === current) {
      throw new Error(`${id} is already at version ${current}`);
    }
    plan.push({ target, current, next });
  }

  const touched = new Set();
  const ctx = { dryRun: options.dryRun, touched };

  for (const step of plan) {
    await BUMPERS[step.target.id](options.root, step.current, step.next, ctx);
  }

  console.log(options.dryRun ? "Dry run — planned version updates:\n" : "Updated versions:\n");
  for (const step of plan) {
    console.log(
      `  - ${step.target.id.padEnd(10)} ${step.current} -> ${step.next} (tag: ${formatTag(step.target, step.next)})`,
    );
  }

  console.log(
    `\n${options.dryRun ? "Files that would change" : "Modified files"} (${touched.size}):`,
  );
  for (const file of [...touched].sort()) {
    console.log(`  - ${file}`);
  }

  if (options.dryRun) return;

  if (!options.noGenerate) {
    console.log("\nRegenerating reference docs...");
    execFileSync(process.execPath, [join(options.root, "scripts/docs/generate-reference.mjs")], {
      cwd: options.root,
      stdio: "inherit",
    });
  }

  if (!options.noCheck) {
    console.log("\nVerifying release version metadata...");
    for (const step of plan) {
      const checkScript =
        step.target.id === "product"
          ? join(options.root, "scripts/release/check-version.mjs")
          : join(options.root, "scripts/release/check-package-version.mjs");
      execFileSync(process.execPath, [checkScript], {
        cwd: options.root,
        stdio: "inherit",
        env: {
          ...process.env,
          RELEASE_TAG: formatTag(step.target, step.next),
          GITHUB_OUTPUT: "",
        },
      });
    }
  }

  console.log("\nNext steps:");
  console.log("  1. Review diff and run validation: pnpm run check && pnpm run site:check");
  console.log("  2. Commit the release-prep PR and merge to main.");
  console.log("  3. After main CI is green, pull main and push tags in order:");
  for (const step of plan) {
    const tag = formatTag(step.target, step.next);
    const message = `${step.target.tagMessagePrefix}${step.next}`;
    console.log(`     git tag -a ${tag} -m "${message}" && git push origin ${tag}`);
  }
}

await main();
