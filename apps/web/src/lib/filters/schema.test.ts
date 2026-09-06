import { describe, expect, it } from "vitest";
import { defaultOverviewFilters, parseOverviewFilters, serializeOverviewFilters } from "./schema";

const projectId = "018f4d9c-83a1-76c9-81c2-3020ab660000";

describe("overview URL filters", () => {
  it("round-trips UTC instants and bounded dimensions", () => {
    const source = defaultOverviewFilters(projectId, new Date("2026-09-02T12:34:56+08:00"));
    source.environment = "production";
    source.release = "web-42";
    source.route = "/checkout";
    const encoded = serializeOverviewFilters(source);
    const decoded = parseOverviewFilters(projectId, encoded);
    expect(serializeOverviewFilters(decoded).toString()).toBe(encoded.toString());
    expect(encoded.get("to")).toBe("2026-09-02T04:34:00.000Z");
  });

  it("drops an unsafe cursor and malformed range", () => {
    const decoded = parseOverviewFilters(
      projectId,
      new URLSearchParams({
        from: "2026-01-01T00:00:00Z",
        to: "2026-09-02T00:00:00Z",
        cursor: "../unsafe",
      }),
      new Date("2026-09-02T12:00:00Z"),
    );
    expect(decoded.cursor).toBeUndefined();
    expect(decoded.to.getTime() - decoded.from.getTime()).toBe(24 * 60 * 60 * 1000);
  });
});
