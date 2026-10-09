// Packs @openrum/browser and installs the tarball into an empty project, the way a user
// would. The workspace hides a broken package: a private dependency such as
// @openrum/protocol resolves locally but not from npm, so only a clean install proves the
// tarball works. Run after `pnpm --filter @openrum/browser build`.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const packageDirectory = join(root, "packages/browser-sdk");
const manifest = JSON.parse(readFileSync(join(packageDirectory, "package.json"), "utf8"));
const workspace = mkdtempSync(join(tmpdir(), "openrum-sdk-"));
const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    stdio: ["ignore", "pipe", "inherit"],
    encoding: "utf8",
    ...options,
  });

try {
  if (manifest.private)
    throw new Error(`${manifest.name} is marked private and cannot be published`);
  for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
    if (String(range).startsWith("workspace:"))
      throw new Error(
        `${name} is a workspace dependency; bundle it (tsup noExternal) and list it in devDependencies`,
      );
  }

  const packed = join(workspace, "packed");
  const consumer = join(workspace, "consumer");
  mkdirSync(packed);
  mkdirSync(consumer);
  run("pnpm", ["pack", "--pack-destination", packed], { cwd: packageDirectory });
  const tarball = join(packed, readdirSync(packed).find((file) => file.endsWith(".tgz")) ?? "");
  const listing = run("tar", ["-tzf", tarball]);
  for (const required of ["package/dist/index.js", "package/dist/index.d.ts", "package/README.md"])
    if (!listing.includes(required)) throw new Error(`tarball is missing ${required}`);

  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify({ name: "consumer", type: "module" }),
  );
  run("npm", ["install", "--no-audit", "--no-fund", tarball], { cwd: consumer });
  run(
    "node",
    [
      "--input-type=module",
      "-e",
      `import * as sdk from ${JSON.stringify(manifest.name)}; if (typeof sdk.parseOpenRUMDSN !== "function" || typeof sdk.init !== "function") throw new Error("expected exports are missing");`,
    ],
    { cwd: consumer },
  );
  writeFileSync(
    join(consumer, "check.ts"),
    `import { init, type EventV1 } from ${JSON.stringify(manifest.name)};\nexport const probe: EventV1 | undefined = undefined;\nvoid init;\n`,
  );
  run(
    "npx",
    [
      "--yes",
      "--package=typescript@5",
      "tsc",
      "--noEmit",
      "--strict",
      "--module",
      "nodenext",
      "--moduleResolution",
      "nodenext",
      "check.ts",
    ],
    { cwd: consumer },
  );
  console.log(
    `${manifest.name}@${manifest.version} installs from its tarball and its types resolve.`,
  );
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
