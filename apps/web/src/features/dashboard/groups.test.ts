import { describe, expect, it } from "vitest";
import {
  mergeBlocks,
  mergeTargets,
  moveBlock,
  normalizeGroups,
  resizeBlock,
  splitFromGroup,
  toBlocks,
} from "./groups";
import { createWidget, type StoredWidget } from "./model";

const chart = (id: string, extra: Partial<StoredWidget> = {}): StoredWidget =>
  ({ ...createWidget("timeseries"), id, title: id, ...extra }) as StoredWidget;
const stat = (id: string): StoredWidget =>
  ({ ...createWidget("stat"), id, title: id }) as StoredWidget;
const ids = (widgets: StoredWidget[]) => toBlocks(widgets).map((b) => b.records.map((r) => r.id));

describe("tabbed cards", () => {
  it("merges a card into another as tabs at the target's size", () => {
    const widgets = [chart("a", { size: "full" }), stat("s"), chart("b", { size: "half" })];
    const merged = mergeBlocks(widgets, "b", "a");
    expect(ids(merged)).toEqual([["a", "b"], ["s"]]);
    expect(merged.filter((w) => w.groupId).map((w) => w.size)).toEqual(["full", "full"]);
  });

  it("offers only charts and tables, and never more than three tabs", () => {
    const widgets = [chart("a"), chart("b"), stat("s")];
    expect(mergeTargets(widgets, "a").map((b) => b.key)).toEqual(["b"]);
    expect(mergeTargets(widgets, "s")).toEqual([]);
    const three = mergeBlocks(
      mergeBlocks([...widgets, chart("c"), chart("d")], "b", "a"),
      "c",
      "a",
    );
    expect(ids(three)[0]).toEqual(["a", "b", "c"]);
    expect(mergeTargets(three, "d").map((b) => b.key)).not.toContain("a");
  });

  it("splits a tab out right after its card and dissolves a lone remainder", () => {
    const grouped = mergeBlocks([chart("a"), chart("b"), chart("c")], "b", "a");
    const split = splitFromGroup(grouped, "b");
    expect(ids(split)).toEqual([["a"], ["b"], ["c"]]);
    expect(split.some((w) => w.groupId)).toBe(false);
  });

  it("moves and resizes whole cards", () => {
    const grouped = mergeBlocks([chart("a"), chart("b"), chart("c")], "b", "a");
    expect(ids(moveBlock(grouped, "c", "a"))).toEqual([["c"], ["a", "b"]]);
    expect(
      resizeBlock(grouped, "a", "third")
        .slice(0, 2)
        .map((w) => w.size),
    ).toEqual(["third", "third"]);
  });

  it("repairs invalid groups before saving", () => {
    const widgets = [
      chart("a", { groupId: "g", size: "half" }),
      chart("b", { groupId: "g", size: "full" }),
      chart("c"),
      chart("d", { groupId: "g" }),
      chart("e", { groupId: "lonely" }),
    ];
    const normalized = normalizeGroups(widgets);
    expect(ids(normalized)).toEqual([["a", "b"], ["c"], ["d"], ["e"]]);
    expect(normalized[1].size).toBe("half");
    expect(normalized[3].groupId).toBeUndefined();
    expect(normalized[4].groupId).toBeUndefined();
  });
});
