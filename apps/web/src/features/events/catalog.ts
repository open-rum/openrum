import type { BehaviorAnalyticsResponse } from "@/lib/api/analytics";
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

const dayMilliseconds = 24 * 60 * 60 * 1000;

/**
 * Raw samples are capped at 24 hours to bound the scan, even when the trend covers a
 * longer range. Say which window the table actually shows instead of implying the whole
 * range.
 */
export function sampleWindowLabel(from: Date, to: Date) {
  return to.getTime() - from.getTime() > dayMilliseconds
    ? "所选范围的最后 24 小时"
    : "所选时间范围内";
}

export function shortID(value: string) {
  return `${value.slice(0, 8)}…`;
}

export function attributePreview(attributes: Record<string, string>, limit = 2) {
  const entries = Object.entries(attributes);
  return { shown: entries.slice(0, limit), hidden: Math.max(0, entries.length - limit) };
}
