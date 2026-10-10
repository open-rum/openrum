import type { OpenRUMSourceMapOptions, SourceMapUploadResult } from "@openrum/source-map";

/** Everything the commands touch outside their own logic, so tests can replace it. */
export type Context = {
  env: Record<string, string | undefined>;
  cwd: string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  upload: (options: OpenRUMSourceMapOptions) => Promise<SourceMapUploadResult>;
  /** Runs the Go development-stack tool from the repository root; resolves to its exit code. */
  forward: (root: string, args: string[]) => Promise<number>;
};
