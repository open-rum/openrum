import { useQuery } from "@tanstack/react-query";
import { XIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { BehaviorTimeline } from "@/features/events/BehaviorTimeline";
import { getSessionTimeline, type EventDetail, type SessionTimeline } from "@/lib/api/issues";

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
  const all = sessionTimeline?.events ?? [];
  // The preview opens on this error and walks back through the nine moments before it. The
  // timeline keeps the window's earliest 100 events, so a busy session can lose the error
  // itself; it is then rebuilt from the event so it still comes first.
  const errorIndex = all.findIndex((item) => item.eventId === event.eventId);
  const before =
    errorIndex >= 0
      ? all.slice(0, errorIndex)
      : all.filter((item) => item.timestamp < event.timestamp);
  const shown = sessionTimeline && {
    ...sessionTimeline,
    events: [...before.slice(-(TIMELINE_PREVIEW - 1)), all[errorIndex] ?? errorMoment(event)],
  };
  const timelineProps = {
    breadcrumbs: event.breadcrumbs,
    errorTimestamp: event.timestamp,
    projectId: event.projectId,
    from: from.toISOString(),
    to: to.toISOString(),
  };
  return (
    <>
      {timeline.error ? (
        <p className="timeline-limit-note">完整会话暂不可用，以下为错误随附的前序行为。</p>
      ) : null}
      {all.length > (shown?.events.length ?? 0) ? (
        <Drawer direction="right">
          {/* The preview fades out above the way to the rest. */}
          <div className="timeline-preview" data-truncated>
            <BehaviorTimeline
              {...timelineProps}
              sessionTimeline={shown}
              anchorEventId={event.eventId}
              newestFirst
              scrollToAnchor={false}
            />
          </div>
          <DrawerTrigger asChild>
            <Button variant="outline" size="sm" className="timeline-show-all">
              查看完整时间线（共 {all.length} 条）
            </Button>
          </DrawerTrigger>
          <DrawerContent className="timeline-drawer">
            <DrawerHeader className="timeline-drawer__header">
              <div>
                <DrawerTitle>行为时间线</DrawerTitle>
                <DrawerDescription>
                  错误前 15 分钟到后 5 分钟，同一会话中的页面、操作、请求与错误。
                </DrawerDescription>
              </div>
              <DrawerClose asChild>
                <Button size="icon" variant="ghost" aria-label="关闭时间线">
                  <XIcon />
                </Button>
              </DrawerClose>
            </DrawerHeader>
            <div className="timeline-drawer__body">
              <BehaviorTimeline
                {...timelineProps}
                sessionTimeline={sessionTimeline}
                anchorEventId={event.eventId}
                newestFirst
              />
            </div>
          </DrawerContent>
        </Drawer>
      ) : (
        <BehaviorTimeline
          {...timelineProps}
          sessionTimeline={shown}
          anchorEventId={event.eventId}
          newestFirst
          scrollToAnchor={false}
        />
      )}
    </>
  );
}

const TIMELINE_PREVIEW = 10;

/** This error as a timeline moment, for when the session timeline does not reach it. */
function errorMoment(event: EventDetail): SessionTimeline["events"][number] {
  return {
    eventId: event.eventId,
    timestamp: event.timestamp,
    kind: "error",
    title: event.errorType,
    route: event.route,
    pageUrl: event.pageUrl,
    errorType: event.errorType,
    errorMessage: event.errorMessage,
    fingerprint: event.fingerprint,
    handled: event.handled,
    attributes: {},
  };
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
