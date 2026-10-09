const relative = new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" });
const shortDate = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "刚刚", "3 分钟前", "5 小时前", "2 天前"; older than a week falls back to a short date. */
export function formatRelativeTime(value: string, now = Date.now()) {
  const elapsed = now - new Date(value).getTime();
  if (elapsed < MINUTE) return "刚刚";
  if (elapsed < HOUR) return relative.format(-Math.floor(elapsed / MINUTE), "minute");
  if (elapsed < DAY) return relative.format(-Math.floor(elapsed / HOUR), "hour");
  if (elapsed < 7 * DAY) return relative.format(-Math.floor(elapsed / DAY), "day");
  return shortDate.format(new Date(value));
}

export function formatAbsoluteTime(value: string) {
  return new Date(value).toLocaleString("zh-CN");
}

/** An Issue first seen inside the analysed range is new to that range. */
export function isNewInRange(firstSeenAt: string, from: Date) {
  return new Date(firstSeenAt).getTime() >= from.getTime();
}
