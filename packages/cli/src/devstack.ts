import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import type { Context } from "./context.ts";

/** The local-stack commands implemented by `cmd/openrum` in the source repository. */
export const devStackCommands = [
  "dev",
  "up",
  "status",
  "logs",
  "restart",
  "seed",
  "stop",
  "down",
  "reset",
] as const;

const composeFile = join("deploy", "compose", "docker-compose.yml");

/** Walks up from `start` to the directory that holds the OpenRUM compose file, if any. */
export function findRepositoryRoot(start: string): string | undefined {
  let directory = start;
  for (;;) {
    if (existsSync(join(directory, composeFile))) return directory;
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

/** Hands a command to the Go tool, which owns Docker, the host processes and the demo seed. */
export function forwardToGo(root: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn("go", ["run", "./cmd/openrum", ...args], { cwd: root, stdio: "inherit" });
    child.on("error", (error: NodeJS.ErrnoException) => {
      process.stderr.write(
        error.code === "ENOENT"
          ? "openrum: the local stack commands need Go installed (they run `go run ./cmd/openrum`).\n"
          : `openrum: ${error.message}\n`,
      );
      resolve(1);
    });
    child.on("close", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

export async function runDevStack(
  command: string,
  args: string[],
  context: Context,
): Promise<number> {
  const root = findRepositoryRoot(context.cwd);
  if (!root) {
    context.stderr(
      `openrum ${command} manages the local development stack and only works inside a checkout of\n` +
        "https://github.com/open-rum/openrum. Clone it, then run the command from there.\n",
    );
    return 1;
  }
  return context.forward(root, [command, ...args]);
}
