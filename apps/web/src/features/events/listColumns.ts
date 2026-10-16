import { eventLabel } from "@/features/analytics/labels";
import { kindLabel, type CatalogEntry } from "./catalog";

export type ColumnId =
  "name" | "kind" | "events" | "share" | "users" | "sessions" | "perUser" | "estimated";

export type ListColumn = {
  id: ColumnId;
  label: string;
  /** Shown in the column picker so a name like "人均次数" says how it is computed. */
  hint?: string;
  /** The event name is the row's identity, so it cannot be hidden. */
  fixed?: boolean;
  /** Text columns sort A to Z first; figures sort largest first. */
  text?: boolean;
};

export const listColumns: ListColumn[] = [
  { id: "name", label: "事件", fixed: true, text: true },
  { id: "kind", label: "类型", text: true },
  { id: "events", label: "次数" },
  { id: "share", label: "占比", hint: "占全部事件次数的比例" },
  { id: "users", label: "用户", hint: "匿名用户，近似去重" },
  { id: "sessions", label: "会话", hint: "会话 ID，近似去重" },
  { id: "perUser", label: "人均次数", hint: "次数 ÷ 用户" },
  { id: "estimated", label: "估算次数", hint: "按事件采样率还原" },
];

export const defaultColumns: ColumnId[] = ["name", "events", "share", "users", "sessions"];

const storageKey = "openrum:event-list-columns";
const known = new Set<string>(listColumns.map((column) => column.id));

/** The saved choice, or the default when nothing valid is saved. Never throws: storage can be blocked. */
export function readColumns(): ColumnId[] {
  try {
    const raw = window.localStorage.getItem(storageKey);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) {
      const chosen = new Set(parsed.filter((id): id is ColumnId => known.has(String(id))));
      chosen.add("name");
      // Keep the canonical order whatever order they were saved in.
      const ordered = listColumns.map((column) => column.id).filter((id) => chosen.has(id));
      if (ordered.length > 1) return ordered;
    }
  } catch {
    // Fall through to the default.
  }
  return defaultColumns;
}

export function writeColumns(columns: ColumnId[]) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(columns));
  } catch {
    // The choice then lasts for this visit only.
  }
}

export type SortState = { key: ColumnId; direction: "asc" | "desc" };

export const defaultSort: SortState = { key: "events", direction: "desc" };

/** Clicking a sorted column flips it; a new column starts in its natural direction. */
export function nextSort(current: SortState, key: ColumnId): SortState {
  if (current.key === key) {
    return { key, direction: current.direction === "asc" ? "desc" : "asc" };
  }
  const column = listColumns.find((item) => item.id === key);
  return { key, direction: column?.text ? "asc" : "desc" };
}

export function perUser(entry: CatalogEntry) {
  return entry.metric.uniqueUsers ? entry.metric.events / entry.metric.uniqueUsers : 0;
}

function sortValue(entry: CatalogEntry, key: ColumnId): string | number {
  switch (key) {
    case "name":
      return eventLabel(entry.kind, entry.name);
    case "kind":
      return kindLabel(entry.kind);
    case "events":
    case "share":
      return entry.metric.events;
    case "users":
      return entry.metric.uniqueUsers;
    case "sessions":
      return entry.metric.uniqueSessions;
    case "perUser":
      return perUser(entry);
    case "estimated":
      return entry.metric.estimated;
  }
}

export function sortEntries(catalog: CatalogEntry[], sort: SortState) {
  const sign = sort.direction === "asc" ? 1 : -1;
  return [...catalog].sort((left, right) => {
    const a = sortValue(left, sort.key);
    const b = sortValue(right, sort.key);
    const order =
      typeof a === "string" && typeof b === "string"
        ? a.localeCompare(b, "zh-CN")
        : Number(a) - Number(b);
    // Ties fall back to volume so equal rows do not shuffle between renders.
    return order * sign || right.metric.events - left.metric.events;
  });
}
