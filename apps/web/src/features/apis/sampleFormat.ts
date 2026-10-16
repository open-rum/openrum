import type { APISample } from "@/lib/api/apis";

/** How a request ended, in words: the status class, or why there was no response. */
export type LoadState = { label: string; tone: "ok" | "warning" | "danger" };

const failureLabels: Record<string, string> = {
  network: "网络错误，没有收到响应",
  timeout: "请求超时",
  abort: "请求被取消",
  http: "服务端返回错误",
};

export function failureLabel(failure: string | undefined) {
  return failure ? (failureLabels[failure] ?? failure) : undefined;
}

export function loadState(sample: Pick<APISample, "status" | "failure">): LoadState {
  if (sample.failure === "network" || sample.failure === "timeout") {
    return { label: failureLabels[sample.failure].split("，")[0], tone: "danger" };
  }
  if (sample.failure === "abort") return { label: "已取消", tone: "warning" };
  if (sample.status >= 500) return { label: "服务端错误", tone: "danger" };
  if (sample.status >= 400) return { label: "客户端错误", tone: "warning" };
  if (!sample.status) return { label: "没有响应", tone: "danger" };
  return { label: "成功", tone: "ok" };
}

/** The status column of a list row: the code, or what happened instead of one. */
export function statusText(sample: Pick<APISample, "status" | "failure">) {
  if (sample.status) return String(sample.status);
  return sample.failure ?? "无响应";
}

/** "iOS 18.7": the system and its version, whichever the SDK reported. */
export function versioned(name: string | undefined, version: string | undefined) {
  if (!name) return undefined;
  return version ? `${name} (${version})` : name;
}

/** A readable stand-in for an ID in a narrow list; the full value is always available on hover. */
export function shortId(value: string, length = 12) {
  return value.length > length ? `${value.slice(0, length)}…` : value;
}

/** Who made the request, as the list shows it: the signed-in ID when there is one. */
export function personOf(sample: Pick<APISample, "userId" | "anonymousUserId">) {
  return sample.userId || sample.anonymousUserId || "";
}

const stamp = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

/** 2026-10-12 19:07:34, in the viewer's time zone. */
export function formatStamp(value: string) {
  return stamp.format(new Date(value)).replace(/\//g, "-");
}

/** Where a request's time sits among the endpoint's percentiles. */
export function durationPosition(
  durationMs: number,
  percentiles: { p50: number | null; p75: number | null; p95: number | null },
) {
  const reference = percentiles.p95 ?? percentiles.p75 ?? percentiles.p50;
  if (reference === null || reference <= 0) return undefined;
  // The scale runs a little past P95, or to the request itself when it is slower than that.
  const ceiling = Math.max(reference * 1.25, durationMs);
  const at = (value: number | null) => (value === null ? undefined : (value / ceiling) * 100);
  return {
    request: Math.min(100, (durationMs / ceiling) * 100),
    p50: at(percentiles.p50),
    p75: at(percentiles.p75),
    p95: at(percentiles.p95),
    slowerThanP95: percentiles.p95 !== null && durationMs > percentiles.p95,
  };
}

const truncatedMarker = "…[truncated]";
const omittedBody = "[omitted: body larger than 64 KB]";

/** A body as the detail pane shows it, with what to tell the reader about it. */
export type BodyView = { text: string; notes: string[] };

/**
 * Prepares a stored body for reading. The text is shown as stored, except that JSON the
 * SDK or Consumer wrote compactly is indented; a body that would change when re-serialized is
 * left alone, so what is shown never differs from what was recorded.
 */
export function bodyView(body: string): BodyView {
  if (body === omittedBody) return { text: "", notes: ["内容超过 64 KB，没有采集。"] };
  const notes: string[] = [];
  let text = body;
  if (body.endsWith(truncatedMarker)) {
    notes.push("内容已截断，只保留开头部分。");
  } else {
    try {
      const parsed: unknown = JSON.parse(body);
      if (parsed && typeof parsed === "object" && JSON.stringify(parsed) === body) {
        text = JSON.stringify(parsed, null, 2);
      }
    } catch {
      // Not JSON: shown as it is.
    }
  }
  if (body.includes("[REDACTED")) notes.push("敏感内容已被遮盖。");
  return { text, notes };
}
