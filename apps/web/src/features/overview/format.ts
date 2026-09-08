const bucketTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

// Buckets come back as UTC boundaries and the series is compared against
// UTC-aligned KPIs, so the labels stay in UTC rather than the viewer's zone.
export function bucketFormatter(value: string) {
  return bucketTimeFormatter.format(new Date(value));
}

export function compactCount(value: number) {
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
  return `${value}`;
}

export function formatRate(value: number | null) {
  return value === null ? "—" : `${(value * 100).toFixed(2)}%`;
}
