import { currencyPrefix } from "@/lib/currency";
import type { Change } from "./overviewData";

// Values and comparisons only: the overview never colours a change as good or bad.

export function formatCount(value: number | null) {
  return value === null ? "—" : Math.round(value).toLocaleString("zh-CN");
}

/**
 * An amount as the app reported it, labelled with the Project's revenue currency when one
 * was chosen. The label never converts the number.
 */
export function formatAmount(value: number | null, currency = "") {
  if (value === null) return "—";
  const sign = value < 0 ? "-" : "";
  const magnitude = Math.abs(value);
  const digits =
    magnitude >= 10_000
      ? `${(magnitude / 10_000).toFixed(1)}万`
      : magnitude.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
  return `${sign}${currencyPrefix(currency)}${digits}`;
}

export function formatRate(value: number | null, digits: number) {
  return value === null ? "—" : `${(value * 100).toFixed(digits)}%`;
}

export function formatChange(change: Change) {
  if (!change) return "无可比数据";
  const arrow = change.value > 0 ? "↑" : change.value < 0 ? "↓" : "→";
  const size = Math.abs(change.value);
  return change.kind === "points"
    ? `${arrow} ${size.toFixed(2)} 个百分点`
    : `${arrow} ${size.toFixed(1)}%`;
}
