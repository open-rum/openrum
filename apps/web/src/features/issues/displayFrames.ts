import type { EventDetail } from "@/lib/api/issues";
import { sourceMapFailureLabel } from "./sourceMapFailures";
import { isLibraryPath, parseRawStack, shortScriptPath } from "./stackFrames";

export type OriginalPosition = NonNullable<
  NonNullable<EventDetail["mappedStack"]>["frames"][number]["original"]
>;

export type DisplayFrame = {
  function?: string;
  /** Short path shown in the row; the full script URL or source path is in `location`. */
  file: string;
  location: string;
  line?: number;
  column?: number;
  library: boolean;
  source?: OriginalPosition;
  /** Why a frame in a Source Map result could not be restored. */
  failure?: string;
};

/**
 * One frame list for mapped and raw stacks: Source Map positions when restored, otherwise the
 * minified script position. Newest call first, as browsers report it.
 */
export function displayFrames(event: EventDetail): DisplayFrame[] {
  const mapped = event.mappedStack;
  if (mapped?.frames.length) {
    return mapped.frames.map((frame) => {
      const position = frame.original;
      return {
        function: position?.function || frame.function,
        file: shortScriptPath(position ? position.source : frame.url),
        location: position ? position.source : frame.url,
        line: position?.line ?? frame.line,
        column: position?.column ?? frame.column,
        library: isLibraryPath(position?.source ?? frame.url),
        source: position,
        failure: position
          ? undefined
          : (sourceMapFailureLabel(frame.failure ?? mapped.failure) ?? "未能还原该帧"),
      };
    });
  }
  return parseRawStack(event.originalStack || mapped?.raw).map((frame) => ({
    function: frame.function,
    file: shortScriptPath(frame.url),
    location: frame.url,
    line: frame.line,
    column: frame.column,
    library: frame.library,
  }));
}

/** The innermost application frame, which names the culprit in the Issue header. */
export function culpritFrame(event: EventDetail) {
  const frames = displayFrames(event);
  return frames.find((frame) => !frame.library) ?? frames[0];
}
