import type { Context } from "./context.ts";
import { enabled, parseFlags } from "./flags.ts";

const booleanFlags = new Set(["help", "replace"]);

export function sourcemapsHelp(program: string): string {
  return `Usage: ${program} [options]

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
  --help               Show this help`;
}

/** `openrum sourcemaps upload` and the legacy `openrum-sourcemaps` command. */
export async function runSourcemapsUpload(
  args: string[],
  context: Context,
  program: string,
): Promise<number> {
  const flags = parseFlags(args, booleanFlags);
  if (flags.has("help")) {
    context.stdout(`${sourcemapsHelp(program)}\n`);
    return 0;
  }
  const option = (flag: string, environment: string) => flags.get(flag) ?? context.env[environment];
  try {
    await context.upload({
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
      sessionCookie: context.env.OPENRUM_SESSION,
      csrfToken: context.env.OPENRUM_CSRF_TOKEN,
    });
    return 0;
  } catch (error) {
    context.stderr(
      `${error instanceof Error ? error.message : "OpenRUM Source Map upload failed."}\n`,
    );
    return 1;
  }
}
