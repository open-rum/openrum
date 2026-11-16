import { describe, expect, it } from "vitest";
import { messageParts, withLogFilter, logColumnValue } from "./logPresentation";
import type { LogEntry } from "@/lib/api/logs";

describe("log message matches", () => {
  const matches = (message: string, query: string) =>
    messageParts(message, query)
      .filter((part) => part.match)
      .map((part) => part.text);
  it("highlights positive message terms with case-sensitive phrase and wildcard semantics", () => {
    expect(matches("Timeout timeout timeout", "timeout AND !Timeout AND logger:timeout")).toEqual([
      "timeout",
      "timeout",
    ]);
    expect(matches("payment failed: timeout", 'message:"payment failed" message:*time*')).toEqual([
      "payment failed",
      "time",
    ]);
    expect(matches("timeout at timeout", "message:time* message:*out")).toEqual(["time", "out"]);
    expect(matches("timeout", "message:[timeout,failed]")).toEqual(["timeout"]);
    expect(matches("a timeout", "message:[timeout,failed]")).toEqual([]);
  });
  it("merges overlapping matches and renders punctuation and HTML as plain text", () => {
    const message = "<b>time.out</b>";
    const parts = messageParts(message, 'message:"time.out" message:out');
    expect(parts.map((part) => part.text).join("")).toBe(message);
    expect(parts.filter((part) => part.match)).toEqual([{ text: "time.out", match: true }]);
  });
});

it("exclusion replaces the opposite equality, preserves other conditions and quotes values", () => {
  expect(
    withLogFilter('level:error attributes.code:"TIMEOUT"', "attributes.code", "TIMEOUT", true),
  ).toBe('level:error AND !attributes.code:"TIMEOUT"');
  expect(withLogFilter('!attributes.code:"TIMEOUT"', "attributes.code", "TIMEOUT")).toBe(
    'attributes.code:"TIMEOUT"',
  );
  expect(withLogFilter('route:"/checkout"', "attributes.message", 'a "quote"')).toBe(
    'route:"/checkout" AND attributes.message:"a \\"quote\\""',
  );
});

it("reads selected fields without confusing captured identity with similarly named attributes", () => {
  const entry: LogEntry = {
    eventId: "13af3016-0096-4e8f-a51b-5a0a6facd321",
    timestamp: "2026-11-11T13:21:31.184Z",
    level: "info",
    message: "test",
    logger: "app",
    environment: "production",
    release: "",
    route: "",
    pageUrl: "",
    browser: "",
    deviceType: "",
    country: "",
    sessionId: "a25753a5-0714-4555-9c99-cd8c20a90722",
    anonymousUserId: "",
    traceId: "",
    spanId: "",
    sampleRate: 1,
    userId: "actual",
    attributes: { "user.id": "custom", code: "0" },
  };
  expect(logColumnValue(entry, "user.id")).toBe("actual");
  expect(logColumnValue(entry, "attributes.user.id")).toBe("custom");
  expect(logColumnValue(entry, "attributes.code")).toBe("0");
  expect(logColumnValue(entry, "attributes.absent")).toBe("");
});
