import { MinusIcon, TrendingDownIcon, TrendingUpIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  apiFailureRate,
  formatAPIFailureRate,
  formatAPIDuration,
  sampledNote,
  type APISummary,
  type APITrendPoint,
} from "@/lib/api/apis";
import { ApiCharts } from "./ApiCharts";
import type { ApiTrendRange } from "./plotData";

/** Whether a rising value should read as a regression or as neutral growth. */
type Direction = "inverse" | "neutral";

export function ApiOverview({
  summary,
  previous,
  trend,
  range,
}: {
  summary: APISummary;
  previous?: APISummary;
  trend: readonly APITrendPoint[];
  range: ApiTrendRange;
}) {
  const failureRate = apiFailureRate(summary);
  const previousFailureRate = previous ? apiFailureRate(previous) : undefined;
  return (
    <section className="api-overview" aria-label="API 健康概览">
      <div className="api-summary-grid">
        <SummaryCard
          label="请求量"
          value={Math.round(summary.estimated).toLocaleString()}
          note={summary.requests ? (sampledNote(summary) ?? "按全部请求计数") : "暂无请求样本"}
          change={relativeChange(summary.estimated, previous?.estimated)}
          direction="neutral"
        />
        <SummaryCard
          label="失败率"
          value={formatAPIFailureRate(summary)}
          note={
            failureRate === null
              ? "暂无请求样本，无法计算失败率"
              : `5xx 与网络错误 · 不含 ${summary.clientErrors.toLocaleString()} 次 4xx`
          }
          change={pointChange(failureRate, previousFailureRate)}
          direction="inverse"
        />
        <SummaryCard
          label="P95 延迟"
          value={formatAPIDuration(summary.p95)}
          note={`P50 ${formatAPIDuration(summary.p50)} · P75 ${formatAPIDuration(summary.p75)}`}
          change={
            summary.requests > 0 && previous && previous.requests > 0
              ? relativeChange(summary.p95, previous.p95)
              : undefined
          }
          direction="inverse"
        />
        <SummaryCard
          label="失败请求"
          value={summary.failures.toLocaleString()}
          note={`${summary.serverErrors.toLocaleString()} 次 5xx · ${summary.networkErrors.toLocaleString()} 次网络错误`}
          change={relativeChange(summary.failures, previous?.failures)}
          direction="inverse"
        />
      </div>
      {summary.requests > 0 ? (
        <ApiCharts trend={trend} range={range} scope="全部 endpoint" />
      ) : null}
    </section>
  );
}

type Change = { text: string; sign: -1 | 0 | 1 } | undefined;

function SummaryCard({
  label,
  value,
  note,
  change,
  direction,
}: {
  label: string;
  value: string;
  note: string;
  change: Change;
  direction: Direction;
}) {
  return (
    <Card className="api-summary-card" size="sm">
      <CardHeader>
        <CardTitle>{label}</CardTitle>
        {change ? <ChangeBadge change={change} direction={direction} /> : null}
      </CardHeader>
      <CardContent>
        <strong>{value}</strong>
        <span>{note}</span>
      </CardContent>
    </Card>
  );
}

function ChangeBadge({ change, direction }: { change: NonNullable<Change>; direction: Direction }) {
  const Icon = change.sign > 0 ? TrendingUpIcon : change.sign < 0 ? TrendingDownIcon : MinusIcon;
  const tone =
    change.sign === 0 || direction === "neutral"
      ? "flat"
      : change.sign > 0
        ? "regression"
        : "improvement";
  return (
    <span className="api-summary-change" data-tone={tone} title="对比上一个等长周期">
      <Icon />
      {change.text}
    </span>
  );
}

function relativeChange(current: number | null, previous: number | null | undefined): Change {
  if (current === null || previous === null || previous === undefined || previous === 0) {
    return undefined;
  }
  const ratio = ((current - previous) / previous) * 100;
  return { text: `${ratio > 0 ? "+" : ""}${ratio.toFixed(1)}%`, sign: sign(ratio) };
}

function pointChange(current: number | null, previous: number | null | undefined): Change {
  if (current === null || previous === null || previous === undefined) return undefined;
  const difference = current - previous;
  return { text: `${difference > 0 ? "+" : ""}${difference.toFixed(2)}pp`, sign: sign(difference) };
}

function sign(value: number): -1 | 0 | 1 {
  if (Math.abs(value) < 0.05) return 0;
  return value > 0 ? 1 : -1;
}
