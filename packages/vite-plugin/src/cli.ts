#!/usr/bin/env node
import { uploadSourceMaps } from "./index.js";

const argumentsMap = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index]?.replace(/^--/, "");
  const value = process.argv[index + 1];
  if (!key) continue;
  if (key === "help") argumentsMap.set(key, "true");
  else if (value && !value.startsWith("--")) {
    argumentsMap.set(key, value);
    index += 1;
  }
}

if (argumentsMap.has("help")) {
  console.log(
    "openrum-sourcemaps --base-url URL --project-id ID --release VERSION --out-dir dist [--dist browser] [--commit-sha SHA]",
  );
  process.exit(0);
}

try {
  const result = await uploadSourceMaps({
    baseUrl: argumentsMap.get("base-url") ?? process.env.OPENRUM_BASE_URL ?? "",
    projectId: argumentsMap.get("project-id") ?? process.env.OPENRUM_PROJECT_ID ?? "",
    release: argumentsMap.get("release") ?? process.env.OPENRUM_RELEASE ?? "",
    dist: argumentsMap.get("dist") ?? process.env.OPENRUM_DIST,
    commitSha: argumentsMap.get("commit-sha") ?? process.env.OPENRUM_COMMIT_SHA,
    outDir: argumentsMap.get("out-dir") ?? process.env.OPENRUM_OUT_DIR,
    sessionCookie: process.env.OPENRUM_SESSION ?? "",
    csrfToken: process.env.OPENRUM_CSRF_TOKEN ?? "",
  });
  console.log(`OpenRUM uploaded ${result.uploaded} hidden Source Map(s).`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "OpenRUM Source Map upload failed.");
  process.exitCode = 1;
}
