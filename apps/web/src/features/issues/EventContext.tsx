import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BehaviorTimeline } from "@/features/events/BehaviorTimeline";
import { getSessionTimeline, type EventDetail } from "@/lib/api/issues";

export function EventContext({ event }: { event: EventDetail }) {
  const anchor = new Date(event.timestamp);
  const timelineFrom = new Date(anchor.getTime() - 15 * 60 * 1000);
  const timelineTo = new Date(anchor.getTime() + 5 * 60 * 1000);
  const timeline = useQuery({
    queryKey: ["session-timeline", event.projectId, event.sessionId, timelineFrom, timelineTo],
    queryFn: ({ signal }) =>
      getSessionTimeline(event.projectId, event.sessionId, timelineFrom, timelineTo, signal),
  });
  const facts = [
    ["页面", event.pageUrl],
    ["路由", event.route],
    ["环境", event.environment],
    ["版本", event.release],
    ["Dist", event.dist],
    ["浏览器", join(event.browser, event.browserVersion)],
    ["系统", join(event.os, event.osVersion)],
    ["设备", event.deviceType],
    ["国家", event.country],
    ["会话", event.sessionId],
    ["匿名访客", event.visitorId],
    ["采集时间", formatTime(event.timestamp)],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));
  return (
    <section className="issue-panel" aria-labelledby="context-title">
      <div className="issue-panel__header">
        <div>
          <h2 id="context-title">事件上下文</h2>
          <p>用于复现问题的安全、脱敏客户端信息。</p>
        </div>
      </div>
      <Tabs defaultValue="context">
        <TabsList variant="line">
          <TabsTrigger value="context">上下文</TabsTrigger>
          <TabsTrigger value="breadcrumbs">
            行为时间线 · {timeline.data?.events.length ?? event.breadcrumbs.length}
          </TabsTrigger>
          <TabsTrigger value="apis">相关 API · {event.relatedApis.length}</TabsTrigger>
        </TabsList>
        <TabsContent value="context">
          <dl className="event-facts">
            {facts.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </TabsContent>
        <TabsContent value="breadcrumbs">
          {timeline.isLoading ? <p className="issue-empty-copy">正在加载会话时间线…</p> : null}
          {timeline.error ? (
            <p className="timeline-limit-note">完整会话暂不可用，以下为错误随附的前序行为。</p>
          ) : null}
          {!timeline.isLoading ? (
            <BehaviorTimeline
              breadcrumbs={event.breadcrumbs}
              errorTimestamp={event.timestamp}
              sessionTimeline={timeline.data}
              projectId={event.projectId}
              from={timelineFrom.toISOString()}
              to={timelineTo.toISOString()}
            />
          ) : null}
        </TabsContent>
        <TabsContent value="apis">
          {event.relatedApis.length ? (
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
          ) : (
            <p className="issue-empty-copy">错误前后 5 分钟内没有相关 API 请求。</p>
          )}
        </TabsContent>
      </Tabs>
    </section>
  );
}

function join(first?: string, second?: string) {
  return [first, second].filter(Boolean).join(" ");
}
function formatTime(value: string) {
  return new Date(value).toLocaleString("zh-CN");
}
