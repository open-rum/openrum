import { useState } from "react";
import { timeAxis, valueAxis, VALUE_AXIS_MARGIN_TOP } from "@/lib/charts/axes";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { changeTone, formatChange, periodChange } from "@/lib/charts/comparison";
import { smoothCurve } from "@/lib/charts/smoothCurve";
import { useBarRadiusTop } from "@/lib/charts/useBarRadius";
import { useChartMotion } from "@/lib/charts/useChartMotion";
import { cn } from "@/lib/utils";
import { countryLabel, deviceLabel } from "@/features/filters/dimensionLabels";
import { sessionEventHref } from "@/lib/api/sessions";
import {
  formatPerformanceMetric,
  performanceMetricNames,
  type PerformanceMetricKey,
  type PerformanceMetricName,
  type PerformancePercentile,
  type PerformanceResponse,
} from "@/lib/api/performance";
import { performanceRating, performanceThresholds, ratingBadge, ratingLabel } from "./score";
import { formatTrendDate } from "./trendTime";
import {
  alignPrevious,
  bucketRating,
  denseDistribution,
  latestReleases,
  quantileMarks,
  ratingShares,
  releaseMarkers,
  trendGrid,
} from "./routeDetailModel";

type Detail = NonNullable<PerformanceResponse["detail"]>;
type Summary = PerformanceResponse["summary"];
type Metric = Detail["trend"][number]["metric"];

const ratingFill = {
  good: "var(--color-success)",
  "needs-improvement": "var(--color-warning)",
  poor: "var(--color-error)",
  unknown: "var(--color-base-300)",
} as const;
const toneText = { positive: "text-success", negative: "text-error", neutral: "" } as const;

const keyOf = (name: PerformanceMetricName) => name.toLowerCase() as PerformanceMetricKey;

/** Previous-period comparison as numbers only: the value and the change, never a verdict. */
function comparison(
  current: number | null | undefined,
  previous: number | null | undefined,
  metric: PerformanceMetricName,
) {
  const change = periodChange(current, previous, false);
  return {
    change,
    text: formatChange(change, false),
    previousText: formatPerformanceMetric(previous ?? null, metric),
    // Lower is better for every vital.
    tone: toneText[changeTone(change, false, "down")],
  };
}

export function RouteDetail({
  projectId,
  detail,
  summary,
  previousSummary,
  previousTrend,
  durationMs,
  range,
  percentile,
  onMetricChange,
}: {
  projectId: string;
  detail: Detail;
  summary: Summary;
  /** Undefined while the previous window loads or when it fails; the page still renders. */
  previousSummary?: Summary;
  previousTrend?: Detail["trend"];
  durationMs: number;
  /** The response window and bucket width, used to keep empty buckets on the trend. */
  range?: { from?: string; to?: string; intervalSeconds?: number };
  percentile: PerformancePercentile;
  onMetricChange: (value: PerformanceMetricName) => void;
}) {
  const metric = detail.metric;
  const label = percentile.toUpperCase();
  const current = summary?.[keyOf(metric)];
  const value = current?.[percentile] ?? null;
  const rating = performanceRating(current?.sufficient ? current.p75 : null, metric);
  const compare = comparison(value, previousSummary?.[keyOf(metric)]?.[percentile], metric);
  const shares = ratingShares(detail.distribution, metric);
  const grid = trendGrid(detail.trend, range);
  const releases = latestReleases(grid, detail.releases, percentile);
  return (
    <div className="performance-detail">
      <section className="card card-border bg-base-100" aria-label={`${metric} 概况与指标选择`}>
        <div className="card-body gap-4">
          {/* Facts only: value, P75 rating, previous period, poor share. No inferred cause. */}
          <p
            className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-base"
            data-route-summary=""
          >
            <strong className="font-semibold tabular-nums">
              {metric} {label} {formatPerformanceMetric(value, metric)}
            </strong>
            {current?.sufficient ? (
              <span className={cn("badge badge-sm badge-soft", ratingBadge[rating])}>
                {percentile === "p75" ? "" : "P75 "}
                {ratingLabel(rating)}
              </span>
            ) : null}
            <span className="text-base-content/40" aria-hidden="true">
              ·
            </span>
            <span className="tabular-nums">
              上一周期 {compare.previousText}
              {compare.change === null ? null : (
                <span className={cn("ml-1 font-medium", compare.tone)}>（{compare.text}）</span>
              )}
            </span>
            {shares ? (
              <>
                <span className="text-base-content/40" aria-hidden="true">
                  ·
                </span>
                <span>
                  <strong className="font-semibold tabular-nums">
                    {shares.approximate ? "约 " : ""}
                    {Math.round(shares.poor * 100)}%
                  </strong>{" "}
                  的样本体验较差
                </span>
              </>
            ) : null}
            {releases ? (
              <>
                <span className="text-base-content/40" aria-hidden="true">
                  ·
                </span>
                {/* The two newest releases side by side; the reader draws the conclusion. */}
                <span
                  className="inline-flex flex-wrap items-center gap-1.5 tabular-nums"
                  data-release-compare=""
                >
                  {releases.map((release, index) => (
                    <span key={release.value} className="inline-flex items-center gap-1.5">
                      {index ? <span className="text-base-content/50">vs</span> : null}
                      <span className="badge badge-sm badge-outline font-mono">
                        {release.value}
                      </span>
                      {formatPerformanceMetric(release.metric[percentile] ?? null, metric)}
                    </span>
                  ))}
                </span>
              </>
            ) : null}
          </p>
          <div
            className="grid grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] gap-2"
            role="group"
            aria-label="选择指标"
          >
            {performanceMetricNames.map((name) => (
              <MetricButton
                key={name}
                name={name}
                metric={summary?.[keyOf(name)]}
                previous={previousSummary?.[keyOf(name)]}
                percentile={percentile}
                active={name === metric}
                onSelect={() => onMetricChange(name)}
              />
            ))}
          </div>
        </div>
      </section>

      <div className="performance-analysis-grid">
        <Card>
          <CardHeader>
            <CardTitle>
              {metric} {label} 趋势
            </CardTitle>
            <CardDescription>
              实线为本周期，灰色虚线为上一周期同一时段，竖线为版本在本范围内首次出现；每个时间桶独立计算，空缺不补零。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RouteTrendChart
              trend={grid}
              previous={previousTrend}
              durationMs={durationMs}
              metric={metric}
              percentile={percentile}
              releases={releaseMarkers(grid, detail.releases)}
            />
          </CardContent>
        </Card>
        <DistributionCard detail={detail} metric={current} />
      </div>

      <BreakdownCard detail={detail} percentile={percentile} />
      <SamplesCard detail={detail} projectId={projectId} />
    </div>
  );
}

function MetricButton({
  name,
  metric,
  previous,
  percentile,
  active,
  onSelect,
}: {
  name: PerformanceMetricName;
  metric: Metric | undefined;
  previous: Metric | undefined;
  percentile: PerformancePercentile;
  active: boolean;
  onSelect: () => void;
}) {
  const value = metric?.[percentile] ?? null;
  const rating = performanceRating(metric?.sufficient ? metric.p75 : null, name);
  const compare = comparison(value, previous?.[percentile], name);
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onSelect}
      className={cn(
        "flex min-h-11 flex-col items-start gap-1 rounded-box border bg-base-100 px-3.5 py-3 text-left transition-colors",
        active ? "border-primary" : "border-base-300 hover:bg-base-200",
      )}
    >
      <span className="flex w-full items-center justify-between gap-2 text-xs font-semibold">
        {name}
        {metric?.sufficient ? (
          <span className={cn("badge badge-xs badge-soft", ratingBadge[rating])}>
            {ratingLabel(rating)}
          </span>
        ) : null}
      </span>
      <span className="text-lg font-bold tabular-nums">{formatPerformanceMetric(value, name)}</span>
      <span className={cn("text-xs tabular-nums text-base-content/70", compare.tone)}>
        {compare.change === null ? "上一周期无对比" : `环比 ${compare.text}`}
      </span>
    </button>
  );
}

function RouteTrendChart({
  trend,
  previous,
  durationMs,
  metric,
  percentile,
  releases = [],
}: {
  trend: ReturnType<typeof trendGrid>;
  previous?: Detail["trend"];
  durationMs: number;
  metric: PerformanceMetricName;
  percentile: PerformancePercentile;
  releases?: { bucket: string; release: string }[];
}) {
  const animate = useChartMotion();
  const data = alignPrevious(trend, previous, durationMs).map((point) => ({
    bucket: point.current.bucket,
    value: point.current.metric?.[percentile] ?? null,
    samples: point.current.metric?.samples ?? 0,
    previous: point.previous?.metric?.[percentile] ?? null,
  }));
  if (!data.some((point) => point.value !== null))
    return <div className="performance-metric-trend-empty">当前范围暂无趋势数据</div>;
  const config = {
    value: { label: `本周期 ${percentile.toUpperCase()}`, color: "var(--color-primary)" },
    previous: { label: "上一周期", color: "var(--color-base-content)" },
  } satisfies ChartConfig;
  // A real point with no neighbour on either side would otherwise vanish between gaps.
  const isolated = (key: "value" | "previous", color: string, opacity = 1) =>
    function Dot({ cx, cy, index = -1 }: { cx?: number; cy?: number; index?: number }) {
      const has = (at: number) => data[at]?.[key] != null;
      return has(index) && !has(index - 1) && !has(index + 1) ? (
        <circle cx={cx} cy={cy} r={2.5} fill={color} fillOpacity={opacity} />
      ) : (
        <></>
      );
    };
  const threshold = performanceThresholds[metric];
  const short =
    Date.parse(data[data.length - 1].bucket) - Date.parse(data[0].bucket) < 2 * 86400000;
  return (
    <ChartContainer
      className="performance-metric-trend"
      config={config}
      initialDimension={{ width: 360, height: 220 }}
      role="img"
      aria-label={`${metric} ${percentile.toUpperCase()} 趋势，与上一周期对比`}
    >
      <LineChart
        accessibilityLayer
        data={data}
        margin={{ top: VALUE_AXIS_MARGIN_TOP, right: 0, bottom: 0, left: 0 }}
      >
        <CartesianGrid vertical={false} stroke="var(--ds-border-soft)" strokeDasharray="2 3" />
        <XAxis
          dataKey="bucket"
          minTickGap={32}
          {...timeAxis((value) => formatTrendDate(String(value), short))}
        />
        <YAxis
          domain={[0, "auto"]}
          {...valueAxis({
            unit: metric === "CLS" ? undefined : "ms",
            format: (value) =>
              metric === "CLS" ? value.toFixed(2) : Math.round(value).toLocaleString("zh-CN"),
          })}
        />
        {percentile === "p75" ? (
          <>
            <ReferenceLine y={threshold.good} stroke="var(--color-success)" strokeDasharray="3 3" />
            <ReferenceLine y={threshold.poor} stroke="var(--color-error)" strokeDasharray="3 3" />
          </>
        ) : null}
        {releases.map((marker) => (
          <ReferenceLine
            key={marker.release}
            x={marker.bucket}
            stroke="var(--color-base-content)"
            strokeOpacity={0.35}
            label={{
              value: marker.release,
              position: "insideTopLeft",
              fontSize: 11,
              fill: "var(--color-base-content)",
            }}
          />
        ))}
        <ChartTooltip
          cursor={{ stroke: "var(--ds-border)" }}
          content={({ active, payload }) => {
            const point = payload?.[0]?.payload as (typeof data)[number] | undefined;
            if (!active || !point) return null;
            return (
              <div className="performance-chart-tooltip">
                <strong>{formatTrendDate(point.bucket, true)}</strong>
                <span>
                  本周期 {formatPerformanceMetric(point.value, metric)} ·{" "}
                  {point.samples.toLocaleString()} 个样本
                </span>
                <span>上一周期 {formatPerformanceMetric(point.previous, metric)}</span>
              </div>
            );
          }}
        />
        <Line
          {...smoothCurve}
          dataKey="previous"
          stroke="var(--color-previous)"
          strokeOpacity={0.4}
          strokeWidth={1.5}
          strokeDasharray="4 4"
          dot={isolated("previous", "var(--color-previous)", 0.5)}
          activeDot={false}
          connectNulls={false}
          isAnimationActive={animate}
        />
        <Line
          {...smoothCurve}
          dataKey="value"
          stroke="var(--color-value)"
          strokeWidth={2}
          dot={isolated("value", "var(--color-value)")}
          activeDot={{ r: 3 }}
          connectNulls={false}
          isAnimationActive={animate}
        />
      </LineChart>
    </ChartContainer>
  );
}

function DistributionCard({ detail, metric: current }: { detail: Detail; metric?: Metric }) {
  const barRadius = useBarRadiusTop();
  const animate = useChartMotion();
  const metric = detail.metric;
  const shares = ratingShares(detail.distribution, metric);
  const dense = denseDistribution(detail.distribution);
  const marks = quantileMarks(dense, [
    { label: "P50", value: current?.p50 },
    { label: "P75", value: current?.p75 },
    { label: "P95", value: current?.p95 },
  ]);
  const distribution = dense.map((bucket) => ({
    ...bucket,
    rating: bucketRating(bucket, metric),
    label: bucket.overflow
      ? `≥ ${formatPerformanceMetric(bucket.from, metric)}`
      : `${formatPerformanceMetric(bucket.from, metric)} – ${formatPerformanceMetric(bucket.to, metric)}`,
  }));
  const percent = (value: number) =>
    `${shares?.approximate ? "约 " : ""}${Math.round(value * 100)}%`;
  return (
    <Card>
      <CardHeader>
        <CardTitle>样本分布</CardTitle>
        <CardDescription>
          保留期内的原始样本{shares ? ` · ${shares.total.toLocaleString()} 个` : ""}
          ；柱色按区间所在的良好 / 待优化 / 较差档，≥ 表示包含所有更大值。
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {shares ? (
          <>
            <div className="flex h-2 gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
              <span className="bg-success" style={{ width: `${shares.good * 100}%` }} />
              <span className="bg-warning" style={{ width: `${shares.needsImprovement * 100}%` }} />
              <span className="flex-1 bg-error" />
            </div>
            <div
              className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-semibold"
              data-rating-shares=""
            >
              <span className="text-success">良好 {percent(shares.good)}</span>
              <span className="text-warning">待优化 {percent(shares.needsImprovement)}</span>
              <span className="text-error">较差 {percent(shares.poor)}</span>
            </div>
          </>
        ) : null}
        {distribution.length ? (
          <ChartContainer
            className="performance-metric-trend"
            config={{ samples: { label: "样本数", color: "var(--color-base-content)" } }}
            initialDimension={{ width: 360, height: 176 }}
            role="img"
            aria-label={
              shares
                ? `${metric} 样本分布：良好 ${percent(shares.good)}，待优化 ${percent(shares.needsImprovement)}，较差 ${percent(shares.poor)}`
                : `${metric} 样本分布`
            }
          >
            <BarChart
              accessibilityLayer
              data={distribution}
              margin={{ top: VALUE_AXIS_MARGIN_TOP, right: 0, left: 0 }}
            >
              <CartesianGrid vertical={false} stroke="var(--ds-border-soft)" />
              <XAxis
                dataKey="from"
                minTickGap={30}
                {...timeAxis(
                  (value) =>
                    `${distribution.find((bucket) => bucket.from === value)?.overflow ? "≥ " : ""}${formatPerformanceMetric(Number(value), metric)}`,
                )}
              />
              <YAxis allowDecimals={false} {...valueAxis({ unit: "个样本" })} />
              <ChartTooltip
                cursor={{ fill: "var(--color-base-200)" }}
                content={({ active, payload }) => {
                  const point = payload?.[0]?.payload as (typeof distribution)[number] | undefined;
                  return active && point ? (
                    <div className="performance-chart-tooltip">
                      <strong>{point.label}</strong>
                      <span>
                        {point.samples} 个样本 · {ratingLabel(point.rating)}
                      </span>
                    </div>
                  ) : null;
                }}
              />
              {marks.map((mark) => (
                <ReferenceLine
                  key={mark.from}
                  x={mark.from}
                  stroke="var(--color-base-content)"
                  strokeOpacity={0.7}
                  strokeDasharray="3 3"
                  label={{
                    value: mark.label,
                    // The last bucket sits on the right edge; keep its label inside the plot.
                    position: mark.from === distribution.at(-1)?.from ? "insideTopRight" : "top",
                    fontSize: 11,
                    fontWeight: 600,
                    fill: "var(--color-base-content)",
                  }}
                />
              ))}
              <Bar dataKey="samples" radius={barRadius} isAnimationActive={animate}>
                {distribution.map((bucket) => (
                  <Cell key={bucket.from} fill={ratingFill[bucket.rating]} fillOpacity={0.85} />
                ))}
              </Bar>
            </BarChart>
          </ChartContainer>
        ) : (
          <p className="performance-scope-note">当前范围没有原始分布样本。</p>
        )}
      </CardContent>
    </Card>
  );
}

const breakdowns = [
  { key: "deviceTypes", label: "设备", format: deviceLabel },
  { key: "browsers", label: "浏览器", format: (value: string) => value },
  { key: "countries", label: "地区", format: countryLabel },
  { key: "releases", label: "版本", format: (value: string) => value },
] as const;

function BreakdownCard({
  detail,
  percentile,
}: {
  detail: Detail;
  percentile: PerformancePercentile;
}) {
  const [dimension, setDimension] = useState<(typeof breakdowns)[number]["key"]>("deviceTypes");
  const metric = detail.metric;
  const label = percentile.toUpperCase();
  const rows = [...detail[dimension]].sort(
    (a, b) => (b.metric[percentile] ?? -1) - (a.metric[percentile] ?? -1),
  );
  const total = rows.reduce((sum, row) => sum + row.metric.samples, 0);
  const current = breakdowns.find((item) => item.key === dimension)!;
  return (
    <section className="card card-border bg-base-100" aria-labelledby="route-breakdown-title">
      <div className="card-body gap-3 pb-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-0.5">
            <h3 id="route-breakdown-title" className="card-title text-base">
              影响了谁
            </h3>
            <p className="text-xs text-base-content/70">
              按 {metric} {label} 从慢到快 · 样本占比为该维度内的样本数占比 · 判定按 P75
            </p>
          </div>
          <div className="tabs tabs-box tabs-sm" role="group" aria-label="拆分维度">
            {breakdowns.map((item) => (
              <button
                key={item.key}
                type="button"
                className={cn("tab", item.key === dimension && "tab-active")}
                aria-pressed={item.key === dimension}
                onClick={() => setDimension(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        {rows.length ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{current.label}</TableHead>
                  <TableHead className="text-right">样本占比</TableHead>
                  <TableHead className="text-right">
                    {metric} {label}
                  </TableHead>
                  <TableHead className="text-right">样本</TableHead>
                  <TableHead>判定</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const rating = performanceRating(
                    row.metric.sufficient ? row.metric.p75 : null,
                    metric,
                  );
                  return (
                    <TableRow key={row.value}>
                      <TableCell className="font-medium">
                        {row.value ? current.format(row.value) : "未知"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {total ? `${Math.round((row.metric.samples / total) * 100)}%` : "—"}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {formatPerformanceMetric(row.metric[percentile] ?? null, metric)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.metric.samples.toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <span
                          className={cn(
                            "badge badge-sm badge-soft",
                            row.metric.sufficient ? ratingBadge[rating] : "badge-ghost",
                          )}
                        >
                          {row.metric.sufficient ? ratingLabel(rating) : "样本不足"}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="performance-scope-note">当前范围没有可拆分的样本。</p>
        )}
      </div>
    </section>
  );
}

function SamplesCard({ detail, projectId }: { detail: Detail; projectId: string }) {
  return (
    <section className="card card-border bg-base-100" aria-labelledby="route-samples-title">
      <div className="card-body gap-3 pb-2">
        <div className="grid gap-0.5">
          <h3 id="route-samples-title" className="card-title text-base">
            最慢样本
          </h3>
          <p className="text-xs text-base-content/70">
            保留期内最慢的 25 个原始事件，不代表全部用户的体验；切换分位数不改变排序。
          </p>
        </div>
        {detail.samples.length ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>时间</TableHead>
                  <TableHead className="text-right">{detail.metric}</TableHead>
                  <TableHead>页面</TableHead>
                  <TableHead>设备 · 浏览器</TableHead>
                  <TableHead>地区</TableHead>
                  <TableHead>版本</TableHead>
                  <TableHead>
                    <span className="sr-only">会话</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.samples.map((sample) => (
                  <TableRow key={sample.eventId}>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {formatTrendDate(sample.timestamp, true)}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {formatPerformanceMetric(sample.value, detail.metric)}
                    </TableCell>
                    <TableCell>
                      <code className="block max-w-80 truncate text-xs" title={sample.pageUrl}>
                        {sample.pageUrl}
                      </code>
                    </TableCell>
                    <TableCell>
                      {[sample.deviceType && deviceLabel(sample.deviceType), sample.browser]
                        .filter(Boolean)
                        .join(" · ") || "未知"}
                    </TableCell>
                    <TableCell>{sample.country ? countryLabel(sample.country) : "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{sample.release || "—"}</TableCell>
                    <TableCell className="text-right">
                      {sample.sessionId ? (
                        <a
                          className="link text-xs whitespace-nowrap"
                          href={sessionEventHref(
                            projectId,
                            sample.sessionId,
                            sample.timestamp,
                            sample.eventId,
                          )}
                        >
                          查看会话
                        </a>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="performance-scope-note">
            没有匹配的原始事件；聚合数据与原始事件保留期可能不同。
          </p>
        )}
      </div>
    </section>
  );
}
