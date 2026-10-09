export type RawStackFrame = {
  function?: string;
  url: string;
  line?: number;
  column?: number;
  /** Frames from dependencies or the browser rather than the application's own code. */
  library: boolean;
};

// Chrome / Edge: "    at fn (url:1:2)" or "    at url:1:2".
const v8Frame = /^\s*at\s+(?:(.+?)\s+\()?(.+?)(?::(\d+))?(?::(\d+))?\)?\s*$/;
// Firefox / Safari: "fn@url:1:2" or "@url:1:2".
const geckoFrame = /^\s*(.*?)@(.+?)(?::(\d+))?(?::(\d+))?\s*$/;
const libraryPath =
  /\/node_modules\/|^node_modules\/|\/\.vite\/deps\/|\/vendor[-./]|chunk-[A-Z0-9]{6,}|^(?:native|<anonymous>)$|^(?:chrome|moz|safari)-extension:/i;

/** Dependency, browser or extension code rather than the application's own source. */
export function isLibraryPath(path: string) {
  return libraryPath.test(path);
}

/**
 * Splits a raw browser stack into frames for display when no Source Map result exists.
 * Lines that are not frames (the message, "eval" noise) are skipped; the raw text stays
 * available beside this view.
 */
export function parseRawStack(stack: string | undefined): RawStackFrame[] {
  if (!stack) return [];
  const frames: RawStackFrame[] = [];
  for (const line of stack.split("\n")) {
    const match = /^\s*at\s/.test(line)
      ? v8Frame.exec(line)
      : line.includes("@")
        ? geckoFrame.exec(line)
        : null;
    if (!match) continue;
    const [, name, url, lineNumber, column] = match;
    if (!url) continue;
    frames.push({
      function: name?.trim() || undefined,
      url,
      line: lineNumber ? Number(lineNumber) : undefined,
      column: column ? Number(column) : undefined,
      library: isLibraryPath(url),
    });
  }
  return frames;
}

/** "https://cdn.example.com/assets/app-1a2b.js" → "assets/app-1a2b.js". */
export function shortScriptPath(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.pathname.replace(/^\//, "") || parsed.host;
  } catch {
    return url;
  }
}
