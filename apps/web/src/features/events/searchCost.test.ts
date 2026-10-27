import { describe, expect, it } from "vitest";
import { HTTPError } from "@/lib/auth/session";
import { rollupSplit, tooExpensive } from "./searchCost";

describe("search cost", () => {
  it("names the split that lets one condition read the rollup", () => {
    expect(rollupSplit("device:mobile")).toEqual({ dimension: "device", label: "按设备拆分" });
    expect(rollupSplit("country:[CN,US]")?.dimension).toBe("country");
    expect(rollupSplit("attributes.plan:pro")).toEqual({
      dimension: "property:plan",
      label: "按属性 plan 拆分",
    });
  });

  it("offers nothing when the rollup cannot answer the search", () => {
    expect(rollupSplit("route:/checkout")).toBeUndefined();
    expect(rollupSplit("!device:mobile")).toBeUndefined();
    expect(rollupSplit("browser:*Chrome*")).toBeUndefined();
    expect(rollupSplit("device:mobile AND country:CN")).toBeUndefined();
    expect(rollupSplit("")).toBeUndefined();
  });

  it("only treats a refused search as too expensive", () => {
    const refused = new HTTPError(422, "QUERY_TOO_EXPENSIVE", "r1", "too much");
    expect(tooExpensive(refused, "device:mobile")).toBe(true);
    expect(tooExpensive(refused, "")).toBe(false);
    expect(tooExpensive(new HTTPError(503, "QUERY_UNAVAILABLE", "r2", "down"), "x:1")).toBe(false);
  });
});
