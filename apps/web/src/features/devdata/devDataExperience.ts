export function devDataRangeError(from: Date, to: Date, now: number): string | null {
  const start = from.getTime();
  const end = to.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < 1000)
    return "请选择至少 1 秒的有效时间范围。";
  if (start < now - 30 * 24 * 60 * 60 * 1000) return "当前范围超出最近 30 天，无法添加测试数据。";
  if (end > now + 60 * 1000) return "当前范围包含未来时间，无法添加测试数据。";
  return null;
}

const destinations: Record<string, { page: string; label: string; preset: string }> = {
  logs: { page: "logs", label: "查看日志", preset: "logs" },
  performance: { page: "performance", label: "查看性能", preset: "web-vitals" },
  apis: { page: "apis", label: "查看 API", preset: "api-surface" },
  issues: { page: "issues", label: "查看错误", preset: "error-burst" },
  events: { page: "events", label: "查看事件", preset: "storefront" },
  sessions: { page: "sessions", label: "查看会话", preset: "storefront" },
  analytics: { page: "analytics", label: "查看分析", preset: "storefront" },
};

export function devDataDestination(pathname: string) {
  const page = /^\/projects\/[^/]+\/([^/]+)/.exec(pathname)?.[1] ?? "";
  return destinations[page] ?? { page: "overview", label: "查看仪表盘", preset: "storefront" };
}
export type DevDataDestination = ReturnType<typeof devDataDestination>;
