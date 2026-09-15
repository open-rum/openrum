import type { LogEvent, LogLevel } from "@openrum/protocol";
import { sanitizeAttributes, scrubText } from "./privacy/scrub.ts";
import type { Diagnostics } from "./safety.ts";

export const logLevels = ["trace", "debug", "info", "warn", "error", "fatal"] as const;
export type LogAttributes = Record<string, string | number | boolean>;
export type LogInput = Pick<LogEvent, "level" | "message" | "logger" | "attributes">;
export type Logger = Record<LogLevel, (message: string, attributes?: LogAttributes) => void>;

export function createLogger(capture: (input: LogInput) => void): Logger {
  return Object.fromEntries(
    logLevels.map((level) => [
      level,
      (message: string, attributes?: LogAttributes) =>
        capture({
          level,
          message,
          attributes: attributes as Record<string, string> | undefined,
        }),
    ]),
  ) as Logger;
}

/** Bounded, primitive-only attributes; do not invoke arbitrary object getters or toJSON. */
export function sanitizeLog(input: LogInput, diagnostics: Diagnostics): LogInput | undefined {
  if (
    !input ||
    !logLevels.includes(input.level) ||
    typeof input.message !== "string" ||
    !input.message.trim()
  ) {
    diagnostics.droppedEvents += 1;
    return undefined;
  }
  const attributes: Record<string, string> = Object.create(null);
  if (input.attributes && typeof input.attributes === "object") {
    for (const key of Object.keys(input.attributes).slice(0, 20)) {
      const descriptor = Object.getOwnPropertyDescriptor(input.attributes, key);
      const value: unknown = descriptor?.value;
      if (
        typeof value === "string" ||
        typeof value === "boolean" ||
        (typeof value === "number" && Number.isFinite(value))
      ) {
        attributes[key] = scrubText(String(value).slice(0, 512)).slice(0, 512);
      }
    }
  }
  return {
    level: input.level,
    message: scrubText(input.message.slice(0, 4096)).slice(0, 4096),
    ...(typeof input.logger === "string"
      ? { logger: scrubText(input.logger.slice(0, 80)).slice(0, 80) }
      : {}),
    attributes: sanitizeAttributes(attributes, diagnostics),
  };
}
