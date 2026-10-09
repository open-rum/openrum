import type { EventDetail } from "@/lib/api/issues";

// Mapping failure codes come from the Go mapper (internal/sourcemap) and are stored on each
// frame of a mapped stack. The Issue stack view and the Releases match tester share these
// labels so a failure reads the same wherever it appears.
export const sourceMapFailureLabels: Record<string, string> = {
  missing_release: "事件没有 release，无法匹配 Source Map",
  missing_artifact: "没有找到与脚本地址匹配的 Source Map",
  ambiguous_artifact: "存在多个匹配的 Source Map，请检查 release / dist",
  invalid_map: "Source Map 无法解析",
  unsupported_index_url: "暂不支持外部 indexed Source Map",
  no_mapping: "该位置没有可用映射",
  resource_limit: "堆栈或 Source Map 超出安全限制",
};

/** Human-readable label for a failure code; unknown codes are shown as-is rather than hidden. */
export function sourceMapFailureLabel(code: string | undefined | null) {
  if (!code) return undefined;
  return sourceMapFailureLabels[code] ?? `无法还原（${code}）`;
}

/** Whether an event's stack still needs Source Map work (missing, failed or partial mapping). */
export function needsSourceMapGuidance(event: Pick<EventDetail, "mappedStack" | "originalStack">) {
  const mapped = event.mappedStack;
  if (mapped) return mapped.status !== "mapped";
  return Boolean(event.originalStack?.trim());
}
