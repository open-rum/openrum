import type { BehaviorAnalyticsResponse } from "@/lib/api/analytics";
import { formatCompact } from "@/features/analytics/format";
import { eventLabel } from "@/features/analytics/labels";

export type CatalogEntry = BehaviorAnalyticsResponse["catalog"][number];
export type CatalogSortKey = "events" | "users" | "name";

export function kindLabel(value: string) {
  return (
    (
      {
        page_view: "页面访问",
        navigation: "页面导航",
        click: "元素点击",
        custom: "自定义事件",
      } as Record<string, string>
    )[value] ?? value
  );
}

export function sortCatalog(catalog: CatalogEntry[], sort: CatalogSortKey) {
  return [...catalog].sort((left, right) => {
    if (sort === "name")
      return eventLabel(left.kind, left.name).localeCompare(eventLabel(right.kind, right.name));
    const key = sort === "users" ? "uniqueUsers" : "events";
    return right.metric[key] - left.metric[key];
  });
}

/**
 * Raw samples are read from one day at most. A longer range reads the day before the event
 * last occurred, which the server reports as the window; say which stretch the list shows
 * instead of implying the whole range.
 */
export function sampleWindowLabel(
  range: { from: Date; to: Date },
  window?: { from: string; to: string },
) {
  if (!window) return "所选时间范围内";
  const from = new Date(window.from);
  const to = new Date(window.to);
  if (from.getTime() <= range.from.getTime() && to.getTime() >= range.to.getTime())
    return "所选时间范围内";
  const last = new Date(to.getTime() - 60 * 1000).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `最后一次出现（${last}）前 24 小时内`;
}

export function shortID(value: string) {
  return `${value.slice(0, 8)}…`;
}

export function attributePreview(attributes: Record<string, string>, limit = 2) {
  const entries = Object.entries(attributes);
  return { shown: entries.slice(0, limit), hidden: Math.max(0, entries.length - limit) };
}

/** How far sampling moves the estimate, said only when it is large enough to matter. */
export function samplingNote(events: number, estimated: number) {
  if (events === 0 || Math.abs(estimated - events) / events < 0.01) return undefined;
  return `按采样率还原约 ${formatCompact(estimated)}`;
}
