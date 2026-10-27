import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CopyIcon } from "lucide-react";
import { toast } from "sonner";
import { AsyncError } from "@/components/ui/AsyncState";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRelative } from "@/features/analytics/format";
import type { BehaviorSample } from "@/lib/api/analytics";
import { getSessionTimeline } from "@/lib/api/issues";
import { sessionEventHref } from "@/lib/api/sessions";
import { BehaviorTimeline } from "./BehaviorTimeline";
import { attributePreview, sampleWindowLabel, shortID } from "./catalog";
import { sessionTimelineRange } from "./timeline";

/**
 * The event's recent raw samples: a list to scan on the left and everything known about the
 * picked one on the right, as on the API detail. The drawer owns the query, so its tab can
 * show how many there are.
 */
export function EventSamples({
  projectId,
  range,
  page,
  isLoading,
  error,
  onRetry,
}: {
  projectId: string;
  range: { from: Date; to: Date };
  page?: { samples: BehaviorSample[]; limit: number; window?: { from: string; to: string } };
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string>();
  const samples = page?.samples ?? [];
  // The newest sample is open until one is picked, and again when the picked one is gone.
  const selected = samples.find((sample) => sample.eventId === selectedId) ?? samples[0];

  if (isLoading) return <Skeleton className="h-64" />;
  if (error)
    return (
      <AsyncError
        error={error}
        title="样本加载失败"
        remediation="请稍后重试，或缩短时间范围。"
        onRetry={onRetry}
      />
    );
  if (!samples.length)
    return (
      <EmptyState
        title={page?.window ? "这段时间没有可查看的原始样本" : "所选范围内没有这个事件"}
        description={
          page?.window
            ? "原始事件只保留一段时间，也可能被上方的属性筛选排除。"
            : "换一个时间范围，或确认该事件仍在上报。"
        }
      />
    );
  return (
    <section className="event-samples" aria-labelledby="event-samples-title">
      <div className="event-samples__list">
        <div className="event-samples__intro">
          <h2 id="event-samples-title">原始样本</h2>
          <p>
            {sampleWindowLabel(range, page?.window)}最近 {samples.length.toLocaleString()}{" "}
            条，已脱敏。
          </p>
        </div>
        <ul className="event-samples__items" aria-label="样本列表">
          {samples.map((sample) => {
            const preview = attributePreview(sample.attributes, 2);
            return (
              <li key={sample.eventId}>
                <button
                  type="button"
                  aria-pressed={sample.eventId === selected?.eventId}
                  onClick={() => setSelectedId(sample.eventId)}
                >
                  <span className="event-samples__time">
                    <strong title={new Date(sample.timestamp).toLocaleString("zh-CN")}>
                      {formatSampleAge(sample.timestamp)}
                    </strong>
                    <small>{new Date(sample.timestamp).toLocaleString("zh-CN")}</small>
                  </span>
                  <span className="event-samples__page">
                    {sample.route || sample.pageUrl || "未知页面"}
                  </span>
                  {preview.shown.length ? (
                    <span className="event-chips">
                      {preview.shown.map(([key, value]) => (
                        <code key={key} title={`${key}=${value}`}>
                          {key}={value}
                        </code>
                      ))}
                      {preview.hidden ? (
                        <code className="event-chips__more">+{preview.hidden}</code>
                      ) : null}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      {selected ? (
        <SampleDetail key={selected.eventId} projectId={projectId} sample={selected} />
      ) : null}
    </section>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      onClick={async (click) => {
        click.stopPropagation();
        try {
          await navigator.clipboard.writeText(value);
          toast.success("已复制");
        } catch {
          toast.error("复制失败，请手动选择文本");
        }
      }}
      onKeyDown={(key) => key.stopPropagation()}
    >
      <CopyIcon />
    </Button>
  );
}

/** One sample's facts, every property it carried and its full session timeline. */
function SampleDetail({ projectId, sample }: { projectId: string; sample: BehaviorSample }) {
  const range = sessionTimelineRange(sample.timestamp);
  const timeline = useQuery({
    queryKey: ["session-timeline", projectId, sample.sessionId, range.from, range.to],
    queryFn: ({ signal }) =>
      getSessionTimeline(projectId, sample.sessionId, range.from, range.to, signal),
  });
  return (
    <article className="event-samples__detail" aria-label="样本详情">
      <dl className="event-sample-facts">
        <div>
          <dt>时间</dt>
          <dd>{new Date(sample.timestamp).toLocaleString("zh-CN")}</dd>
        </div>
        <div>
          <dt>路由</dt>
          <dd>{sample.route || "—"}</dd>
        </div>
        <div>
          <dt>浏览器</dt>
          <dd>{sample.browser || "—"}</dd>
        </div>
        <div>
          <dt>设备</dt>
          <dd>{sample.device || "—"}</dd>
        </div>
        <div>
          <dt>国家</dt>
          <dd>{sample.country || "—"}</dd>
        </div>
        <div>
          <dt>访客</dt>
          <dd>{sample.visitorId ? shortID(sample.visitorId) : "—"}</dd>
        </div>
        <div>
          <dt>会话</dt>
          <dd className="event-session">
            <code>{sample.sessionId}</code>
            <CopyButton value={sample.sessionId} label="复制完整会话 ID" />
          </dd>
        </div>
      </dl>
      {Object.keys(sample.attributes).length ? (
        <section>
          <h3>事件属性</h3>
          <dl className="event-sample-attributes">
            {Object.entries(sample.attributes).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
      <section>
        <div className="event-sample-session-header">
          <div>
            <h3>完整会话时间线</h3>
            <p>页面、点击、自定义事件、API 与错误按发生顺序排列。</p>
          </div>
          {timeline.data ? <span>{timeline.data.events.length} 个事件</span> : null}
        </div>
        <Button asChild variant="outline" size="sm">
          <a href={sessionEventHref(projectId, sample.sessionId, sample.timestamp, sample.eventId)}>
            打开完整会话详情
          </a>
        </Button>
        {timeline.isLoading ? <Skeleton className="h-64" /> : null}
        {timeline.error ? (
          <AsyncError
            error={timeline.error}
            title="完整会话暂不可用"
            remediation="已保留事件随附的前序行为；可重新请求完整时间线。"
            onRetry={() => void timeline.refetch()}
          />
        ) : null}
        {!timeline.isLoading ? (
          <BehaviorTimeline
            breadcrumbs={sample.breadcrumbs}
            sessionTimeline={timeline.data}
            anchorEventId={sample.eventId}
            projectId={projectId}
            from={range.from.toISOString()}
            to={range.to.toISOString()}
          />
        ) : null}
      </section>
    </article>
  );
}

function formatSampleAge(timestamp: string) {
  const seconds = Math.max(0, (Date.now() - new Date(timestamp).getTime()) / 1000);
  return formatRelative(seconds);
}
