import { MinusIcon, TrendingDownIcon, TrendingUpIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  apiFailureRate,
  formatAPIDuration,
  type APIsResponse,
  type APISummary,
  type APITrendPoint,
} from "@/lib/api/apis";
import { ApiScatter } from "./ApiScatter";
import { ApiTimeSpent } from "./ApiTimeSpent";
import { ApiTrend } from "./ApiTrend";

type Endpoint = APIsResponse["endpoints"][number];

/** Whether a rising value should read as a regression or as neutral growth. */
type Direction = "inverse" | "neutral";

export function ApiOverview({
  summary,
  previous,
  trend,
  endpoints,
  onSelect,
}: {
  summary: APISummary;
  previous?: APISummary;
  trend: readonly APITrendPoint[];
  endpoints: readonly Endpoint[];
  onSelect: (endpoint: Endpoint) => void;
}) {
  const failureRate = apiFailureRate(summary);
  const previousFailureRate = previous ? apiFailureRate(previous) : undefined;
  return (
    <section className="api-overview" aria-label="API 健康概览">
      <div className="api-summary-grid">
        <SummaryCard
          label="请求量"
          value={Math.round(summary.estimated).toLocaleString()}
          note={`${summary.requests.toLocaleString()} 个采样事件`}
          change={relativeChange(summary.estimated, previous?.estimated)}
          direction="neutral"
        />
        <SummaryCard
          label="失败率"
          value={`${failureRate.toFixed(2)}%`}
          note={`${summary.failures.toLocaleString()} 次失败 · 不含 4xx`}
          change={pointChange(failureRate, previousFailureRate)}
          direction="inverse"
        />
        <SummaryCard
          label="P95 延迟"
          value={formatAPIDuration(summary.p95)}
          note={`P50 ${formatAPIDuration(summary.p50)} · P75 ${formatAPIDuration(summary.p75)}`}
          change={relativeChange(summary.p95, previous?.p95)}
          direction="inverse"
        />
        <SummaryCard
          label="网络错误"
          value={summary.networkErrors.toLocaleString()}
          note={`${summary.serverErrors.toLocaleString()} 次 5xx · ${summary.clientErrors.toLocaleString()} 次 4xx`}
          change={relativeChange(summary.networkErrors, previous?.networkErrors)}
          direction="inverse"
        />
      </div>
      <Card className="api-trend-card">
        <CardHeader>
          <div>
            <CardTitle>请求量与失败趋势</CardTitle>
            <CardDescription>
              覆盖当前筛选下的全部 {summary.endpoints.toLocaleString()} 个
              endpoint。堆叠高度即该时段请求量，失败与 4xx 贴零轴便于看出变化；悬停可看各段占比与
              P95。
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <ApiTrend trend={trend} label="全部 endpoint " size="lg" />
        </CardContent>
      </Card>
      <div className="api-priority-grid">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>请求量与 P95 分布</CardTitle>
              <CardDescription>
                两轴均为对数刻度。右上角同时高频且慢的 endpoint 最值得先修；失败率超过 5%
                标红，空心点的分位数样本偏少。
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <ApiScatter endpoints={endpoints} overallP95={summary.p95} onSelect={onSelect} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>耗时占比</CardTitle>
              <CardDescription>
                按请求量 × P95 加权，用于比较相对权重，而非真实累计耗时。
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <ApiTimeSpent endpoints={endpoints} onSelect={onSelect} />
          </CardContent>
        </Card>
      </div>
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

function pointChange(current: number, previous: number | undefined): Change {
  if (previous === undefined) return undefined;
  const difference = current - previous;
  return { text: `${difference > 0 ? "+" : ""}${difference.toFixed(2)}pp`, sign: sign(difference) };
}

function sign(value: number): -1 | 0 | 1 {
  if (Math.abs(value) < 0.05) return 0;
  return value > 0 ? 1 : -1;
}
