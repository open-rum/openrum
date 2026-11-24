import { describe, expect, it } from "vitest";
import { validateProjectOrigins } from "./projectOrigins";

describe("project origin validation", () => {
  it("normalizes case, preserves ports and removes duplicate origins", () => {
    expect(
      validateProjectOrigins(
        " https://EXAMPLE.com \nhttps://example.com\nhttp://localhost:4173\nhttp://[::1]:3000\nhttps://example.com:443",
      ),
    ).toEqual({
      origins: [
        "https://example.com",
        "http://localhost:4173",
        "http://[::1]:3000",
        "https://example.com:443",
      ],
      issues: [],
    });
  });

  it("suggests origins without silently accepting pasted full URLs", () => {
    const result = validateProjectOrigins(
      "\nhttps://example.com/path?q=test#section\nhttp://localhost:4173/",
    );
    expect(result.origins).toEqual([]);
    expect(result.issues.map(({ line, suggestion }) => ({ line, suggestion }))).toEqual([
      { line: 2, suggestion: "https://example.com" },
      { line: 3, suggestion: "http://localhost:4173" },
    ]);
  });

  it.each([
    "example.com",
    "*",
    "https://*.example.com",
    "ftp://example.com",
    "https://user:secret@example.com",
    "https://@example.com",
    "https://example.com:abc",
    "https://exa mple.com",
    "https://example.com\\path",
  ])("rejects invalid address %s without a suggestion", (value) => {
    const { issues, origins } = validateProjectOrigins(value);
    expect(origins).toEqual([]);
    expect(issues).toHaveLength(1);
    expect(issues[0].suggestion).toBeUndefined();
  });

  it("requires a site and enforces the server's entry limit", () => {
    expect(validateProjectOrigins(" \n ").issues[0].line).toBe(0);
    expect(
      validateProjectOrigins(Array(65).fill("https://example.com").join("\n")).issues[0].message,
    ).toContain("64");
  });
});
