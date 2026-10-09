// Number, time and dimension formatting shared by the behavior analysis and the
// Events page, so both read the same figure the same way.

export function formatCompact(value: number) {
  return new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 2 }).format(
    value,
  );
}

export function formatPercent(value: number, total: number) {
  return total ? `${((value / total) * 100).toFixed(1)}%` : "—";
}

export function formatRelative(seconds: number | null) {
  if (seconds === null) return "未知";
  if (seconds < 60) return `${Math.round(seconds)} 秒前`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} 分钟前`;
  return `${Math.round(seconds / 3600)} 小时前`;
}

export function dimensionLabel(value: string) {
  if (value === "country") return "国家";
  if (value === "device") return "设备";
  if (value === "browser") return "浏览器";
  if (value === "source") return "来源";
  return `属性 ${value.slice(9)}`;
}

export function displayDimension(value: string, dimension: string) {
  if (dimension === "country")
    return (
      ({ CN: "中国", US: "美国", JP: "日本", SG: "新加坡", DE: "德国" } as Record<string, string>)[
        value
      ] ?? value
    );
  return value === "unknown" ? "未知" : value === "direct" ? "直接访问" : value;
}
