#!/usr/bin/env node
import { uploadSourceMaps } from "./index.js";

const booleanFlags = new Set(["help", "replace"]);
const argumentsMap = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index] ?? "";
  if (!argument.startsWith("--")) continue;
  const [key, inline] = argument.slice(2).split(/=(.*)/s, 2) as [string, string | undefined];
  if (!key) continue;
  if (inline !== undefined) argumentsMap.set(key, inline);
  else if (booleanFlags.has(key)) argumentsMap.set(key, "true");
  else {
    const value = process.argv[index + 1];
    if (value !== undefined && !value.startsWith("--")) {
      argumentsMap.set(key, value);
      index += 1;
    }
  }
}

if (argumentsMap.has("help")) {
  console.log(`Usage: openrum-sourcemaps [options]

Uploads hidden Source Maps from a build directory to an OpenRUM Release, then
removes the .map files and their sourceMappingURL comments from the build.

Options (environment variable in brackets):
  --base-url URL       OpenRUM API origin            [OPENRUM_BASE_URL]
  --project-id ID      Project ID                    [OPENRUM_PROJECT_ID]
  --release VERSION    Release; must match SDK init  [OPENRUM_RELEASE]
  --dist NAME          Dist; must match SDK init     [OPENRUM_DIST]
  --commit-sha SHA     Commit recorded on the Release [OPENRUM_COMMIT_SHA]
  --out-dir DIR        Build output (default: dist)  [OPENRUM_OUT_DIR]
  --url-prefix PATH    URL path before the build-relative file path,
                       for example static/app/       [OPENRUM_URL_PREFIX]
  --replace            Overwrite existing maps with different contents
                                                     [OPENRUM_REPLACE=true]
  --token TOKEN        Source Map upload token; prefer the environment
                       variable so it stays out of process lists
                                                     [OPENRUM_UPLOAD_TOKEN]
  --help               Show this help`);
  process.exit(0);
}

function option(flag: string, environment: string): string | undefined {
  return argumentsMap.get(flag) ?? process.env[environment];
}

function enabled(value: string | undefined): boolean {
  return value !== undefined && /^(?:1|true|yes)$/i.test(value);
}

try {
  await uploadSourceMaps({
    baseUrl: option("base-url", "OPENRUM_BASE_URL") ?? "",
    projectId: option("project-id", "OPENRUM_PROJECT_ID") ?? "",
    release: option("release", "OPENRUM_RELEASE") ?? "",
    dist: option("dist", "OPENRUM_DIST"),
    commitSha: option("commit-sha", "OPENRUM_COMMIT_SHA"),
    outDir: option("out-dir", "OPENRUM_OUT_DIR"),
    urlPrefix: option("url-prefix", "OPENRUM_URL_PREFIX"),
    replace: enabled(option("replace", "OPENRUM_REPLACE")),
    token: option("token", "OPENRUM_UPLOAD_TOKEN") || undefined,
    // Deprecated Console session fallback.
    sessionCookie: process.env.OPENRUM_SESSION,
    csrfToken: process.env.OPENRUM_CSRF_TOKEN,
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : "OpenRUM Source Map upload failed.");
  process.exitCode = 1;
}
