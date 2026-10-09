import { ArrowRightIcon, FileWarningIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { releaseUploadPath } from "@/features/releases/releaseLinks";
import type { EventDetail } from "@/lib/api/issues";
import { docsUrl } from "@/lib/docs";
import { needsSourceMapGuidance, sourceMapFailureLabel } from "./sourceMapFailures";

const REMAP_WINDOW_DAYS = 7;

/**
 * Next step for an unmapped or partially mapped stack: upload maps for this exact release and
 * dist, or set `release` in the SDK when the event has none.
 */
export function SourceMapGuidance({ event }: { event: EventDetail }) {
  if (!needsSourceMapGuidance(event)) return null;
  const mapped = event.mappedStack;
  const release = event.release?.trim();
  const dist = event.dist?.trim() ?? "";
  const reason =
    sourceMapFailureLabel(mapped?.failure) ??
    sourceMapFailureLabel(mapped?.frames.find((frame) => frame.failure)?.failure);

  if (!release || mapped?.failure === "missing_release") {
    return (
      <div className="stack-guidance" role="note" aria-label="Source Map 下一步">
        <FileWarningIcon aria-hidden="true" />
        <div>
          <strong>事件没有 release，无法匹配 Source Map</strong>
          <p>
            在 SDK 的 <code>init()</code> 中设置 <code>release</code>（如需区分构建再设置{" "}
            <code>dist</code>），并在构建时用相同的值上传 Source Map。
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <a href={docsUrl("sdk/source-maps/")} target="_blank" rel="noreferrer">
            查看配置说明
          </a>
        </Button>
      </div>
    );
  }

  const title = dist
    ? `为版本 ${release}（dist ${dist}）上传 Source Map`
    : `为版本 ${release} 上传 Source Map`;
  return (
    <div className="stack-guidance" role="note" aria-label="Source Map 下一步">
      <FileWarningIcon aria-hidden="true" />
      <div>
        <strong>{title}</strong>
        <p>
          {mapped
            ? mapped.status === "partial"
              ? `部分调用帧未能还原${reason ? `：${reason}` : ""}。`
              : `堆栈未能还原${reason ? `：${reason}` : ""}。`
            : "这个事件还没有还原结果。"}
          上传后，近 {REMAP_WINDOW_DAYS} 天内该版本的错误会自动重新还原，刷新本页即可查看。
        </p>
      </div>
      <Button asChild size="sm">
        <a href={releaseUploadPath(event.projectId, release, dist)}>
          上传 Source Map
          <ArrowRightIcon data-icon="inline-end" />
        </a>
      </Button>
    </div>
  );
}
