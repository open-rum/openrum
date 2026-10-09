import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { BehaviorTimeline } from "@/features/events/BehaviorTimeline";
import { getSessionTimeline, type EventDetail } from "@/lib/api/issues";

/** The session around the error: 15 minutes before to 5 minutes after. */
function timelineWindow(event: EventDetail) {
  const anchor = new Date(event.timestamp).getTime();
  return { from: new Date(anchor - 15 * 60 * 1000), to: new Date(anchor + 5 * 60 * 1000) };
}

function useEventTimeline(event: EventDetail) {
  const { from, to } = timelineWindow(event);
  return useQuery({
    queryKey: ["session-timeline", event.projectId, event.sessionId, from, to],
    queryFn: ({ signal }) => getSessionTimeline(event.projectId, event.sessionId, from, to, signal),
  });
}

export function EventBreadcrumbs({ event }: { event: EventDetail }) {
  const { from, to } = timelineWindow(event);
  const timeline = useEventTimeline(event);
  if (timeline.isLoading) return <p className="issue-empty-copy">正在加载会话时间线…</p>;
  // Web vitals (LCP, INP, CLS…) describe page performance, not what led to the error;
  // the Session page keeps the complete timeline.
  const sessionTimeline = timeline.data && {
    ...timeline.data,
    events: timeline.data.events.filter((item) => item.kind !== "web_vital"),
  };
  return (
    <>
      {timeline.error ? (
        <p className="timeline-limit-note">完整会话暂不可用，以下为错误随附的前序行为。</p>
      ) : null}
      <BehaviorTimeline
        breadcrumbs={event.breadcrumbs}
        errorTimestamp={event.timestamp}
        sessionTimeline={sessionTimeline}
        projectId={event.projectId}
        from={from.toISOString()}
        to={to.toISOString()}
      />
    </>
  );
}

export function EventRelatedApis({ event }: { event: EventDetail }) {
  if (!event.relatedApis.length)
    return <p className="issue-empty-copy">错误前后 5 分钟内没有相关 API 请求。</p>;
  return (
    <div className="related-apis">
      {event.relatedApis.map((api) => (
        <div key={api.eventId}>
          <Badge variant={api.failure || api.status >= 500 ? "destructive" : "outline"}>
            {api.method}
          </Badge>
          <code>{api.url}</code>
          <span>{api.failure || api.status || "网络错误"}</span>
          <strong>{Math.round(api.durationMs)} ms</strong>
        </div>
      ))}
    </div>
  );
}

export function FactGrid({ facts, label }: { facts: [string, string][]; label: string }) {
  return (
    <dl className="event-facts" aria-label={label}>
      {facts.map(([name, value]) => (
        <div key={name}>
          <dt>{name}</dt>
          <dd title={value}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
