const axis = new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" });
const tooltip = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatTrendDate(value: unknown, detailed = false) {
  if (typeof value !== "string" && typeof value !== "number") return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return (detailed ? tooltip : axis).format(date);
}
