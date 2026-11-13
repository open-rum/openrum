import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { ChartNoAxesCombinedIcon, TriangleAlertIcon } from "lucide-react";
import { ConsolePage, ConsolePageHeader, ConsolePageTabs } from "@/components/layout/ConsolePage";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AsyncError } from "@/components/ui/AsyncState";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAnalysisContext } from "@/features/filters/AnalysisContextBar";
import { countryLabel } from "@/features/filters/dimensionLabels";
import { queryFunnel } from "@/lib/api/analytics";
import { metricsQueryString, queryMetrics, type MetricsQueryParams } from "@/lib/api/metricsQuery";
import { listOrganizations, listProjects, type Project } from "@/lib/api/projects";
import { Sparkline } from "@/lib/charts/Sparkline";
import { AnalysisTabs } from "../AnalysisTabs";
import { displayDimension } from "../format";
import { WorldMap } from "./WorldMap";
import { RevenueCurrencyContext, useRevenueCurrency } from "./currencyContext";
import { formatAmount, formatChange, formatCount, formatRate } from "./formatOverview";
import {
  ACTIVE_REFRESH_MS,
  ACTIVE_WINDOW_MINUTES,
  MIN_CONVERSION_SESSIONS,
  ORDERS_METRIC,
  REVENUE_METRIC,
  activeByCountryQuery,
  activeSeriesQuery,
  breakdownQuery,
  levelOpacity,
  funnelEvents,
  metricValue,
  percentChange,
  pointsChange,
  purchaseSessionsSeriesQuery,
  rankRegions,
  ratio,
  regionFigures,
  ordersSeriesQuery,
  revenueSeriesQuery,
  seriesPoints,
  seriesRatio,
  seriesValues,
  sourceRows,
  trafficSeriesQuery,
  valueOf,
  type MapMetric,
  type OverviewScope,
  type RegionFigures,
} from "./overviewData";
import "./overview.css";

export function BehaviorOverviewPage() {
  const { projectId } = useParams({ strict: false }) as { projectId?: string };
  const organizations = useQuery({ queryKey: ["organizations"], queryFn: listOrganizations });
  const organization = organizations.data?.organizations[0];
  const projects = useQuery({
    queryKey: ["projects", organization?.id],
    queryFn: () => listProjects(organization!.id),
    enabled: Boolean(organization),
  });
  if (organizations.isLoading || projects.isLoading) return <OverviewSkeleton />;
  const project =
    projects.data?.projects.find((item) => item.id === projectId) ?? projects.data?.projects[0];
  if (!project)
    return (
      <EmptyState
        icon={ChartNoAxesCombinedIcon}
        title="尚未接入项目"
        description="创建项目并接入 SDK 后，即可分析真实用户行为。"
      />
    );
  return <ProjectOverview key={project.id} project={project} />;
}

function useScope(project: Project): OverviewScope {
  const context = useAnalysisContext();
  const [fallback] = useState(() => {
    const to = new Date();
    to.setUTCSeconds(0, 0);
    return { from: new Date(to.getTime() - 86_400_000), to };
  });
  return context?.projectId === project.id
    ? {
        projectId: project.id,
        from: context.from,
        to: context.to,
        environment: context.environment,
      }
    : { projectId: project.id, ...fallback };
}

function useMetrics(params: MetricsQueryParams, options: { refetchInterval?: number } = {}) {
  return useQuery({
    queryKey: ["behavior-overview", params.projectId, metricsQueryString(params)],
    queryFn: ({ signal }) => queryMetrics(params, signal),
    ...options,
  });
}

/** The live map polls a moving window, so its key leaves the time out and the window is
 *  recomputed on every fetch. */
function useActiveMetrics(
  scope: OverviewScope,
  kind: "series" | "country",
  build: (scope: OverviewScope, now: Date) => MetricsQueryParams,
) {
  return useQuery({
    queryKey: ["behavior-overview-active", scope.projectId, scope.environment ?? "", kind],
    queryFn: ({ signal }) => queryMetrics(build(scope, new Date()), signal),
    refetchInterval: ACTIVE_REFRESH_MS,
  });
}

function ProjectOverview({ project }: { project: Project }) {
  const scope = useScope(project);
  const revenue = useMetrics(revenueSeriesQuery(scope));
  const orders = useMetrics(ordersSeriesQuery(scope));
  const traffic = useMetrics(trafficSeriesQuery(scope));
  const purchases = useMetrics(purchaseSessionsSeriesQuery(scope));
  // No stored amount at all: the samples behind the revenue total, not its value, which
  // may be zero for real orders.
  const noRevenue =
    revenue.isSuccess && (revenue.data.totals?.[REVENUE_METRIC]?.samples ?? 0) === 0;
  return (
    <RevenueCurrencyContext.Provider value={project.revenueCurrency ?? ""}>
      <ConsolePage width="fluid">
        <ConsolePageHeader
          title="用户行为分析"
          description="按地区、来源和购买漏斗查看访问规模、转化与收入。"
        />
        <ConsolePageTabs>
          <AnalysisTabs projectId={project.id} active="overview" />
        </ConsolePageTabs>
        <div className="grid gap-5">
          <ActivityCard scope={scope} />
          {noRevenue ? (
            <Alert variant="warning" role="status">
              <TriangleAlertIcon aria-hidden="true" />
              <AlertDescription>
                当前范围内没有包含 amount 的 purchase 事件，无法计算收入。上报
                view_item、add_to_cart、 begin_checkout 和 purchase 事件（amount
                为订单金额）后，将显示收入数据。
              </AlertDescription>
            </Alert>
          ) : null}
          <RevenueKpis revenue={revenue} orders={orders} traffic={traffic} purchases={purchases} />
          <div className="flex flex-wrap items-stretch gap-5">
            <PurchaseFunnel scope={scope} />
            <SourceRevenue
              scope={scope}
              totalRevenue={valueOf(revenue.data?.totals?.[REVENUE_METRIC])}
            />
          </div>
        </div>
      </ConsolePage>
    </RevenueCurrencyContext.Provider>
  );
}

// ---------------------------------------------------------------------------------------
// Map card

const mapMetrics: { id: MapMetric; label: string; short: string }[] = [
  { id: "active", label: "活跃用户", short: "活跃" },
  { id: "sessions", label: "会话", short: "会话" },
  { id: "revenue", label: "收入", short: "收入" },
  { id: "conversion", label: "购买转化率", short: "转化率" },
];

function ActivityCard({ scope }: { scope: OverviewScope }) {
  const currency = useRevenueCurrency();
  const [metric, setMetric] = useState<MapMetric>("active");
  const [selected, setSelected] = useState<string | null>(null);
  const activeSeries = useActiveMetrics(scope, "series", activeSeriesQuery);
  const activeCountries = useActiveMetrics(scope, "country", activeByCountryQuery);
  const sessions = useMetrics(breakdownQuery(scope, "country", "sessions"));
  const revenue = useMetrics(breakdownQuery(scope, "country", "revenue"));
  const purchaseSessions = useMetrics(breakdownQuery(scope, "country", "purchaseSessions"));
  const regions = useMemo(
    () =>
      regionFigures({
        active: activeCountries.data,
        sessions: sessions.data,
        revenue: revenue.data,
        purchaseSessions: purchaseSessions.data,
      }),
    [activeCountries.data, sessions.data, revenue.data, purchaseSessions.data],
  );
  const ranked = rankRegions(regions, metric);
  const values = new Map(ranked.map((region) => [region.code, metricValue(region, metric) ?? 0]));
  const top = metricValue(ranked[0] ?? emptyRegion, metric) ?? 0;
  const markers = rankRegions(regions, "active")
    .slice(0, 6)
    .map((region, _index, list) => ({
      code: region.code,
      weight: (region.active ?? 0) / (list[0]?.active || 1),
    }));
  const activeTotal = valueOf(activeSeries.data?.totals?.["behavior.users"]);
  const minutes = seriesValues(activeSeries.data, "behavior.users");
  const describe = (code: string) => (
    <RegionCallout code={code} region={regions.find((region) => region.code === code)} />
  );
  const selectFromMap = (code: string) =>
    setSelected((current) => (current === code ? null : code));
  const metricInfo = mapMetrics.find((item) => item.id === metric)!;
  const loading =
    metric === "active"
      ? activeCountries.isPending
      : (metric === "revenue" ? revenue : sessions).isPending;
  const mapLabel = ranked.length
    ? `按${metricInfo.label}着色的世界地图。最高：${ranked
        .slice(0, 3)
        .map(
          (region) =>
            `${regionName(region.code)} ${formatMetric(metric, metricValue(region, metric), currency)}`,
        )
        .join("，")}`
    : `按${metricInfo.label}着色的世界地图，当前没有数据`;
  return (
    <section
      className="card card-border overflow-hidden bg-base-100"
      aria-labelledby="overview-active-title"
    >
      <div className="flex flex-wrap">
        <div className="flex min-w-0 flex-[999_1_640px] flex-col gap-4 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex flex-col gap-2">
              <h2
                id="overview-active-title"
                className="flex items-center gap-2.5 text-sm font-semibold"
              >
                <span className="overview-live-dot" aria-hidden="true" />
                过去 {ACTIVE_WINDOW_MINUTES} 分钟活跃用户
              </h2>
              <div className="flex flex-wrap items-end gap-5">
                <span className="text-5xl leading-none font-bold tracking-tight tabular-nums">
                  {activeTotal === null ? "—" : formatCount(activeTotal)}
                </span>
                <MinuteBars values={minutes} />
              </div>
              <span className="text-xs text-base-content/70">
                {ranked.length && metric === "active"
                  ? `来自 ${ranked.length} 个国家和地区 · `
                  : ""}
                每 10 秒更新 · 柱状图为每分钟活跃用户，最右侧为进行中的当前分钟
              </span>
            </div>
            <ToggleGroup
              type="single"
              variant="segmented"
              value={metric}
              aria-label="地图指标"
              onValueChange={(value) => {
                if (value) setMetric(value as MapMetric);
              }}
            >
              {mapMetrics.map((item) => (
                <ToggleGroupItem key={item.id} value={item.id}>
                  {item.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          {/* The map sits on its own inset surface so its faint land dots read in every theme. */}
          <div className="rounded-box bg-base-200/70 p-3 sm:p-4">
            <WorldMap
              values={values}
              selected={selected}
              markers={markers}
              label={mapLabel}
              onSelect={selectFromMap}
              describe={describe}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs text-base-content/70">
            <span>
              位置精确到国家和地区 · 悬停可查看详细数据 · 光圈标示活跃用户最多的 6 个地区
              {metric === "conversion" ? ` · 会话少于 ${MIN_CONVERSION_SESSIONS} 的地区不着色` : ""}
            </span>
            <MapLegend label={metricInfo.short} />
          </div>
        </div>
        <aside
          aria-labelledby="overview-ranking-title"
          className="flex min-w-0 flex-[1_1_300px] flex-col gap-3 border-t border-base-300 p-6 lg:border-t-0 lg:border-l"
        >
          <div className="flex flex-col gap-0.5">
            <h2 id="overview-ranking-title" className="text-sm font-semibold">
              地区排行
            </h2>
            <span className="text-xs text-base-content/70">
              {metricInfo.label} ·{" "}
              {metric === "active" ? `过去 ${ACTIVE_WINDOW_MINUTES} 分钟` : "所选时间范围"} ·
              点击可在地图上定位
            </span>
          </div>
          {loading ? (
            <span className="text-sm text-base-content/70">正在加载…</span>
          ) : ranked.length ? (
            <ol className="flex flex-col gap-0.5">
              {ranked.slice(0, 8).map((region, index) => {
                const value = metricValue(region, metric) ?? 0;
                const pressed = region.code === selected;
                return (
                  <li key={region.code}>
                    <button
                      type="button"
                      aria-pressed={pressed}
                      onClick={() => setSelected(pressed ? null : region.code)}
                      className={`grid min-h-11 w-full grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1 rounded-field px-2.5 py-1.5 text-left hover:bg-base-200 ${
                        pressed ? "bg-base-200 ring-1 ring-base-300" : ""
                      }`}
                    >
                      <span className="font-mono text-[11px] text-base-content/70">
                        {index + 1}
                      </span>
                      <span className="truncate text-[13px] font-medium">
                        {regionName(region.code)}
                      </span>
                      <span className="text-[13px] font-semibold tabular-nums">
                        {formatMetric(metric, value, currency)}
                      </span>
                      <span aria-hidden="true" />
                      <span
                        aria-hidden="true"
                        className="col-span-2 h-1 overflow-hidden rounded-full bg-base-200"
                      >
                        <span
                          className="block h-full rounded-full bg-primary"
                          style={{ width: `${top ? (value / top) * 100 : 0}%` }}
                        />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          ) : (
            <span className="text-sm text-base-content/70">当前没有{metricInfo.label}数据。</span>
          )}
          {ranked.length > 8 ? (
            <span className="mt-auto text-xs text-base-content/70">
              另有 {ranked.length - 8} 个地区
            </span>
          ) : null}
        </aside>
      </div>
    </section>
  );
}

const emptyRegion: RegionFigures = {
  code: "",
  active: null,
  sessions: null,
  revenue: null,
  conversion: null,
};

function RegionCallout({ code, region }: { code: string; region?: RegionFigures }) {
  const currency = useRevenueCurrency();
  return (
    <>
      <strong className="block text-[13px]">{regionName(code)}</strong>
      {region ? (
        <span className="grid grid-cols-[auto_auto] gap-x-3 tabular-nums">
          <span className="text-base-content/70">活跃用户</span>
          <span className="text-right">{formatMetric("active", region.active)}</span>
          <span className="text-base-content/70">会话</span>
          <span className="text-right">{formatMetric("sessions", region.sessions)}</span>
          <span className="text-base-content/70">收入</span>
          <span className="text-right">{formatMetric("revenue", region.revenue, currency)}</span>
          <span className="text-base-content/70">购买转化率</span>
          <span className="text-right">{formatMetric("conversion", region.conversion)}</span>
        </span>
      ) : (
        <span className="text-base-content/70">当前范围没有数据</span>
      )}
    </>
  );
}

function MinuteBars({ values }: { values: Array<number | null> }) {
  const max = Math.max(0, ...values.map((value) => value ?? 0));
  const width = 6.2;
  return (
    <svg
      width={186}
      height={44}
      viewBox={`0 0 ${ACTIVE_WINDOW_MINUTES * width} 44`}
      aria-hidden="true"
      className="block"
    >
      {values.map((value, index) => {
        if (value === null || !max) return null;
        const height = Math.max(2, (value / max) * 44);
        return (
          <rect
            key={index}
            x={index * width}
            y={44 - height}
            width={4}
            height={height}
            rx={1}
            fill="var(--color-primary)"
            fillOpacity={index === values.length - 1 ? 0.4 : 0.85}
          />
        );
      })}
    </svg>
  );
}

function MapLegend({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {label} 少
      <svg width={92} height={10} viewBox="0 0 92 10" aria-hidden="true">
        {levelOpacity.slice(1).map((opacity, index) => (
          <rect
            key={opacity}
            x={index * 18.5}
            width={17}
            height={10}
            rx={2}
            fill="var(--color-primary)"
            fillOpacity={opacity}
          />
        ))}
      </svg>
      多
    </span>
  );
}

// ---------------------------------------------------------------------------------------
// Revenue numbers

type MetricsQuery = ReturnType<typeof useMetrics>;

function RevenueKpis({
  revenue,
  orders: ordersQuery,
  traffic,
  purchases,
}: {
  revenue: MetricsQuery;
  orders: MetricsQuery;
  traffic: MetricsQuery;
  purchases: MetricsQuery;
}) {
  const currency = useRevenueCurrency();
  const error = revenue.error ?? ordersQuery.error ?? traffic.error ?? purchases.error;
  if (error)
    return (
      <AsyncError
        error={error}
        title="收入指标加载失败"
        remediation="时间范围已保留；缩短范围后重试。"
        onRetry={() => {
          void revenue.refetch();
          void ordersQuery.refetch();
          void traffic.refetch();
          void purchases.refetch();
        }}
      />
    );
  if (!revenue.data || !ordersQuery.data || !traffic.data || !purchases.data)
    return <Skeleton className="h-36 w-full rounded-box" />;
  const current = (result: typeof revenue.data, metric: string) => valueOf(result.totals?.[metric]);
  const previous = (result: typeof revenue.data, metric: string) =>
    valueOf(result.comparison?.totals?.[metric]);
  const sum = current(revenue.data, REVENUE_METRIC);
  const orders = current(ordersQuery.data, ORDERS_METRIC);
  const sessions = current(traffic.data, "traffic.sessions");
  const users = current(traffic.data, "traffic.uniqueUsers");
  const buyers = current(purchases.data, "behavior.sessions");
  const prevSum = previous(revenue.data, REVENUE_METRIC);
  const prevOrders = previous(ordersQuery.data, ORDERS_METRIC);
  const prevSessions = previous(traffic.data, "traffic.sessions");
  const prevUsers = previous(traffic.data, "traffic.uniqueUsers");
  const prevBuyers = previous(purchases.data, "behavior.sessions");
  const conversion = ratio(buyers, sessions);
  const prevConversion = ratio(prevBuyers, prevSessions);
  const items = [
    {
      label: "收入",
      value: formatAmount(sum, currency),
      previous: formatAmount(prevSum, currency),
      change: percentChange(sum, prevSum),
      hint: "purchase 事件的 amount 合计",
      trend: seriesValues(revenue.data, REVENUE_METRIC),
    },
    {
      label: "订单",
      value: formatCount(orders),
      previous: formatCount(prevOrders),
      change: percentChange(orders, prevOrders),
      hint: "purchase 事件数",
      trend: seriesValues(ordersQuery.data, ORDERS_METRIC),
    },
    {
      label: "客单价",
      value: formatAmount(ratio(sum, orders), currency),
      previous: formatAmount(ratio(prevSum, prevOrders), currency),
      change: percentChange(ratio(sum, orders), ratio(prevSum, prevOrders)),
      hint: "收入 / 订单",
      trend: seriesRatio(
        seriesPoints(revenue.data, REVENUE_METRIC),
        seriesPoints(ordersQuery.data, ORDERS_METRIC),
      ),
    },
    {
      label: "购买转化率",
      value: formatRate(conversion, 2),
      previous: formatRate(prevConversion, 2),
      change: pointsChange(conversion, prevConversion),
      hint: "有购买的会话 / 全部会话",
      trend: seriesRatio(
        seriesPoints(purchases.data, "behavior.sessions"),
        seriesPoints(traffic.data, "traffic.sessions"),
      ),
    },
    {
      label: "每访客收入",
      value: formatAmount(ratio(sum, users), currency),
      previous: formatAmount(ratio(prevSum, prevUsers), currency),
      change: percentChange(ratio(sum, users), ratio(prevSum, prevUsers)),
      hint: "收入 / 访客数",
      trend: seriesRatio(
        seriesPoints(revenue.data, REVENUE_METRIC),
        seriesPoints(traffic.data, "traffic.uniqueUsers"),
      ),
    },
  ];
  return (
    <section aria-label="收入概览" className="card card-border overflow-hidden bg-base-100">
      {/* One hairline grid: the gap shows the base-300 behind the cells as dividers. */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-px bg-base-300">
        {items.map((item) => (
          <div key={item.label} className="flex flex-col gap-1 bg-base-100 px-5 pt-4 pb-3">
            <span className="text-xs font-medium text-base-content/70">{item.label}</span>
            <span className="text-2xl leading-tight font-bold tabular-nums">{item.value}</span>
            <span className="text-xs text-base-content/70 tabular-nums">
              上一周期 {item.previous} · {formatChange(item.change)}
            </span>
            <Sparkline
              values={item.trend}
              color="var(--color-primary)"
              className="mt-1.5 h-8 w-full"
            />
            <span className="text-[11px] text-base-content/70">{item.hint}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------
// Funnel and sources

const funnelLabels: Record<(typeof funnelEvents)[number], string> = {
  view_item: "浏览商品",
  add_to_cart: "加入购物车",
  begin_checkout: "开始结算",
  purchase: "支付成功",
};

function PurchaseFunnel({ scope }: { scope: OverviewScope }) {
  const definition = {
    ...scope,
    dimension: "device" as const,
    windowSeconds: 3600 as const,
    steps: funnelEvents.map((name) => ({ kind: "custom", name })),
  };
  const funnel = useQuery({
    queryKey: [
      "behavior-overview-funnel",
      scope.projectId,
      scope.from.toISOString(),
      scope.to.toISOString(),
      scope.environment ?? "",
    ],
    queryFn: ({ signal }) => queryFunnel(definition, signal),
  });
  const steps = funnel.data?.steps ?? [];
  const entry = steps[0]?.sessions ?? 0;
  const last = steps.at(-1);
  return (
    <section
      className="card card-border min-w-0 flex-[1_1_26rem] bg-base-100"
      aria-labelledby="overview-funnel-title"
    >
      <div className="card-body gap-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-col gap-0.5">
            <h2 id="overview-funnel-title" className="card-title text-base">
              购买漏斗
            </h2>
            <span className="text-xs text-base-content/70">
              按会话 · 1 小时内依次完成 · 所选时间范围
            </span>
          </div>
          <Link
            className="link link-primary text-sm"
            to="/projects/$projectId/analytics/funnels"
            params={{ projectId: scope.projectId }}
            search={(current) => current}
          >
            在漏斗中打开
          </Link>
        </div>
        {funnel.error ? (
          <AsyncError
            error={funnel.error}
            title="漏斗加载失败"
            remediation="缩短时间范围后重试。"
            onRetry={() => void funnel.refetch()}
          />
        ) : funnel.isPending ? (
          <Skeleton className="h-48 w-full" />
        ) : entry ? (
          <>
            <ol className="flex flex-col gap-2.5">
              {steps.map((step, index) => (
                <li
                  key={step.name}
                  className="grid grid-cols-[6rem_minmax(0,1fr)_7rem] items-center gap-3"
                >
                  <span className="flex flex-col">
                    <span className="text-[13px] font-medium">
                      {funnelLabels[step.name as keyof typeof funnelLabels] ?? step.name}
                    </span>
                    <code className="text-[11px] text-base-content/70">{step.name}</code>
                  </span>
                  <span className="block h-7 overflow-hidden rounded-field bg-base-200">
                    <span
                      className="block h-full bg-primary"
                      style={{
                        width: `${Math.max(1.5, (step.sessions / entry) * 100)}%`,
                        opacity: 1 - index * 0.14,
                      }}
                    />
                  </span>
                  <span className="flex flex-col items-end">
                    <span className="text-sm font-semibold tabular-nums">
                      {formatCount(step.sessions)}
                    </span>
                    <span className="text-[11px] text-base-content/70 tabular-nums">
                      {index === 0
                        ? "入口"
                        : `上一步 ${formatRate(step.conversionFromPrevious, 1)}`}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
            <span className="text-xs text-base-content/70">
              整体转化 {formatRate(last?.conversionFromFirst ?? null, 2)} · 支付成功会话 /
              浏览商品会话
            </span>
          </>
        ) : (
          <p className="text-sm text-base-content/70">
            当前范围内没有 view_item 事件。上报 view_item、add_to_cart、begin_checkout 和 purchase
            事件后，将显示购买漏斗。
          </p>
        )}
      </div>
    </section>
  );
}

function SourceRevenue({
  scope,
  totalRevenue,
}: {
  scope: OverviewScope;
  totalRevenue: number | null;
}) {
  const currency = useRevenueCurrency();
  const sessions = useMetrics(breakdownQuery(scope, "source", "sessions"));
  const revenue = useMetrics(breakdownQuery(scope, "source", "revenue"));
  const purchases = useMetrics(breakdownQuery(scope, "source", "purchaseSessions"));
  const error = sessions.error ?? revenue.error ?? purchases.error;
  const rows = sourceRows(
    { sessions: sessions.data, revenue: revenue.data, purchaseSessions: purchases.data },
    totalRevenue,
  );
  return (
    <section
      className="card card-border min-w-0 flex-[1.4_1_32rem] bg-base-100"
      aria-labelledby="overview-source-title"
    >
      <div className="card-body gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 id="overview-source-title" className="card-title text-base">
            来源与收入
          </h2>
          <span className="text-xs text-base-content/70">
            按来访域名 · 所选时间范围 · 按收入从高到低
          </span>
        </div>
        {error ? (
          <AsyncError
            error={error}
            title="来源加载失败"
            remediation="缩短时间范围后重试。"
            onRetry={() => {
              void sessions.refetch();
              void revenue.refetch();
              void purchases.refetch();
            }}
          />
        ) : sessions.isPending || revenue.isPending || purchases.isPending ? (
          <Skeleton className="h-48 w-full" />
        ) : rows.length ? (
          <div className="overflow-x-auto">
            <Table className="min-w-[36rem]">
              <TableHeader>
                <TableRow>
                  <TableHead>来源</TableHead>
                  <TableHead className="text-right">会话</TableHead>
                  <TableHead className="text-right">购买转化率</TableHead>
                  <TableHead className="text-right">收入</TableHead>
                  <TableHead className="text-right">每会话收入</TableHead>
                  <TableHead className="w-32">收入占比</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.value}>
                    <TableCell>
                      <span className="flex flex-col">
                        <span className="font-medium">{displayDimension(row.value, "source")}</span>
                        {row.value !== "direct" && row.value !== "unknown" ? (
                          <code className="text-[11px] text-base-content/70">{row.value}</code>
                        ) : null}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCount(row.sessions)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatRate(row.conversion, 1)}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {formatAmount(row.revenue, currency)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatAmount(row.revenuePerSession, currency)}
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-2">
                        <span className="block h-1.5 flex-1 overflow-hidden rounded-full bg-base-200">
                          <span
                            className="block h-full rounded-full bg-primary"
                            style={{ width: `${(row.share ?? 0) * 100}%` }}
                          />
                        </span>
                        <span className="w-12 text-right text-xs tabular-nums">
                          {formatRate(row.share, 1)}
                        </span>
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-sm text-base-content/70">当前范围没有来源数据。</p>
        )}
        <span className="text-xs text-base-content/70">
          会话少于 {MIN_CONVERSION_SESSIONS} 的来源不计算转化率。
        </span>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------

function regionName(code: string) {
  return countryLabel(code).replace(/ \([A-Z]{2}\)$/, "");
}

function formatMetric(metric: MapMetric, value: number | null, currency = "") {
  if (metric === "revenue") return formatAmount(value, currency);
  if (metric === "conversion") return formatRate(value, 1);
  return formatCount(value);
}

function OverviewSkeleton() {
  return (
    <ConsolePage width="fluid">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-[32rem] w-full rounded-box" />
      <Skeleton className="h-36 w-full rounded-box" />
    </ConsolePage>
  );
}
