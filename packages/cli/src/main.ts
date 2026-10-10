import pkg from "../package.json" with { type: "json" };
import type { Context } from "./context.ts";
import { devStackCommands, runDevStack } from "./devstack.ts";
import { runSourcemapsUpload, sourcemapsHelp } from "./sourcemaps.ts";

export function usage(): string {
  return `Usage: openrum <command> [options]

Commands:
  sourcemaps upload   Upload hidden Source Maps from a build to an OpenRUM Release
  help                Show this help
  --version           Print the version

Local development stack (only inside a checkout of github.com/open-rum/openrum):
  ${devStackCommands.join("  ")}

Run \`openrum sourcemaps upload --help\` for the upload options.`;
}

/** Runs one command line and returns the process exit code. */
export async function main(argv: string[], context: Context): Promise<number> {
  const [command, ...rest] = argv;
  if (command === undefined || command === "help" || command === "--help" || command === "-h") {
    context.stdout(`${usage()}\n`);
    return command === undefined ? 2 : 0;
  }
  if (command === "--version" || command === "-v" || command === "version") {
    context.stdout(`${pkg.version}\n`);
    return 0;
  }
  if (command === "sourcemaps") {
    const [subcommand, ...options] = rest;
    if (subcommand === "upload")
      return runSourcemapsUpload(options, context, "openrum sourcemaps upload");
    if (
      subcommand === undefined ||
      subcommand === "--help" ||
      subcommand === "-h" ||
      subcommand === "help"
    ) {
      context.stdout(`${sourcemapsHelp("openrum sourcemaps upload")}\n`);
      return subcommand === undefined ? 2 : 0;
    }
    context.stderr(
      `openrum: unknown sourcemaps command "${subcommand}"; try \`openrum sourcemaps upload\`\n`,
    );
    return 2;
  }
  if ((devStackCommands as readonly string[]).includes(command)) {
    return runDevStack(command, rest, context);
  }
  context.stderr(`openrum: unknown command "${command}"\n\n${usage()}\n`);
  return 2;
}
