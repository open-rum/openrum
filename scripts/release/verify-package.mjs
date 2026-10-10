// Packs an npm package and installs the tarball into an empty project, the way a user would.
// The workspace hides a broken package: a private dependency such as @openrum/protocol
// resolves locally but not from npm, so only a clean install proves the tarball works.
// Usage: node scripts/release/verify-package.mjs packages/browser-sdk
// Run after `pnpm --filter <package> build`.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const directoryArgument = process.argv[2];
if (!directoryArgument)
  throw new Error("Usage: node scripts/release/verify-package.mjs <package directory>");
const packageDirectory = isAbsolute(directoryArgument)
  ? directoryArgument
  : resolve(root, directoryArgument);
const manifest = JSON.parse(readFileSync(join(packageDirectory, "package.json"), "utf8"));
const workspace = mkdtempSync(join(tmpdir(), "openrum-package-"));
const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    stdio: ["ignore", "pipe", "inherit"],
    encoding: "utf8",
    ...options,
  });

// What each package must do once installed. `imports` run in plain Node; `types` is a
// TypeScript file that must compile against the installed declarations; `commands` run the
// installed bins.
const smoke = {
  "@openrum/browser": {
    required: ["dist/index.js", "dist/index.d.ts"],
    imports: [["@openrum/browser", ["init", "parseOpenRUMDSN"]]],
    types:
      'import { init, type EventV1 } from "@openrum/browser";\nexport const probe: EventV1 | undefined = undefined;\nvoid init;\n',
  },
  "@openrum/source-map": {
    // `@openrum/source-map/vite` has `vite` as an optional peer; a Vite user always has it.
    alongside: ["vite@6", "@types/node@24"],
    required: ["dist/index.js", "dist/index.d.ts", "dist/vite.js", "dist/vite.d.ts"],
    imports: [
      ["@openrum/source-map", ["uploadSourceMaps", "normalizeUrlPrefix"]],
      ["@openrum/source-map/vite", ["openRUMSourceMaps"]],
    ],
    types:
      'import { uploadSourceMaps, type OpenRUMSourceMapOptions } from "@openrum/source-map";\nimport { openRUMSourceMaps } from "@openrum/source-map/vite";\nexport const options: OpenRUMSourceMapOptions | undefined = undefined;\nvoid uploadSourceMaps;\nvoid openRUMSourceMaps;\n',
  },
  "@openrum/cli": {
    required: ["dist/openrum.js", "dist/openrum-sourcemaps.js"],
    commands: [
      ["openrum", ["--version"], (output) => output.trim() === manifest.version],
      ["openrum", ["sourcemaps", "upload", "--help"], (output) => output.includes("--project-id")],
      ["openrum-sourcemaps", ["--help"], (output) => output.includes("Usage: openrum-sourcemaps")],
    ],
  },
};

try {
  const checks = smoke[manifest.name];
  if (!checks) throw new Error(`No smoke test is defined for ${manifest.name}`);
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
  for (const required of [...checks.required, "README.md"])
    if (!listing.includes(`package/${required}`)) throw new Error(`tarball is missing ${required}`);

  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify({ name: "consumer", type: "module" }),
  );
  run("npm", ["install", "--no-audit", "--no-fund", tarball, ...(checks.alongside ?? [])], {
    cwd: consumer,
  });

  for (const [specifier, names] of checks.imports ?? []) {
    run(
      "node",
      [
        "--input-type=module",
        "-e",
        `const m = await import(${JSON.stringify(specifier)}); for (const name of ${JSON.stringify(names)}) if (typeof m[name] !== "function") throw new Error(${JSON.stringify(specifier)} + " does not export " + name);`,
      ],
      { cwd: consumer },
    );
  }
  for (const [command, args, accepts] of checks.commands ?? []) {
    const output = run(join(consumer, "node_modules", ".bin", command), args, { cwd: consumer });
    if (!accepts(output))
      throw new Error(
        `\`${command} ${args.join(" ")}\` printed unexpected output: ${output.slice(0, 200)}`,
      );
  }
  if (checks.types) {
    writeFileSync(join(consumer, "check.ts"), checks.types);
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
  }
  console.log(
    `${manifest.name}@${manifest.version} installs from its tarball and works as a user would use it.`,
  );
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
