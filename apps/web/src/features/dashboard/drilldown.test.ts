import { describe, expect, it } from "vitest";
import { drilldownURL } from "./drilldown";

const filters = {
  projectId: "018f4d9c-83a1-76c9-81c2-3020ab667090",
  from: new Date("2026-09-02T10:00:00Z"),
  to: new Date("2026-09-02T11:00:00Z"),
  environment: "production",
};

describe("drilldownURL", () => {
  it("links only where the destination reads the value from its address", () => {
    expect(drilldownURL("issues.events", "release", "1.2.0", filters)).toContain(
      "/projects/018f4d9c-83a1-76c9-81c2-3020ab667090/issues?",
    );
    expect(drilldownURL("issues.events", "release", "1.2.0", filters)).toContain("release=1.2.0");
    expect(drilldownURL("api.failureRate", "api", "POST /api/pay", filters)).toContain(
      "method=POST",
    );
    expect(drilldownURL("vitals.lcpP75", "route", "/checkout", filters)).toContain(
      "/projects/018f4d9c-83a1-76c9-81c2-3020ab667090/performance?",
    );
  });

  it("gives no link rather than one that opens an unfiltered page", () => {
    expect(drilldownURL("issues.events", "browser", "Chrome", filters)).toBeUndefined();
    expect(drilldownURL("traffic.pageViews", "route", "/home", filters)).toBeUndefined();
    expect(drilldownURL("issues.events", "release", "unknown", filters)).toBeUndefined();
  });
});
