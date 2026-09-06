import { useEffect, useRef } from "react";
import {
  AlertCircleIcon,
  ArrowRightIcon,
  BracesIcon,
  Clock3Icon,
  FileTextIcon,
  MousePointerClickIcon,
  ServerIcon,
} from "lucide-react";
import type { SessionTimeline } from "@/lib/api/issues";
import { parseBehaviorTimelineItem, type BehaviorTimelineItem } from "./timeline";

export function BehaviorTimeline({
  breadcrumbs,
  errorTimestamp,
  sessionTimeline,
  projectId,
  from,
  to,
  anchorEventId,
}: {
  breadcrumbs: string[];
  errorTimestamp?: string;
  sessionTimeline?: SessionTimeline;
  projectId?: string;
  from?: string;
  to?: string;
  anchorEventId?: string;
}) {
  const anchorRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (typeof anchorRef.current?.scrollIntoView === "function") {
      anchorRef.current.scrollIntoView({ block: "center" });
    }
  }, [anchorEventId, sessionTimeline]);
  if (sessionTimeline?.events.length) {
    return (
      <>
        {sessionTimeline.truncated ? (
          <p className="timeline-limit-note">仅展示最早 100 个事件，后续事件已截断。</p>
        ) : null}
        <ol className="event-breadcrumbs" aria-label="会话行为时间线">
          {sessionTimeline.events.map((event) => {
            const Icon = iconForSession(event.kind);
            const isAnchor = event.eventId === anchorEventId;
            const issueHref =
              event.kind === "error" && event.fingerprint && projectId
                ? issueLink(projectId, event.fingerprint, from, to)
                : undefined;
            return (
              <li
                key={event.eventId}
                ref={isAnchor ? anchorRef : undefined}
                data-kind={event.kind}
                data-anchor={isAnchor || undefined}
                aria-current={isAnchor ? "true" : undefined}
              >
                <span className="event-breadcrumbs__icon" data-category={event.kind}>
                  <Icon />
                </span>
                <div>
                  <div className="event-breadcrumbs__title">
                    <strong>{sessionTitle(event.kind, event.title)}</strong>
                    {isAnchor ? <span>当前事件</span> : null}
                  </div>
                  <p>{sessionDescription(event)}</p>
                  {issueHref ? (
                    <a className="timeline-evidence-link" href={issueHref}>
                      查看 Issue 与源码
                    </a>
                  ) : null}
                </div>
                <time dateTime={event.timestamp}>
                  <Clock3Icon />
                  {formatTimestamp(event.timestamp)}
                </time>
              </li>
            );
          })}
        </ol>
      </>
    );
  }
  if (!breadcrumbs.length) {
    return <p className="issue-empty-copy">该错误发生前没有采集到用户行为。</p>;
  }
  const items = breadcrumbs.map(parseBehaviorTimelineItem);
  return (
    <ol className="event-breadcrumbs" aria-label="会话行为时间线">
      {items.map((item, index) => {
        const Icon = iconFor(item.category);
        return (
          <li key={`${breadcrumbs[index]}:${index}`}>
            <span className="event-breadcrumbs__icon" data-category={item.category}>
              <Icon />
            </span>
            <div>
              <strong>{item.title}</strong>
              <p>{item.description}</p>
              {item.metadata.length ? (
                <dl className="event-breadcrumbs__meta">
                  {item.metadata.map(([key, value]) => (
                    <div key={key}>
                      <dt>{labelForMetadata(key)}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </div>
            {item.timestamp ? (
              <time dateTime={item.timestamp}>
                <Clock3Icon />
                {formatTimestamp(item.timestamp)}
              </time>
            ) : null}
          </li>
        );
      })}
      {errorTimestamp ? (
        <li className="event-breadcrumbs__anchor">
          <span className="event-breadcrumbs__icon" data-category="error">
            <AlertCircleIcon />
          </span>
          <div>
            <strong>错误发生</strong>
            <p>时间线在此处进入当前错误事件。</p>
          </div>
          <time dateTime={errorTimestamp}>
            <Clock3Icon />
            {formatTimestamp(errorTimestamp)}
          </time>
        </li>
      ) : null}
    </ol>
  );
}

function iconForSession(kind: SessionTimeline["events"][number]["kind"]) {
  if (kind === "navigation") return ArrowRightIcon;
  if (kind === "click") return MousePointerClickIcon;
  if (kind === "page_view") return FileTextIcon;
  if (kind === "api") return ServerIcon;
  if (kind === "error") return AlertCircleIcon;
  return BracesIcon;
}

function sessionTitle(kind: string, title: string) {
  if (kind === "page_view") return "页面访问";
  if (kind === "navigation") return "页面导航";
  if (kind === "click") return "元素点击";
  if (kind === "api") return "API 请求";
  if (kind === "error") return `错误 · ${title}`;
  return title || "自定义事件";
}

function sessionDescription(event: SessionTimeline["events"][number]) {
  if (event.kind === "error") return event.errorMessage || "该会话发生了前端错误。";
  if (event.kind === "api")
    return `${event.apiMethod ?? "请求"} ${event.apiUrl ?? "未知地址"}${event.apiStatus ? ` · ${event.apiStatus}` : ""}`;
  if (event.kind === "click") {
    if (event.attributes.name) return `点击${event.attributes.name}`;
    const target = event.attributes.role || event.attributes.element;
    return target ? `目标：${target}` : "已记录受治理的交互目标，未采集输入值。";
  }
  return event.route || event.title || "已采集行为事件。";
}

function issueLink(projectId: string, fingerprint: string, from?: string, to?: string) {
  const parameters = new URLSearchParams();
  if (from) parameters.set("from", from);
  if (to) parameters.set("to", to);
  const suffix = parameters.size ? `?${parameters}` : "";
  return `/projects/${encodeURIComponent(projectId)}/issues/${encodeURIComponent(fingerprint)}${suffix}`;
}

function iconFor(category: BehaviorTimelineItem["category"]) {
  if (category === "navigation") return ArrowRightIcon;
  if (category === "click") return MousePointerClickIcon;
  return BracesIcon;
}

function labelForMetadata(key: string) {
  return (
    {
      route: "路由",
      element: "元素",
      role: "角色",
      name: "名称",
      input_type: "输入类型",
    }[key] ?? key
  );
}

function formatTimestamp(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleTimeString("zh-CN");
}
