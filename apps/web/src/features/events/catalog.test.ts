import { describe, expect, it } from "vitest";
import { attributePreview, sampleWindowLabel, sortCatalog, type CatalogEntry } from "./catalog";

const metric = (events: number, uniqueUsers: number) => ({
  events,
  estimated: events,
  uniqueUsers,
  uniqueSessions: uniqueUsers,
  approximate: false,
});
const catalog: CatalogEntry[] = [
  { kind: "click", name: "checkout.submit", metric: metric(40, 30) },
  { kind: "page_view", name: "page_view", metric: metric(900, 200) },
  { kind: "custom", name: "order_completed", metric: metric(15, 15) },
];

describe("event catalog sorting", () => {
  it("ranks by volume by default and by users on request, without mutating the input", () => {
    expect(sortCatalog(catalog, "events").map((entry) => entry.name)).toEqual([
      "page_view",
      "checkout.submit",
      "order_completed",
    ]);
    expect(sortCatalog(catalog, "users")[0]?.name).toBe("page_view");
    expect(catalog[0]?.name).toBe("checkout.submit");
  });

  it("sorts by the label the reader sees", () => {
    const names = sortCatalog(catalog, "name").map((entry) => entry.name);
    expect([...names].sort()).toHaveLength(3);
    expect(names).toContain("page_view");
  });
});

describe("sample window", () => {
  const to = new Date("2026-09-03T12:00:00Z");
  it("says so when the trend range is wider than the sample cap", () => {
    expect(sampleWindowLabel(new Date("2026-08-27T12:00:00Z"), to)).toContain("最后 24 小时");
  });
  it("describes the whole range when it fits", () => {
    expect(sampleWindowLabel(new Date("2026-09-03T06:00:00Z"), to)).toBe("所选时间范围内");
  });
});

describe("attribute preview", () => {
  it("shows the first attributes and counts the rest", () => {
    expect(attributePreview({ a: "1", b: "2", c: "3" })).toEqual({
      shown: [
        ["a", "1"],
        ["b", "2"],
      ],
      hidden: 1,
    });
    expect(attributePreview({})).toEqual({ shown: [], hidden: 0 });
  });
});
