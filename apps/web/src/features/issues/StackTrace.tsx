import { useState } from "react";
import { AlertTriangleIcon, CheckCircle2Icon, FileCode2Icon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { EventDetail } from "@/lib/api/issues";

const failureLabels: Record<string, string> = {
  missing_release: "事件没有 release，无法匹配 Source Map",
  missing_artifact: "没有找到与脚本地址匹配的 Source Map",
  ambiguous_artifact: "存在多个匹配 artifact，请检查 release / dist",
  invalid_map: "Source Map 无法解析",
  unsupported_index_url: "暂不支持外部 indexed Source Map",
  no_mapping: "该位置没有可用映射",
  resource_limit: "堆栈或 Source Map 超出安全限制",
};

export function StackTrace({ event }: { event: EventDetail }) {
  const mapped = event.mappedStack;
  const mappedFrames = mapped?.frames.filter((frame) => frame.original) ?? [];
  const [activeFrame, setActiveFrame] = useState(0);
  const source = mappedFrames[activeFrame]?.original;
  const sourceLines = source?.sourceContent?.split("\n") ?? [];

  return (
    <section className="issue-panel issue-stack" aria-labelledby="stack-title">
      <div className="issue-panel__header">
        <div>
          <h2 id="stack-title">堆栈追踪</h2>
          <p>原始堆栈始终保留；映射结果仅作为可回退的增强信息。</p>
        </div>
        {mapped?.status ? (
          <Badge variant={mapped.status === "mapped" ? "secondary" : "outline"}>
            {mapped.status === "mapped"
              ? "已映射"
              : mapped.status === "partial"
                ? "部分映射"
                : "映射失败"}
          </Badge>
        ) : null}
      </div>
      <Tabs defaultValue={mappedFrames.length ? "mapped" : "original"}>
        <TabsList variant="line" aria-label="堆栈版本">
          <TabsTrigger value="mapped" disabled={!mappedFrames.length}>
            映射源码
          </TabsTrigger>
          <TabsTrigger value="original">原始堆栈</TabsTrigger>
        </TabsList>
        <TabsContent value="mapped" className="issue-stack__mapped">
          {mapped && mapped.status !== "mapped" ? (
            <Alert>
              <AlertTriangleIcon />
              <AlertTitle>映射结果不完整</AlertTitle>
              <AlertDescription>
                {failureLabels[mapped.failure ?? ""] ?? "部分帧仍显示生成代码位置。"}
              </AlertDescription>
            </Alert>
          ) : null}
          <div className="stack-workbench">
            <ol className="stack-frames" aria-label="映射后的调用帧">
              {mapped?.frames.map((frame, index) => {
                const mappedIndex = mappedFrames.findIndex((candidate) => candidate === frame);
                const position = frame.original;
                return (
                  <li key={`${frame.url}:${frame.line}:${frame.column}:${index}`}>
                    <button
                      type="button"
                      className={mappedIndex === activeFrame ? "is-active" : undefined}
                      disabled={!position}
                      onClick={() => setActiveFrame(mappedIndex)}
                    >
                      {position ? <CheckCircle2Icon /> : <AlertTriangleIcon />}
                      <span>
                        <strong>{position?.function || frame.function || "anonymous"}</strong>
                        <code>
                          {position
                            ? `${position.source}:${position.line}:${position.column}`
                            : `${frame.url}:${frame.line}:${frame.column}`}
                        </code>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
            <SourceContext source={source} lines={sourceLines} />
          </div>
        </TabsContent>
        <TabsContent value="original">
          <pre className="raw-stack">
            <code>{event.originalStack || mapped?.raw || "此事件没有堆栈。"}</code>
          </pre>
        </TabsContent>
      </Tabs>
    </section>
  );
}

function SourceContext({
  source,
  lines,
}: {
  source?: NonNullable<NonNullable<EventDetail["mappedStack"]>["frames"][number]["original"]>;
  lines: string[];
}) {
  if (!source) {
    return (
      <div className="source-empty">
        <FileCode2Icon />
        <p>选择一个已映射的调用帧查看源码。</p>
      </div>
    );
  }
  if (!lines.length) {
    return (
      <div className="source-empty">
        <FileCode2Icon />
        <p>
          {source.source}:{source.line}:{source.column}
        </p>
        <span>Source Map 未包含 sourcesContent。</span>
      </div>
    );
  }
  const from = Math.max(0, source.line - 4);
  const to = Math.min(lines.length, source.line + 3);
  return (
    <div className="source-context" aria-label={`源码 ${source.source}`}>
      <header>
        <FileCode2Icon />
        <code>{source.source}</code>
      </header>
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
