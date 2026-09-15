import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { ChartNoAxesCombinedIcon, RefreshCwIcon } from "lucide-react";
import {
  ConsoleFilterBar,
  ConsolePage,
  ConsolePageHeader,
  ConsolePageTabs,
} from "@/components/layout/ConsolePage";
import { AsyncError } from "@/components/ui/AsyncState";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getBehaviorAnalytics } from "@/lib/api/analytics";
import { listOrganizations, listProjects, type Project } from "@/lib/api/projects";
import { BehaviorControls } from "./BehaviorControls";
import { BehaviorTrendChart } from "./BehaviorTrendChart";
import { AnalysisTabs } from "./AnalysisTabs";
import { eventLabel } from "./labels";
import { useBehaviorFilters } from "./useBehaviorFilters";

export function AnalysisPage() {
  const { projectId } = useParams({ strict: false }) as { projectId?: string };
  const organizations = useQuery({ queryKey: ["organizations"], queryFn: listOrganizations });
  const organization = organizations.data?.organizations[0];
  const projects = useQuery({
    queryKey: ["projects", organization?.id],
    queryFn: () => listProjects(organization!.id),
    enabled: Boolean(organization),
  });
  if (organizations.isLoading || projects.isLoading) return <AnalysisSkeleton />;
  const project =
    projects.data?.projects.find((item) => item.id === projectId) ?? projects.data?.projects[0];
  if (!project) {
    return (
      <EmptyState
        icon={ChartNoAxesCombinedIcon}
        title="尚未接入项目"
        description="创建项目并接入 SDK 后，即可分析真实用户行为。"
      />
    );
  }
  return <ProjectAnalysis project={project} />;
}

function ProjectAnalysis({ project }: { project: Project }) {
  const { filters, update } = useBehaviorFilters(project.id);
  const query = useQuery({
    queryKey: ["behavior-analysis", filters],
    queryFn: ({ signal }) => getBehaviorAnalytics(filters, signal),
  });
  const data = query.data;
  return (
    <ConsolePage width="fluid">
      <ConsolePageHeader
        title="用户行为分析"
        description="从访问、用户和会话趋势理解产品使用情况，再按受控维度定位差异。"
        actions={
          <Button
            size="icon"
            variant="outline"
            aria-label="刷新行为分析"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
          >
            <RefreshCwIcon />
          </Button>
        }
      />
      <ConsolePageTabs>
        <AnalysisTabs projectId={project.id} active="overview" />
      </ConsolePageTabs>
      <ConsoleFilterBar
        primary={<BehaviorControls filters={filters} data={data} onChange={update} />}
      />
      {query.isLoading ? <AnalysisSkeleton compact /> : null}
      {query.error ? (
        <AsyncError
          error={query.error}
          title="行为分析加载失败"
          remediation="筛选已保留；请缩短时间范围、改用内置维度或增加事件筛选。"
          onRetry={() => void query.refetch()}
        />
      ) : null}
      {data && data.totals.events > 0 ? (
        <>
          <div className="behavior-freshness" data-stale={data.freshness.stale || undefined}>
            {data.freshness.latestReceivedAt
              ? `数据更新于 ${formatRelative(data.freshness.ageSeconds)}`
              : "暂无新鲜度信息"}
            <span>统计为近似去重，采样估算已单独标记</span>
          </div>
          <section className="behavior-kpis" aria-label="行为核心指标">
            <Metric
              label="事件"
              value={formatCompact(data.totals.events)}
              note={`${data.sampleCount.toLocaleString()} 个采集样本`}
            />
            <Metric
              label="估算事件"
              value={formatCompact(data.totals.estimated)}
              note="按事件采样率还原"
            />
            <Metric
              label="用户"
              value={formatCompact(data.totals.uniqueUsers)}
              note="匿名用户近似去重"
            />
            <Metric
              label="会话"
              value={formatCompact(data.totals.uniqueSessions)}
              note="会话 ID 近似去重"
            />
          </section>
          <section
            className="behavior-panel behavior-panel--chart"
            aria-labelledby="behavior-trend-title"
          >
            <div className="behavior-panel__header">
              <div>
                <h2 id="behavior-trend-title">事件趋势</h2>
                <p>事件量与唯一用户随时间的变化。</p>
              </div>
              <span>{intervalLabel(data.interval)}</span>
            </div>
            <BehaviorTrendChart data={data.trend} />
          </section>
          <div className="behavior-grid">
            <BreakdownTable data={data} />
            <EventTable
              data={data}
              onSelect={(kind, name) => update({ eventKind: kind, eventName: name })}
            />
          </div>
          {data.measurements.length > 0 ? (
            <MeasurementTable
              data={data}
              selected={filters.measurement}
              onSelect={(name) => update({ measurement: name })}
            />
          ) : null}
        </>
      ) : null}
      {data && data.totals.events === 0 ? (
        <div className="behavior-panel">
          <EmptyState
            icon={ChartNoAxesCombinedIcon}
            title="当前范围没有行为数据"
            description="确认已启用页面与点击采集，或清除事件筛选后重试。"
          />
        </div>
      ) : null}
    </ConsolePage>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <article>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

function BreakdownTable({ data }: { data: Awaited<ReturnType<typeof getBehaviorAnalytics>> }) {
  return (
    <section className="behavior-panel" aria-labelledby="breakdown-title">
      <div className="behavior-panel__header">
        <div>
          <h2 id="breakdown-title">{dimensionLabel(data.dimension)}分布</h2>
          <p>按事件量排序的前 {data.rowLimit} 个值。</p>
        </div>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{dimensionLabel(data.dimension)}</TableHead>
            <TableHead>事件</TableHead>
            <TableHead>用户</TableHead>
            <TableHead>占比</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.breakdown.slice(0, 12).map((item) => (
            <TableRow key={item.value}>
              <TableCell>
                <strong>{displayDimension(item.value, data.dimension)}</strong>
              </TableCell>
              <TableCell>{item.metric.events.toLocaleString()}</TableCell>
              <TableCell>{item.metric.uniqueUsers.toLocaleString()}</TableCell>
              <TableCell>{formatPercent(item.metric.events, data.totals.events)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}

function EventTable({
  data,
  onSelect,
}: {
  data: Awaited<ReturnType<typeof getBehaviorAnalytics>>;
  onSelect: (kind: "page_view" | "navigation" | "click" | "custom", name: string) => void;
}) {
  return (
    <section className="behavior-panel" aria-labelledby="top-events-title">
      <div className="behavior-panel__header">
        <div>
          <h2 id="top-events-title">热门事件</h2>
          <p>点击事件可继续查看对应趋势。</p>
        </div>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>事件</TableHead>
            <TableHead>类型</TableHead>
            <TableHead>次数</TableHead>
            <TableHead>用户</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.catalog.slice(0, 12).map((event) => (
            <TableRow
              key={`${event.kind}:${event.name}`}
              tabIndex={0}
              className="cursor-pointer"
              onClick={() => onSelect(event.kind as Parameters<typeof onSelect>[0], event.name)}
              onKeyDown={(key) => {
                if (key.key === "Enter")
                  onSelect(event.kind as Parameters<typeof onSelect>[0], event.name);
              }}
            >
              <TableCell>
                <strong>{eventLabel(event.kind, event.name)}</strong>
              </TableCell>
              <TableCell>{kindLabel(event.kind)}</TableCell>
              <TableCell>{event.metric.events.toLocaleString()}</TableCell>
              <TableCell>{event.metric.uniqueUsers.toLocaleString()}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}

// Numeric Custom Event measurements. Hidden entirely when a Project sends none, which is
// most of them: an empty table here would read as a broken panel rather than an unused
// capability.
function MeasurementTable({
  data,
  selected,
  onSelect,
}: {
  data: Awaited<ReturnType<typeof getBehaviorAnalytics>>;
  selected?: string;
  onSelect: (name: string | undefined) => void;
}) {
  const breakdown = data.measurementBreakdown ?? [];
  return (
    <section className="behavior-panel" aria-labelledby="measurements-title">
      <div className="behavior-panel__header">
        <div>
          <h2 id="measurements-title">数值指标</h2>
          <p>自定义事件 measurements 的汇总。点击一行按{dimensionLabel(data.dimension)}拆分。</p>
        </div>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>指标</TableHead>
            <TableHead>样本</TableHead>
            <TableHead>总和</TableHead>
            <TableHead>估算总和</TableHead>
            <TableHead>平均</TableHead>
            <TableHead>中位数</TableHead>
            <TableHead>P90</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.measurements.map((item) => (
            <TableRow
              key={item.name}
              tabIndex={0}
              className="cursor-pointer"
              aria-selected={item.name === selected}
              onClick={() => onSelect(item.name === selected ? undefined : item.name)}
              onKeyDown={(key) => {
                if (key.key === "Enter") onSelect(item.name === selected ? undefined : item.name);
              }}
            >
              <TableCell>
                <strong>{item.name}</strong>
              </TableCell>
              <TableCell>{item.samples.toLocaleString()}</TableCell>
              <TableCell>{formatCompact(item.total)}</TableCell>
              <TableCell>{formatCompact(item.estimated)}</TableCell>
              <TableCell>{formatCompact(item.average)}</TableCell>
              <TableCell>{formatCompact(item.p50)}</TableCell>
              <TableCell>{formatCompact(item.p90)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {selected && breakdown.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                {selected} · {dimensionLabel(data.dimension)}
              </TableHead>
              <TableHead>样本</TableHead>
              <TableHead>总和</TableHead>
              <TableHead>平均</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {breakdown.slice(0, 12).map((row) => (
              <TableRow key={row.value}>
                <TableCell>
                  <strong>{displayDimension(row.value, data.dimension)}</strong>
                </TableCell>
                <TableCell>{row.samples.toLocaleString()}</TableCell>
                <TableCell>{formatCompact(row.total)}</TableCell>
                <TableCell>{formatCompact(row.average)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </section>
  );
}

function AnalysisSkeleton({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={compact ? "grid gap-4" : "px-4 py-6 sm:px-6 lg:px-8 lg:py-8"}
      aria-label="正在加载行为分析"
    >
      <Skeleton className="h-24" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
      <Skeleton className="h-80" />
    </div>
  );
}

function formatCompact(value: number) {
  return new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 2 }).format(
    value,
  );
}
function formatPercent(value: number, total: number) {
  return total ? `${((value / total) * 100).toFixed(1)}%` : "—";
}
function formatRelative(seconds: number | null) {
  if (seconds === null) return "未知";
  if (seconds < 60) return `${Math.round(seconds)} 秒前`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} 分钟前`;
  return `${Math.round(seconds / 3600)} 小时前`;
}
function intervalLabel(value: string) {
  return `聚合间隔 ${value.replace(" MINUTE", " 分钟").replace(" HOUR", " 小时")}`;
}
function dimensionLabel(value: string) {
  if (value === "country") return "国家";
  if (value === "device") return "设备";
  if (value === "browser") return "浏览器";
  if (value === "source") return "来源";
  return `属性 ${value.slice(9)}`;
}
function displayDimension(value: string, dimension: string) {
  if (dimension === "country")
    return (
      ({ CN: "中国", US: "美国", JP: "日本", SG: "新加坡", DE: "德国" } as Record<string, string>)[
        value
      ] ?? value
    );
  return value === "unknown" ? "未知" : value === "direct" ? "直接访问" : value;
}
function kindLabel(value: string) {
  return (
    (
      { page_view: "访问", navigation: "导航", click: "点击", custom: "自定义" } as Record<
        string,
        string
      >
    )[value] ?? value
  );
}
