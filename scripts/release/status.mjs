// Reports unreleased changes per release target by comparing each target's latest Git tag
// against the selected ref (default: HEAD).
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { incrementSemver, RELEASE_TARGETS } from "./targets.mjs";

const defaultRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

function parseArgs(argv) {
  const options = { ref: "HEAD", json: false, root: defaultRoot, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--ref") {
      options.ref = argv[++i] ?? "";
    } else if (arg === "--root") {
      options.root = resolve(argv[++i] ?? "");
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!options.ref) throw new Error("--ref requires a value");
  return options;
}

function runGit(root, args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function findLatestTag(root, target) {
  const output = runGit(root, ["tag", "-l", target.tagGlob, "--sort=-v:refname"]);
  if (!output) return null;
  const tags = output.split("\n").filter(Boolean);
  const matcher = new RegExp(`^${target.tagPrefix.replace("-", "\\-")}\\d+\\.\\d+\\.\\d+`);
  return tags.find((tag) => matcher.test(tag)) ?? null;
}

function listCommitsSince(root, fromTag, toRef, paths) {
  const range = fromTag ? `${fromTag}..${toRef}` : toRef;
  const output = runGit(root, [
    "log",
    "--no-merges",
    "--pretty=format:%h %s",
    range,
    "--",
    ...paths,
  ]);
  if (!output) return [];
  return output.split("\n").filter(Boolean);
}

function printHelp() {
  console.log(`Usage: pnpm release:status [options]

Inspect unreleased commits for each OpenRUM release target (product, browser, sourcemap, cli).

Options:
  --ref <git-ref>   Compare tags against this ref (default: HEAD)
  --json            Print machine-readable JSON output
  --root <dir>      Repository root directory
  -h, --help        Show this help message`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const results = [];
  for (const target of RELEASE_TARGETS) {
    const currentVersion = await target.readCurrentVersion(options.root);
    const latestTag = findLatestTag(options.root, target);
    const latestTagVersion = latestTag ? latestTag.slice(target.tagPrefix.length) : null;
    const commits = listCommitsSince(options.root, latestTag, options.ref, target.paths);
    const pendingTag = latestTagVersion !== null && currentVersion !== latestTagVersion;

    let state = "clean";
    if (pendingTag) {
      state = "pending-tag";
    } else if (commits.length > 0) {
      state = "changes";
    }

    const suggestedVersion =
      state === "changes" ? incrementSemver(currentVersion, "patch") : currentVersion;

    results.push({
      id: target.id,
      label: target.label,
      currentVersion,
      latestTag,
      latestTagVersion,
      state,
      suggestedVersion,
      commitCount: commits.length,
      commits,
    });
  }

  if (options.json) {
    console.log(JSON.stringify({ ref: options.ref, targets: results }, null, 2));
    return;
  }

  console.log(`Release status against ${options.ref}\n`);
  for (const item of results) {
    const tagInfo = item.latestTag ?? "none";
    const statusText =
      item.state === "pending-tag"
        ? `PENDING TAG (manifest ${item.currentVersion} != last tag ${tagInfo})`
        : item.state === "changes"
          ? `${item.commitCount} unreleased commit(s) since ${tagInfo} -> suggest ${item.suggestedVersion}`
          : `clean (at ${tagInfo})`;

    console.log(`- ${item.id.padEnd(10)} ${item.label}`);
    console.log(`  current: ${item.currentVersion} | last tag: ${tagInfo} | ${statusText}`);
    for (const commit of item.commits.slice(0, 8)) {
      console.log(`    · ${commit}`);
    }
    if (item.commits.length > 8) {
      console.log(`    · ... and ${item.commits.length - 8} more`);
    }
  }

  const bumpArgs = results
    .filter((item) => item.state === "changes")
    .map((item) => `--${item.id} ${item.suggestedVersion}`);

  console.log("");
  if (bumpArgs.length > 0) {
    console.log("Suggested next step:");
    console.log(`  pnpm release:bump ${bumpArgs.join(" ")}`);
  } else if (results.some((item) => item.state === "pending-tag")) {
    console.log("Some targets have bumped manifests waiting for a release tag.");
  } else {
    console.log("All release targets are up to date with their latest tags.");
  }
}

await main();
