import { describe, expect, it } from "vitest";
import { countryFill, countryMapID, countryMapLabel, mapCountryValues } from "./data";

describe("country map matching", () => {
  it("matches ISO codes to atlas IDs, retaining leading zeroes", () => {
    expect(countryMapID(" cn ")).toBe("156");
    expect(countryMapID("US")).toBe("840");
    expect(countryMapID("AU")).toBe("036");
    expect(countryMapID("GB")).toBe("826");
    expect(countryMapID("FR")).toBe("250");
    expect(countryMapID("SG")).toBe("702");
    expect(countryMapID("HK")).toBe("344");
    expect(countryMapID("ZZ")).toBeUndefined();
    expect(countryMapID("unknown")).toBeUndefined();
    expect(countryMapLabel(" cn ")).toBe("中国 (CN)");
  });
  it("retains unknown/unmapped/duplicate groups without summing distinct users", () => {
    const data = [
      { code: "CN", value: 10 },
      { code: "cn", value: 5 },
      { code: "SG", value: 3 },
      { code: "ZZ", value: 2 },
    ];
    const result = mapCountryValues(data, new Set(["156"]));
    expect(result.mapped.get("156")?.value).toBe(10);
    expect(result.unmapped).toEqual(data.slice(1));
  });
  it("distinguishes returned zero from unreturned data without an invalid scale", () => {
    expect(countryFill(undefined, 100)).toBe("var(--ds-surface-subtle)");
    expect(countryFill(0, 0)).toContain("20%");
    expect(countryFill(100, 100)).toContain("100%");
    expect(countryFill(50, 100)).toContain("60%");
  });
});
