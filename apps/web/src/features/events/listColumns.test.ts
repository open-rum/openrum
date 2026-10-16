// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { CatalogEntry } from "./catalog";
import {
  defaultColumns,
  defaultSort,
  nextSort,
  perUser,
  readColumns,
  sortEntries,
  writeColumns,
} from "./listColumns";

afterEach(() => window.localStorage.clear());

const entry = (kind: string, name: string, events: number, users: number): CatalogEntry => ({
  kind,
  name,
  metric: {
    events,
    estimated: events,
    uniqueUsers: users,
    uniqueSessions: users,
    approximate: true,
  },
});

describe("column choice", () => {
  it("starts from the default and keeps the event name whatever is saved", () => {
    expect(readColumns()).toEqual(defaultColumns);
    writeColumns(["events", "perUser"]);
    expect(readColumns()).toEqual(["name", "events", "perUser"]);
  });

  it("ignores unknown ids and a saved value that is not a list", () => {
    window.localStorage.setItem("openrum:event-list-columns", JSON.stringify(["nope", "users"]));
    expect(readColumns()).toEqual(["name", "users"]);
    window.localStorage.setItem("openrum:event-list-columns", "{not json");
    expect(readColumns()).toEqual(defaultColumns);
    window.localStorage.setItem("openrum:event-list-columns", JSON.stringify({ a: 1 }));
    expect(readColumns()).toEqual(defaultColumns);
  });

  it("keeps the canonical column order", () => {
    writeColumns(["sessions", "users", "events"]);
    expect(readColumns()).toEqual(["name", "events", "users", "sessions"]);
  });

  it("survives storage that throws", () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error("blocked");
    };
    try {
      expect(readColumns()).toEqual(defaultColumns);
    } finally {
      Storage.prototype.getItem = original;
    }
  });
});

describe("sorting", () => {
  const rows = [
    entry("custom", "b_event", 10, 5),
    entry("click", "click", 50, 10),
    entry("custom", "a_event", 10, 1),
  ];

  it("sorts figures largest first and ties by volume", () => {
    expect(sortEntries(rows, defaultSort).map((row) => row.name)).toEqual([
      "click",
      "b_event",
      "a_event",
    ]);
    expect(sortEntries(rows, { key: "perUser", direction: "desc" }).map((row) => row.name)).toEqual(
      ["a_event", "click", "b_event"],
    );
  });

  it("sorts names by their displayed label", () => {
    const sorted = sortEntries(rows, { key: "name", direction: "asc" }).map((row) => row.name);
    expect(sorted.indexOf("a_event")).toBeLessThan(sorted.indexOf("b_event"));
  });

  it("flips a sorted column and starts a new one in its natural direction", () => {
    expect(nextSort(defaultSort, "events")).toEqual({ key: "events", direction: "asc" });
    expect(nextSort(defaultSort, "name")).toEqual({ key: "name", direction: "asc" });
    expect(nextSort(defaultSort, "users")).toEqual({ key: "users", direction: "desc" });
  });

  it("does not divide by zero users", () => {
    expect(perUser(entry("custom", "x", 5, 0))).toBe(0);
  });
});
