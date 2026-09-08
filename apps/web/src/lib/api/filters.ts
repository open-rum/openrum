import { apiFetch, csrfHeaders } from "@/lib/auth/session";

const protectedRequest = { redirectOnUnauthorized: true } as const;

export type FilterMode = "off" | "dry_run" | "enforced";
export type FilterKind = "error_message" | "error_url" | "page_url" | "release";

export type FilterRule = {
  id: string;
  kind: FilterKind;
  pattern: string;
  mode: FilterMode;
  note?: string;
};

export type InboundFilters = {
  /** Keyed by category. The server sends every category, including the off ones. */
  builtin: Record<string, FilterMode>;
  rules: FilterRule[];
};

export const filterModeLabels: Record<FilterMode, string> = {
  off: "关闭",
  dry_run: "仅统计",
  enforced: "丢弃",
};

export const filterKindLabels: Record<FilterKind, string> = {
  error_message: "错误标题",
  error_url: "堆栈帧地址",
  page_url: "页面地址",
  release: "版本号",
};

export const builtinLabels: Record<string, { title: string; description: string }> = {
  bot: {
    title: "机器人流量",
    description:
      "User-Agent 自称爬虫或无头浏览器。多数爬虫不执行 JavaScript 因而从不上报，实际会命中的主要是 Googlebot 和 Playwright、Puppeteer 这类自动化。",
  },
  extension: {
    title: "浏览器扩展错误",
    description: "堆栈指向扩展代码，说明抛错的不是你的页面。",
  },
  localhost: {
    title: "本机页面",
    description:
      "页面来自 localhost、回环地址或 .local 域名。内网地址（如 10.x）不算在内，它们通常是真实流量。",
  },
};

export function getInboundFilters(projectId: string, signal?: AbortSignal) {
  return apiFetch<InboundFilters>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/filters`,
    { signal },
    protectedRequest,
  );
}

export function updateInboundFilters(projectId: string, input: InboundFilters) {
  return apiFetch<InboundFilters>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/filters`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...csrfHeaders() },
      body: JSON.stringify(input),
    },
    protectedRequest,
  );
}
