const timeFormat = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatIssueTrendTime(value: unknown): string {
  // Recharts can briefly have no active tick while data/selection changes.
  if (typeof value !== "number" || !Number.isFinite(value)) return "时间不可用";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "时间不可用" : timeFormat.format(date);
}

export function formatIssueTrendTooltip(
  _label: unknown,
  payload: ReadonlyArray<{ payload?: { timestamp?: unknown } }> = [],
): string {
  // ChartTooltipContent resolves numeric axis labels to the series display
  // name. Read the original point, never parse that display label as a date.
  return formatIssueTrendTime(payload[0]?.payload?.timestamp);
}
