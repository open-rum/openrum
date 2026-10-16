import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CopyIcon, SearchIcon } from "lucide-react";
import { toast } from "sonner";
import { AsyncError } from "@/components/ui/AsyncState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { countryLabel } from "@/features/filters/dimensionLabels";
import {
  formatAPIBytes,
  getAPISamples,
  type APIFilters,
  type APISample,
  type APISummary,
} from "@/lib/api/apis";
import { sessionEventHref } from "@/lib/api/sessions";
import {
  durationPosition,
  failureLabel,
  formatStamp,
  loadState,
  personOf,
  shortId,
  statusText,
  versioned,
} from "./sampleFormat";
import { SampleExtras } from "./SampleExtras";

/** Waits for typing to pause, so a user ID is searched once rather than once per keystroke. */
function useSettled(value: string, delay = 300) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

/**
 * Every recorded request of one endpoint: a list to scan on the left and everything known
 * about the selected one on the right. The search matches the start of either user ID, the
 * SDK's anonymous one or the signed-in one the application set.
 */
export function ApiSamples({
  filters,
  endpoint,
  projectId,
}: {
  filters: APIFilters;
  endpoint: Pick<APISummary, "p50" | "p75" | "p95">;
  projectId: string;
}) {
  const [typed, setTyped] = useState("");
  const user = useSettled(typed.trim());
  const [selectedId, setSelectedId] = useState<string>();
  const query = useQuery({
    queryKey: [
      "api-samples",
      filters.projectId,
      filters.from.toISOString(),
      filters.to.toISOString(),
      filters.environment,
      filters.release,
      filters.route,
      filters.method,
      filters.url,
      user,
    ],
    queryFn: ({ signal }) => getAPISamples(filters, user, signal),
    // A new search keeps the previous list on screen until its answer arrives.
    placeholderData: keepPreviousData,
  });
  const samples = query.data?.samples ?? [];
  // The first request is open until one is picked, and again when the picked one is gone.
  const selected = samples.find((sample) => sample.eventId === selectedId) ?? samples[0];

  return (
    <div className="api-samples">
      <div className="api-samples__list">
        <label className="api-samples__search">
          <SearchIcon aria-hidden="true" />
          <Input
            type="search"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder="搜索用户 ID（匿名或业务）"
            aria-label="按用户 ID 搜索请求"
            maxLength={128}
          />
        </label>
        {query.isLoading ? <Skeleton className="h-64" /> : null}
        {query.error ? (
          <AsyncError
            error={query.error}
            title="请求列表加载失败"
            remediation="缩短时间范围后重试。"
            onRetry={() => void query.refetch()}
          />
        ) : null}
        {query.data && !samples.length ? (
          <EmptyState
            title={user ? "没有匹配的请求" : "当前范围没有请求"}
            description={
              user
                ? "只匹配用户 ID 的开头。换一个更短的开头，或去掉搜索再试。"
                : "放宽时间范围，或确认这个 endpoint 仍在上报。"
            }
          />
        ) : null}
        {samples.length ? (
          <ul
            className="api-samples__items"
            aria-label="请求列表"
            data-fetching={query.isFetching || undefined}
          >
            {samples.map((sample) => (
              <li key={sample.eventId}>
                <SampleRow
                  sample={sample}
                  selected={sample.eventId === selected?.eventId}
                  onSelect={() => setSelectedId(sample.eventId)}
                />
              </li>
            ))}
          </ul>
        ) : null}
        {query.data?.truncated ? (
          <p className="api-samples__note">
            只显示最新的 {samples.length} 条。用用户 ID 缩小范围。
          </p>
        ) : null}
      </div>
      <div className="api-samples__detail">
        {selected ? (
          <SampleDetail sample={selected} endpoint={endpoint} projectId={projectId} />
        ) : (
          <p className="api-samples__note">选择左侧的一条请求，查看它的全部信息。</p>
        )}
      </div>
    </div>
  );
}

function SampleRow({
  sample,
  selected,
  onSelect,
}: {
  sample: APISample;
  selected: boolean;
  onSelect: () => void;
}) {
  const state = loadState(sample);
  const person = personOf(sample);
  return (
    <button
      type="button"
      className="api-sample-row"
      aria-current={selected || undefined}
      onClick={onSelect}
    >
      <span className="api-sample-row__time">{formatStamp(sample.timestamp).slice(5)}</span>
      <Badge
        variant={
          state.tone === "danger" ? "destructive" : state.tone === "warning" ? "warning" : "outline"
        }
      >
        {statusText(sample)}
      </Badge>
      <span className="api-sample-row__user" title={person || undefined}>
        {person ? shortId(person, 14) : ""}
      </span>
      <span className="api-sample-row__duration">{Math.round(sample.durationMs)} ms</span>
    </button>
  );
}

function SampleDetail({
  sample,
  endpoint,
  projectId,
}: {
  sample: APISample;
  endpoint: Pick<APISummary, "p50" | "p75" | "p95">;
  projectId: string;
}) {
  const state = loadState(sample);
  const badge = toneVariant(state.tone);
  // The status, size and load state are in the summary above; only a failure adds something here.
  const errorText =
    failureLabel(sample.failure) ?? (sample.status >= 400 ? `HTTP ${sample.status}` : undefined);
  return (
    <div className="api-sample-detail">
      <header className="api-sample-summary">
        <p className="api-sample-summary__url">
          <Badge variant="outline">{sample.method}</Badge>
          <code>{sample.url}</code>
        </p>
        <ul aria-label="请求概览">
          <li>
            <Badge variant={badge}>{statusText(sample)}</Badge>
            <span>{state.label}</span>
          </li>
          <li>{Math.round(sample.durationMs).toLocaleString()} ms</li>
          <li>{sample.transferSize ? formatAPIBytes(sample.transferSize) : "无大小信息"}</li>
          <li>{formatStamp(sample.timestamp)}</li>
        </ul>
      </header>

      <section className="api-sample-card" aria-labelledby="sample-basics">
        <h3 id="sample-basics">基础信息</h3>
        <FactGroup title="请求">
          <Fact label="页面名称" half>
            <code>{sample.route || sample.pageUrl || "—"}</code>
          </Fact>
          {errorText ? (
            <Fact label="错误信息" half>
              {errorText}
            </Fact>
          ) : null}
        </FactGroup>
        <FactGroup title="设备与环境">
          <Fact label="设备类型">{sample.deviceType || "—"}</Fact>
          <Fact label="操作系统">{versioned(sample.os, sample.osVersion) ?? "—"}</Fact>
          <Fact label="浏览器">{versioned(sample.browser, sample.browserVersion) ?? "—"}</Fact>
          <Fact label="国家 / 地区">{sample.country ? countryLabel(sample.country) : "—"}</Fact>
          <Fact label="环境类型">{sample.environment || "—"}</Fact>
          <Fact label="版本">{sample.release || "—"}</Fact>
        </FactGroup>
        <FactGroup title="用户与会话">
          <Fact label="访问用户标识（匿名）" half>
            <Copyable value={sample.anonymousUserId} label="复制匿名用户 ID" />
          </Fact>
          <Fact label="业务用户标识" half>
            <Copyable value={sample.userId} label="复制业务用户 ID" />
          </Fact>
          <Fact label="会话 ID" half>
            <Copyable value={sample.sessionId} label="复制会话 ID" />
            <a
              className="api-sample-link"
              href={sessionEventHref(projectId, sample.sessionId, sample.timestamp, sample.eventId)}
            >
              查看会话
            </a>
          </Fact>
          {sample.traceId ? (
            <Fact label="Trace ID" half>
              <Copyable value={sample.traceId} label="复制 Trace ID" />
            </Fact>
          ) : null}
        </FactGroup>
      </section>

      <SampleExtras sample={sample} projectId={projectId} />

      <section className="api-sample-card" aria-labelledby="sample-timing">
        <h3 id="sample-timing">耗时</h3>
        <DurationScale durationMs={sample.durationMs} endpoint={endpoint} />
      </section>
    </div>
  );
}

function toneVariant(tone: "ok" | "warning" | "danger") {
  return tone === "danger" ? "destructive" : tone === "warning" ? "warning" : "outline";
}

/** A titled block of facts; the title is left out for a block that stands alone. */
function FactGroup({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="api-sample-group">
      {title ? <h4>{title}</h4> : null}
      <dl className="api-sample-facts">{children}</dl>
    </div>
  );
}

/** Three facts to a row; `half` gives a fact half a row, `wide` a whole one. */
function Fact({
  label,
  half = false,
  wide = false,
  children,
}: {
  label: string;
  half?: boolean;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div data-half={half || undefined} data-wide={wide || undefined}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** An ID that is mostly copied: the whole value, one click to copy, a dash when absent. */
function Copyable({ value, label }: { value: string | undefined; label: string }) {
  if (!value) return <>—</>;
  return (
    <span className="api-sample-copy">
      <code>{value}</code>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={label}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            toast.success("已复制");
          } catch {
            toast.error("复制失败，请手动选择文本");
          }
        }}
      >
        <CopyIcon />
      </Button>
    </span>
  );
}

/**
 * This request's time against the endpoint's P50, P75 and P95, on one scale. The browser
 * reports one total, so DNS, connection, TLS and transfer cannot be split out; this says
 * where the total sits instead.
 */
function DurationScale({
  durationMs,
  endpoint,
}: {
  durationMs: number;
  endpoint: Pick<APISummary, "p50" | "p75" | "p95">;
}) {
  const position = durationPosition(durationMs, endpoint);
  return (
    <div className="api-duration">
      <p className="api-duration__total">
        <strong>{Math.round(durationMs).toLocaleString()} ms</strong>
        {position?.slowerThanP95 ? <Badge variant="warning">慢于该 endpoint 的 P95</Badge> : null}
      </p>
      {position ? (
        <div
          className="api-duration__scale"
          role="img"
          aria-label="本次请求耗时与 P50、P75、P95 的对比"
        >
          <i
            style={{ width: `${position.request}%` }}
            data-slow={position.slowerThanP95 || undefined}
          />
          {(
            [
              ["P50", position.p50, endpoint.p50],
              ["P75", position.p75, endpoint.p75],
              ["P95", position.p95, endpoint.p95],
            ] as const
          ).map(([name, left, value]) =>
            left === undefined || value === null ? null : (
              <span key={name} style={{ left: `${left}%` }}>
                <em>{name}</em>
                {Math.round(value)} ms
              </span>
            ),
          )}
        </div>
      ) : null}
      <p className="api-samples__note">
        浏览器只上报一个总耗时，阶段耗时（DNS、TCP、SSL、请求响应、内容传输）暂时拆不出来。
      </p>
    </div>
  );
}
