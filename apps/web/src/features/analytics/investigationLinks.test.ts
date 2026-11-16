// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { analysisReturnHref, analysisSessionsHref, pathNodeQuery } from "./investigationLinks";

describe("analysis investigation links", () => {
  it("encodes exact filters and preserves range, environment, preview and return context", () => {
    const returnTo = "/projects/p1/analytics/funnels?from=start&to=end";
    const url = new URL(
      analysisSessionsHref(
        "p1",
        { from: "start", to: "end", environment: "production" },
        'session_id = "a/b"',
        returnTo,
        "a/b",
      ),
      "http://localhost",
    );
    expect(url.pathname).toBe("/projects/p1/sessions");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      from: "start",
      to: "end",
      environment: "production",
      q: 'session_id = "a/b"',
      preview: "a/b",
      analysisReturnTo: returnTo,
    });
    expect(analysisReturnHref("p1", url.search)).toBe(returnTo);
  });
  it("emits only supported node filters", () => {
    expect(pathNodeQuery("page:/checkout")).toContain("route");
    expect(pathNodeQuery("navigation:/cart")).toContain("/cart");
    expect(pathNodeQuery("event:purchase")).toContain("event");
    expect(pathNodeQuery("click:Buy now")).toBeUndefined();
  });
  it.each([
    "https://outside.test/projects/p1/analytics",
    "/projects/other/analytics",
    "/settings/account",
    "http://[",
  ])("ignores invalid return destination %s", (value) => {
    expect(
      analysisReturnHref("p1", `?analysisReturnTo=${encodeURIComponent(value)}`),
    ).toBeUndefined();
  });
});
