import { useState } from "react";
import { AlertTriangleIcon, ArrowDownUpIcon, ChevronDownIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { EventDetail } from "@/lib/api/issues";
import { displayFrames, type OriginalPosition } from "./displayFrames";
import { SourceMapGuidance } from "./SourceMapGuidance";

export function StackTrace({ event }: { event: EventDetail }) {
  const mapped = event.mappedStack;
  const rawText = event.originalStack || mapped?.raw || "";
  const frames = displayFrames(event);
  const appFrames = frames.filter((frame) => !frame.library).length;
  const [scope, setScope] = useState<"app" | "full">(appFrames ? "app" : "full");
  const [raw, setRaw] = useState(frames.length === 0);
  // Browsers report the most recent call first; 最早调用在前 reads it bottom-up.
  const [order, setOrder] = useState<"recent" | "oldest">("recent");
  const scoped = scope === "app" ? frames.filter((frame) => !frame.library) : frames;
  const visible = order === "recent" ? scoped : [...scoped].reverse();
  const [expanded, setExpanded] = useState<Set<number>>(() => {
    const first = frames.findIndex((frame) => frame.source && !frame.library);
    return new Set(first >= 0 ? [first] : []);
  });
  const toggle = (index: number) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  return (
    <div className="issue-stack">
      <div className="stack-exception">
        <p className="stack-error">
          <strong>{event.errorType}</strong>
          {event.errorMessage ? `: ${event.errorMessage}` : null}
        </p>
        <div className="stack-badges">
          <Badge variant={event.handled ? "outline" : "destructive"}>
            {event.handled ? "已捕获" : "未捕获"}
          </Badge>
          {event.errorMechanism ? <Badge variant="outline">{event.errorMechanism}</Badge> : null}
          {mapped?.status ? (
            <Badge variant={mapped.status === "mapped" ? "secondary" : "warning"}>
              {mapped.status === "mapped"
                ? "已还原源码"
                : mapped.status === "partial"
                  ? "部分还原"
                  : "未还原"}
            </Badge>
          ) : null}
        </div>
      </div>
      <SourceMapGuidance event={event} />
      <div className="stack-toolbar">
        {/* Only offer the switch when hiding dependency frames actually changes the list. */}
        {appFrames > 0 && appFrames < frames.length && !raw ? (
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={scope}
            onValueChange={(value) => value && setScope(value as "app" | "full")}
            aria-label="调用帧范围"
          >
            <ToggleGroupItem value="app" disabled={!appFrames}>
              应用代码
            </ToggleGroupItem>
            <ToggleGroupItem value="full">完整堆栈</ToggleGroupItem>
          </ToggleGroup>
        ) : (
          <span />
        )}
        <div className="stack-toolbar__end">
          {frames.length > 1 && !raw ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              title="切换调用顺序"
              onClick={() => setOrder((current) => (current === "recent" ? "oldest" : "recent"))}
            >
              <ArrowDownUpIcon data-icon="inline-start" />
              {order === "recent" ? "最近调用在前" : "最早调用在前"}
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant={raw ? "secondary" : "outline"}
            aria-pressed={raw}
            disabled={!frames.length}
            onClick={() => setRaw((current) => !current)}
          >
            原始文本
          </Button>
        </div>
      </div>
      {raw ? (
        <pre className="raw-stack">
          <code>{rawText || "此事件没有堆栈。"}</code>
        </pre>
      ) : (
        <ol
          className="stack-frames"
          aria-label={mapped?.frames.length ? "映射后的调用帧" : "调用帧"}
        >
          {visible.map((frame) => {
            const index = frames.indexOf(frame);
            const open = expanded.has(index);
            const position = [frame.line, frame.column].filter((part) => part !== undefined);
            return (
              <li
                key={`${frame.location}:${frame.line}:${frame.column}:${index}`}
                data-library={frame.library || undefined}
                title={frame.failure}
              >
                <button
                  type="button"
                  className="stack-frame__row"
                  aria-expanded={open}
                  onClick={() => toggle(index)}
                >
                  <span className="stack-frame__text">
                    <span className="stack-frame__file" title={frame.location}>
                      {frame.file}
                    </span>
                    <span className="stack-frame__joiner"> 中的 </span>
                    <span className="stack-frame__function">{frame.function || "anonymous"}</span>
                    {position.length ? (
                      <>
                        <span className="stack-frame__joiner"> 位于 </span>
                        <span className="stack-frame__position">{position.join(":")}</span>
                      </>
                    ) : null}
                  </span>
                  {frame.library ? <span className="stack-frame__tag">依赖</span> : null}
                  {frame.failure ? (
                    <AlertTriangleIcon className="stack-frame__warning" aria-label="未还原" />
                  ) : null}
                  <ChevronDownIcon className="stack-frame__chevron" aria-hidden="true" />
                </button>
                {open ? (
                  <div className="stack-frame__detail">
                    {frame.failure ? (
                      <p className="stack-frames__failure">{frame.failure}</p>
                    ) : null}
                    <SourceContext source={frame.source} location={frame.location} />
                  </div>
                ) : frame.failure ? (
                  <p className="stack-frames__failure">{frame.failure}</p>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function SourceContext({ source, location }: { source?: OriginalPosition; location: string }) {
  if (!source) {
    return (
      <p className="source-note">
        压缩后的位置 <code>{location}</code>。上传这个版本的 Source Map 后可查看源码。
      </p>
    );
  }
  const lines = source.sourceContent?.split("\n") ?? [];
  if (!lines.length) {
    return <p className="source-note">Source Map 未包含 sourcesContent，无法显示源码。</p>;
  }
  const from = Math.max(0, source.line - 4);
  const to = Math.min(lines.length, source.line + 3);
  return (
    <div className="source-context" aria-label={`源码 ${source.source}`}>
      <pre>
        <code>
          {lines.slice(from, to).map((line, offset) => {
            const lineNumber = from + offset + 1;
            return (
              <span
                key={lineNumber}
                className={lineNumber === source.line ? "is-error-line" : undefined}
              >
                <b>{lineNumber}</b>
                {line || " "}
                {"\n"}
              </span>
            );
          })}
        </code>
      </pre>
    </div>
  );
}
