import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import {
  ActivityIcon,
  ArrowUpRightIcon,
  BugIcon,
  GaugeIcon,
  LightbulbIcon,
  ServerIcon,
} from "lucide-react";
import { useMemo } from "react";
import { AsyncError } from "@/components/ui/AsyncState";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { getBehaviorAnalytics } from "@/lib/api/analytics";
import { getAPIs } from "@/lib/api/apis";
import { getOverview } from "@/lib/api/client";
import { getPerformance } from "@/lib/api/performance";
import { listOrganizations, listProjects, type Project } from "@/lib/api/projects";

type Insight = {
  id: string;
  eyebrow: string;
  title: string;
  evidence: string;
  explanation: string;
  href: string;
  linkLabel: string;
  icon: typeof ActivityIcon;
  tone: "neutral" | "warning" | "critical";
};

export function InsightsPage() {
  const { projectId } = useParams({ strict: false }) as { projectId?: string };
  const organizations = useQuery({ queryKey: ["organizations"], queryFn: listOrganizations });
  const organization = organizations.data?.organizations[0];
  const projects = useQuery({
    queryKey: ["projects", organization?.id],
    queryFn: () => listProjects(organization!.id),
    enabled: Boolean(organization),
  });
  if (organizations.isLoading || projects.isLoading) return <InsightsSkeleton />;
  const project =
    projects.data?.projects.find((item) => item.id === projectId) ?? projects.data?.projects[0];
  if (!project) {
    return (
      <EmptyState
        icon={LightbulbIcon}
        title="尚未接入项目"
        description="接入行为、错误、性能与 API 数据后即可生成可验证洞察。"
      />
    );
  }
  return <ProjectInsights project={project} />;
}

function ProjectInsights({ project }: { project: Project }) {
  const to = useMemo(() => roundedMinute(new Date()), []);
  const from = useMemo(() => new Date(to.getTime() - 24 * 60 * 60 * 1000), [to]);
  const overview = useQuery({
    queryKey: ["insights-overview", project.id, from, to],
    queryFn: ({ signal }) => getOverview({ projectId: project.id, from, to }, signal),
  });
  const behavior = useQuery({
    queryKey: ["insights-behavior", project.id, from, to],
    queryFn: ({ signal }) =>
      getBehaviorAnalytics({ projectId: project.id, from, to, dimension: "country" }, signal),
  });
  const performance = useQuery({
    queryKey: ["insights-performance", project.id, from, to],
    queryFn: ({ signal }) =>
      getPerformance({ projectId: project.id, from, to, metric: "LCP" }, signal),
  });
  const apis = useQuery({
    queryKey: ["insights-apis", project.id, from, to],
    queryFn: ({ signal }) =>
      getAPIs({ projectId: project.id, from, to, methods: [], sort: "failures" }, signal),
  });
  const all = [overview, behavior, performance, apis];
  const loading = all.some((item) => item.isLoading);
  const insights = buildInsights({
    projectId: project.id,
    from,
    to,
    overview: overview.data,
    behavior: behavior.data,
    performance: performance.data,
    apis: apis.data,
  });
  return (
    <div className="behavior-page insights-page">
      <header className="behavior-header">
        <div>
          <div className="breadcrumb">
            项目 <span>/</span> {project.name} <span>/</span> 洞察
          </div>
          <h1>洞察</h1>
          <p>用明确指标说明为什么值得关注，并保留时间与分群上下文直达原始证据。</p>
        </div>
      </header>
      <div className="insights-summary">
        <div>
          <span>分析范围</span>
          <strong>过去 24 小时</strong>
        </div>
        <div>
          <span>生成方式</span>
          <strong>确定性规则</strong>
        </div>
        <p>这里没有黑盒评分；每条结论都展示样本、阈值或周期变化。</p>
      </div>
      {loading ? <InsightsSkeleton compact /> : null}
      {!loading && all.every((item) => item.error) ? (
        <AsyncError
          error={overview.error}
          title="洞察暂不可用"
          remediation="基础数据仍可从分析、错误、性能与 API 页面分别查看。"
          onRetry={() => all.forEach((item) => void item.refetch())}
        />
      ) : null}
      {insights.length ? (
        <section className="insight-grid" aria-label="有证据的产品洞察">
          {insights.map((insight) => {
            const Icon = insight.icon;
            return (
              <article className="insight-card" data-tone={insight.tone} key={insight.id}>
                <div className="insight-card__icon">
                  <Icon />
                </div>
                <div className="insight-card__body">
                  <span>{insight.eyebrow}</span>
                  <h2>{insight.title}</h2>
                  <strong>{insight.evidence}</strong>
                  <p>{insight.explanation}</p>
                </div>
                <a href={insight.href}>
                  {insight.linkLabel}
                  <ArrowUpRightIcon />
                </a>
              </article>
            );
          })}
        </section>
      ) : null}
    </div>
  );
}

function buildInsights(input: {
  projectId: string;
  from: Date;
  to: Date;
  overview?: Awaited<ReturnType<typeof getOverview>>;
  behavior?: Awaited<ReturnType<typeof getBehaviorAnalytics>>;
  performance?: Awaited<ReturnType<typeof getPerformance>>;
  apis?: Awaited<ReturnType<typeof getAPIs>>;
}) {
  const result: Insight[] = [];
  const range = new URLSearchParams({ from: input.from.toISOString(), to: input.to.toISOString() });
  const topEvent = input.behavior?.catalog[0];
  if (input.behavior && topEvent) {
    const parameters = new URLSearchParams(range);
    parameters.set("eventKind", topEvent.kind);
    parameters.set("eventName", topEvent.name);
    result.push({
      id: "behavior",
      eyebrow: "用户行为",
      title: `${eventName(topEvent.kind, topEvent.name)} 是当前最常见事件`,
      evidence: `${topEvent.metric.events.toLocaleString()} 次 · ${topEvent.metric.uniqueUsers.toLocaleString()} 位用户`,
      explanation: `占全部 ${input.behavior.totals.events.toLocaleString()} 个行为事件的 ${percent(topEvent.metric.events, input.behavior.totals.events)}，基于受治理事件目录。`,
      href: `/projects/${input.projectId}/events?${parameters}`,
      linkLabel: "查看事件样本",
      icon: ActivityIcon,
      tone: "neutral",
    });
  }
  const topIssue = input.overview?.topIssues[0];
  if (input.overview && topIssue) {
    const delta = input.overview.comparison.changes.errorRatePoints;
    result.push({
      id: "errors",
      eyebrow: "错误",
      title: topIssue.title,
      evidence: `${topIssue.events.toLocaleString()} 次 · ${topIssue.users.toLocaleString()} 位用户${delta === null ? "" : ` · 较上周期 ${signed(delta * 100)} 个百分点`}`,
      explanation: "按错误事件数排序的首要 Issue；周期变化来自相同长度的上一时段。",
      href: `/projects/${input.projectId}/issues/${encodeURIComponent(topIssue.fingerprint)}?${range}`,
      linkLabel: "查看 Issue 与源码",
      icon: BugIcon,
      tone: delta !== null && delta > 0 ? "critical" : "neutral",
    });
  }
  const worstRoute = [...(input.performance?.routes ?? [])]
    .filter((route) => route.lcp.p75 !== null)
    .sort((left, right) => (right.lcp.p75 ?? 0) - (left.lcp.p75 ?? 0))[0];
  if (worstRoute) {
    const parameters = new URLSearchParams(range);
    parameters.set("metric", "LCP");
    parameters.set("route", worstRoute.route);
    result.push({
      id: "performance",
      eyebrow: "性能",
      title: worstRoute.lcp.sufficient
        ? `${worstRoute.route || "未知页面"} 的 LCP 最慢`
        : `${worstRoute.route || "未知页面"} 的 LCP 样本不足`,
      evidence: `P75 ${Math.round(worstRoute.lcp.p75 ?? 0)} ms · ${worstRoute.lcp.samples.toLocaleString()} 个样本`,
      explanation: worstRoute.lcp.sufficient
        ? "基于真实用户 LCP 样本按页面比较；仅在达到样本阈值时下性能结论。"
        : `当前仅 ${worstRoute.lcp.samples} 个样本，展示测量值但不据此下性能结论。`,
      href: `/projects/${input.projectId}/performance?${parameters}`,
      linkLabel: "查看性能样本",
      icon: GaugeIcon,
      tone: worstRoute.lcp.sufficient && (worstRoute.lcp.p75 ?? 0) > 2500 ? "warning" : "neutral",
    });
  }
  const failingAPI = [...(input.apis?.endpoints ?? [])].sort(
    (left, right) => right.failures - left.failures,
  )[0];
  if (failingAPI) {
    const parameters = new URLSearchParams(range);
    parameters.set("sort", "failures");
    parameters.set("method", failingAPI.method);
    parameters.set("url", failingAPI.url);
    result.push({
      id: "api",
      eyebrow: "API",
      title:
        failingAPI.failures > 0
          ? `${failingAPI.method} ${failingAPI.url} 失败最多`
          : `${failingAPI.method} ${failingAPI.url} 请求量最高`,
      evidence: `${failingAPI.failures.toLocaleString()} 次失败 / ${failingAPI.requests.toLocaleString()} 次请求 · P95 ${Math.round(failingAPI.p95 ?? 0)} ms`,
      explanation:
        failingAPI.failures > 0
          ? "按失败请求数排序，失败包含网络错误与 5xx；4xx 单独统计。"
          : "当前范围没有失败样本，因此只展示请求量与延迟，不下异常结论。",
      href: `/projects/${input.projectId}/apis?${parameters}`,
      linkLabel: "查看请求样本",
      icon: ServerIcon,
      tone: failingAPI.failures > 0 ? "warning" : "neutral",
    });
  }
  return result;
}

function InsightsSkeleton({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "insight-grid" : "behavior-page"} aria-label="正在生成洞察">
      <Skeleton className="h-52" />
      <Skeleton className="h-52" />
      <Skeleton className="h-52" />
      <Skeleton className="h-52" />
    </div>
  );
}
function roundedMinute(value: Date) {
  const result = new Date(value);
  result.setUTCSeconds(0, 0);
  return result;
}
function percent(value: number, total: number) {
  return total ? `${((value / total) * 100).toFixed(1)}%` : "0%";
}
function signed(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}`;
}
function eventName(kind: string, name: string) {
  return kind === "page_view" ? "页面访问" : kind === "click" ? "元素点击" : name;
}
