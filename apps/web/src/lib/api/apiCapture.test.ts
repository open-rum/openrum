import { describe, expect, it } from "vitest";
import { apiCaptureHref, splitHeaderNames } from "./apiCapture";

describe("splitHeaderNames", () => {
  it("accepts commas, spaces and newlines, lower-cases, and drops repeats", () => {
    expect(splitHeaderNames("X-Request-Id, accept\n ETag  etag,")).toEqual([
      "x-request-id",
      "accept",
      "etag",
    ]);
  });

  it("returns nothing for blank input", () => {
    expect(splitHeaderNames("")).toEqual([]);
    expect(splitHeaderNames(" , \n ")).toEqual([]);
  });
});

describe("apiCaptureHref", () => {
  it("points at the project's capture settings", () => {
    expect(apiCaptureHref("p 1")).toBe("/settings/project/p%201/api-capture");
  });

  it("carries the endpoint, encoded, so the rule can start from it", () => {
    const href = apiCaptureHref("p1", { method: "GET", url: "https://a.test/orders/:id?x=1" });
    const url = new URL(href, "https://console.test");
    expect(url.pathname).toBe("/settings/project/p1/api-capture");
    expect(url.searchParams.get("method")).toBe("GET");
    expect(url.searchParams.get("url")).toBe("https://a.test/orders/:id?x=1");
  });
});
