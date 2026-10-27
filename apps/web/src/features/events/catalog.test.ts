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
  const range = { from: new Date("2026-08-27T12:00:00Z"), to: new Date("2026-09-03T12:00:00Z") };
  it("names the day before the event last occurred when the server read a part", () => {
    const label = sampleWindowLabel(range, {
      from: "2026-08-30T08:41:00Z",
      to: "2026-08-31T08:41:00Z",
    });
    expect(label).toContain("最后一次出现");
    expect(label).toContain("前 24 小时内");
  });
  it("describes the whole range when the samples cover it", () => {
    expect(
      sampleWindowLabel(range, { from: range.from.toISOString(), to: range.to.toISOString() }),
    ).toBe("所选时间范围内");
    expect(sampleWindowLabel(range)).toBe("所选时间范围内");
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
