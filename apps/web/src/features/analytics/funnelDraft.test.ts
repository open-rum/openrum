// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFunnelDraft, rememberFunnelDraft } from "./funnelDraft";

const draft = {
  dimension: "country" as const,
  windowSeconds: 3600 as const,
  steps: [
    { kind: "page_view" as const, name: "page_view" },
    { kind: "custom" as const, name: "purchase" },
  ],
};
beforeEach(() => sessionStorage.clear());
describe("funnel draft restoration", () => {
  it("keeps draft and last run separate and scopes them by project", () => {
    const applied = { ...draft, dimension: "browser" as const };
    rememberFunnelDraft("p1", draft, applied);
    expect(readFunnelDraft("p1")).toEqual({ draft, applied });
    expect(readFunnelDraft("p2")).toBeUndefined();
    expect(sessionStorage.getItem("openrum:funnel:p1")).not.toContain("from");
  });
  it.each(["invalid JSON", JSON.stringify({ draft: { ...draft, steps: [] }, applied: null })])(
    "rejects malformed saved state",
    (value) => {
      sessionStorage.setItem("openrum:funnel:p1", value);
      expect(readFunnelDraft("p1")).toBeUndefined();
    },
  );
  it("continues in memory when browser storage is unavailable", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readFunnelDraft("p1")).toBeUndefined();
    get.mockRestore();
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => rememberFunnelDraft("p1", draft, null)).not.toThrow();
    set.mockRestore();
  });
});
