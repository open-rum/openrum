import { Clock3Icon, MousePointerClickIcon } from "lucide-react";
import type { EventDetail } from "@/lib/api/issues";

type Crumb = { category?: string; message: string; timestamp?: string };

export function Breadcrumbs({ breadcrumbs }: { breadcrumbs: EventDetail["breadcrumbs"] }) {
  if (!breadcrumbs.length)
    return <p className="issue-empty-copy">该事件没有采集到用户行为面包屑。</p>;
  return (
    <ol className="event-breadcrumbs" aria-label="事件面包屑">
      {breadcrumbs.map((raw, index) => {
        const crumb = parseCrumb(raw);
        return (
          <li key={`${raw}:${index}`}>
            <span className="event-breadcrumbs__icon">
              <MousePointerClickIcon />
            </span>
            <div>
              <strong>{crumb.category || "用户行为"}</strong>
              <p>{crumb.message}</p>
            </div>
            {crumb.timestamp ? (
              <time dateTime={crumb.timestamp}>
                <Clock3Icon />
                {formatTimestamp(crumb.timestamp)}
              </time>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function parseCrumb(raw: string): Crumb {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const message = [value.message, value.type, value.url].find((item) => typeof item === "string");
    return {
      category: typeof value.category === "string" ? value.category : undefined,
      message: typeof message === "string" ? message : raw,
      timestamp: typeof value.timestamp === "string" ? value.timestamp : undefined,
    };
  } catch {
    return { message: raw };
  }
}

function formatTimestamp(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleTimeString("zh-CN");
}
