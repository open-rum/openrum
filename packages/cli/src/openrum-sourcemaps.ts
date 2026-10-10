#!/usr/bin/env node
// The command that shipped with the earlier @openrum/vite-plugin; kept so existing build
// scripts keep working. It is `openrum sourcemaps upload` without the subcommand.
import { runSourcemapsUpload } from "./sourcemaps.ts";
import { processContext } from "./runtime.ts";

process.exitCode = await runSourcemapsUpload(
  process.argv.slice(2),
  processContext(),
  "openrum-sourcemaps",
);
