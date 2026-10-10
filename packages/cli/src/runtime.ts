import { uploadSourceMaps } from "@openrum/sourcemap";
import type { Context } from "./context.ts";
import { forwardToGo } from "./devstack.ts";

/** The real process environment for the bin entries. */
export function processContext(): Context {
  return {
    env: process.env,
    cwd: process.cwd(),
    stdout: (text) => void process.stdout.write(text),
    stderr: (text) => void process.stderr.write(text),
    upload: uploadSourceMaps,
    forward: forwardToGo,
  };
}
