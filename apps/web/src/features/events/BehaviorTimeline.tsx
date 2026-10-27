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
  newestFirst = false,
  scrollToAnchor = true,
}: {
  breadcrumbs: string[];
  errorTimestamp?: string;
  sessionTimeline?: SessionTimeline;
  projectId?: string;
  from?: string;
  to?: string;
  anchorEventId?: string;
  /** Latest first, so an error reads before what led to it. */
  newestFirst?: boolean;
  /** Leave false where the timeline sits inside a page that must not jump on load. */
  scrollToAnchor?: boolean;
}) {
  const anchorRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (scrollToAnchor && typeof anchorRef.current?.scrollIntoView === "function") {
      anchorRef.current.scrollIntoView({ block: "center" });
    }
  }, [anchorEventId, sessionTimeline, scrollToAnchor]);
  if (sessionTimeline?.events.length) {
    // Times read against the error when there is one, otherwise against the session's start.
    const reference = errorTimestamp
      ? { at: errorTimestamp, label: "错误" }
      : { at: sessionTimeline.session.startedAt, label: "会话开始" };
    const previousRoutes = previousRouteOf(sessionTimeline.events);
    return (
      <>
        {sessionTimeline.truncated ? (
          <p className="timeline-limit-note">仅展示最早 100 个事件，后续事件已截断。</p>
        ) : null}
        <ol className="event-breadcrumbs" aria-label="会话行为时间线">
          {(newestFirst ? [...sessionTimeline.events].reverse() : sessionTimeline.events).map(
            (event) => {
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
                  <span
                    className="event-breadcrumbs__icon"
                    data-category={event.kind}
                    data-failed={
                      (event.kind === "api" &&
                        (Boolean(event.apiFailure) || (event.apiStatus ?? 0) >= 400)) ||
                      undefined
                    }
                    data-level={event.kind === "log" ? event.logLevel : undefined}
                  >
                    <Icon />
                  </span>
                  <div>
                    <div className="event-breadcrumbs__title">
                      <strong>{sessionTitle(event.kind, event.title)}</strong>
                      {isAnchor ? <span>当前事件</span> : null}
                    </div>
                    <SessionEventDetail
                      event={event}
                      previousRoute={previousRoutes.get(event.eventId)}
                    />
                    {issueHref ? (
                      <a className="timeline-evidence-link" href={issueHref}>
                        查看 Issue 与源码
                      </a>
                    ) : null}
                  </div>
                  <TimelineTime at={event.timestamp} reference={reference} />
                </li>
              );
            },
          )}
        </ol>
      </>
    );
  }
  if (!breadcrumbs.length) {
    return <p className="issue-empty-copy">该错误发生前没有采集到用户行为。</p>;
  }
  const items = breadcrumbs.map((raw, index) => ({
    ...parseBehaviorTimelineItem(raw),
    key: `${raw}:${index}`,
  }));
  const errorRow = errorTimestamp ? (
    <li className="event-breadcrumbs__anchor">
      <span className="event-breadcrumbs__icon" data-category="error">
        <AlertCircleIcon />
      </span>
      <div>
        <strong>错误发生</strong>
        <p>时间线在此处进入当前错误事件。</p>
      </div>
      <TimelineTime at={errorTimestamp} reference={{ at: errorTimestamp, label: "错误" }} />
    </li>
  ) : null;
  return (
    <ol className="event-breadcrumbs" aria-label="会话行为时间线">
      {newestFirst ? errorRow : null}
      {(newestFirst ? [...items].reverse() : items).map((item) => {
        const Icon = iconFor(item.category);
        return (
          <li key={item.key}>
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
              <TimelineTime
                at={item.timestamp}
                reference={errorTimestamp ? { at: errorTimestamp, label: "错误" } : undefined}
              />
            ) : null}
          </li>
        );
      })}
      {newestFirst ? null : errorRow}
    </ol>
  );
}

function iconForSession(kind: SessionTimeline["events"][number]["kind"]) {
  if (kind === "navigation") return ArrowRightIcon;
  if (kind === "click") return MousePointerClickIcon;
  if (kind === "page_view") return FileTextIcon;
  if (kind === "api") return ServerIcon;
  if (kind === "error") return AlertCircleIcon;
  if (kind === "log") return FileTextIcon;
  return BracesIcon;
}

function sessionTitle(kind: string, title: string) {
  if (kind === "page_view") return "页面访问";
  if (kind === "navigation") return "页面导航";
  if (kind === "click") return "元素点击";
  if (kind === "api") return "API 请求";
  if (kind === "error") return `错误 · ${title}`;
  if (kind === "log") return `日志 · ${title}`;
  return title || "自定义事件";
}

type TimelineEvent = SessionTimeline["events"][number];

/** For each navigation, the route the person was on before it. */
function previousRouteOf(events: TimelineEvent[]) {
  const previous = new Map<string, string>();
  let route: string | undefined;
  for (const event of events) {
    if (event.kind !== "navigation" && event.kind !== "page_view") continue;
    if (event.kind === "navigation" && route && route !== event.route)
      previous.set(event.eventId, route);
    route = event.route || route;
  }
  return previous;
}

/** What happened, with the details each kind has: where a click landed, where a page went. */
function SessionEventDetail({
  event,
  previousRoute,
}: {
  event: TimelineEvent;
  previousRoute?: string;
}) {
  if (event.kind === "navigation" || event.kind === "page_view") {
    const to = event.route || event.pageUrl || event.title;
    return (
      <>
        {event.kind === "navigation" && previousRoute ? (
          <p className="event-breadcrumbs__route">
            <span>from</span>
            <code>{previousRoute}</code>
            <ArrowRightIcon aria-hidden="true" />
            <span>to</span>
            <code>{to}</code>
          </p>
        ) : (
          <p>
            <code>{to || "已采集页面事件。"}</code>
          </p>
        )}
        <TimelineMeta
          entries={[
            ["页面标题", event.pageTitle],
            ["方式", event.navigationType],
          ]}
        />
      </>
    );
  }
  if (event.kind === "click") {
    const target = event.attributes.name
      ? `点击「${event.attributes.name}」`
      : `点击 ${event.attributes.role || event.attributes.element || "元素"}`;
    return (
      <>
        <p>{target}</p>
        {event.attributes.selector ? (
          <code className="event-breadcrumbs__selector">{event.attributes.selector}</code>
        ) : null}
        <TimelineMeta entries={[["页面", event.route]]} />
      </>
    );
  }
  if (event.kind === "api") {
    return (
      <>
        <p>
          <code>
            {event.apiMethod ?? "请求"} {event.apiUrl ?? "未知地址"}
          </code>
        </p>
        <TimelineMeta
          entries={[
            ["状态", event.apiFailure || (event.apiStatus ? String(event.apiStatus) : undefined)],
            [
              "耗时",
              event.durationMs === undefined ? undefined : `${Math.round(event.durationMs)} ms`,
            ],
            ["页面", event.route],
          ]}
        />
      </>
    );
  }
  if (event.kind === "error") {
    return (
      <>
        <p>{event.errorMessage || "该会话发生了前端错误。"}</p>
        <TimelineMeta
          entries={[
            ["类型", event.errorType],
            ["处理", event.handled === undefined ? undefined : event.handled ? "已捕获" : "未捕获"],
            ["页面", event.route],
          ]}
        />
      </>
    );
  }
  if (event.kind === "log") {
    return (
      <>
        <p>{event.logMessage || event.title}</p>
        <TimelineMeta entries={[["页面", event.route]]} />
      </>
    );
  }
  return <p>{event.route || event.title || "已采集行为事件。"}</p>;
}

function TimelineMeta({ entries }: { entries: Array<[string, string | undefined]> }) {
  const shown = entries.filter((entry): entry is [string, string] => Boolean(entry[1]));
  if (!shown.length) return null;
  return (
    <dl className="event-breadcrumbs__meta">
      {shown.map(([key, value]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The moment twice: against the error or the session's start, and on the clock. */
function TimelineTime({
  at,
  reference,
}: {
  at: string;
  reference?: { at: string; label: string };
}) {
  const relative = reference ? relativeTo(at, reference) : undefined;
  return (
    <time dateTime={at} className="event-breadcrumbs__time" title={formatFullTimestamp(at)}>
      {relative ? <span>{relative}</span> : null}
      <small>
        <Clock3Icon aria-hidden="true" />
        {formatTimestamp(at)}
      </small>
    </time>
  );
}

function relativeTo(at: string, reference: { at: string; label: string }) {
  const difference = new Date(at).getTime() - new Date(reference.at).getTime();
  if (Number.isNaN(difference)) return undefined;
  if (Math.abs(difference) < 500) return reference.label === "错误" ? "错误时" : reference.label;
  const span = formatSpan(Math.abs(difference));
  if (reference.label === "错误") return difference < 0 ? `错误前 ${span}` : `错误后 ${span}`;
  return difference < 0 ? `${reference.label}前 ${span}` : `${reference.label}后 ${span}`;
}

function formatSpan(milliseconds: number) {
  const seconds = Math.round(milliseconds / 1000);
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分 ${seconds % 60} 秒`;
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
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

function formatFullTimestamp(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("zh-CN");
}
