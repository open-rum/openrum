import { describe, expect, it } from "vitest";
import { highlightSnippet } from "./highlightSnippet";

describe("SDK snippet highlighting", () => {
  it("preserves source text including quoted URLs, escapes and HTML", () => {
    const source = `<script src="https://example.com/sdk.js"></script>\n// init\nimport { init } from "@openrum/browser";\ninit({ dsn: "https://key@example.com/ingest", value: 'it\\'s fine', enabled: true });`;
    const tokens = highlightSnippet(source);
    expect(tokens.map((token) => token.text).join("")).toBe(source);
    expect(tokens.find((token) => token.text === '"https://key@example.com/ingest"')?.kind).toBe(
      "string",
    );
    expect(tokens.some((token) => token.kind === "tag")).toBe(true);
    expect(tokens.some((token) => token.kind === "function" && token.text === "init")).toBe(true);
    expect(tokens.some((token) => token.kind === "property" && token.text === "dsn")).toBe(true);
  });
});
