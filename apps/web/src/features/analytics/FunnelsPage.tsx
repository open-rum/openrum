import { readFunnelDraft, rememberFunnelDraft } from "./funnelDraft";
import { equalsTerm } from "@/lib/search/legacy";
import { analysisSessionsHref } from "./investigationLinks";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { ArrowDownIcon, FilterIcon, PlusIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ConsolePage, ConsolePageHeader, ConsolePageTabs } from "@/components/layout/ConsolePage";
import { AsyncError } from "@/components/ui/AsyncState";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { useAnalysisContext } from "@/features/filters/AnalysisContextBar";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getBehaviorAnalytics,
  queryFunnel,
  type BehaviorDimension,
  type FunnelDefinition,
  type FunnelStep,
} from "@/lib/api/analytics";
import { listOrganizations, listProjects, type Project } from "@/lib/api/projects";
import { AnalysisTabs } from "./AnalysisTabs";
import { eventLabel } from "./labels";

const defaultSteps: FunnelStep[] = [
  { kind: "page_view", name: "page_view" },
  { kind: "click", name: "click" },
];

export function FunnelsPage() {
  const { projectId } = useParams({ strict: false }) as { projectId?: string };
  const organizations = useQuery({ queryKey: ["organizations"], queryFn: listOrganizations });
  const organization = organizations.data?.organizations[0];
  const projects = useQuery({
    queryKey: ["projects", organization?.id],
    queryFn: () => listProjects(organization!.id),
    enabled: Boolean(organization),
  });
  if (organizations.isLoading || projects.isLoading) return <FunnelSkeleton />;
  const project =
    projects.data?.projects.find((item) => item.id === projectId) ?? projects.data?.projects[0];
  if (!project) {
    return (
      <EmptyState
        icon={FilterIcon}
        title="尚未接入项目"
        description="创建项目并接入 SDK 后，即可配置行为漏斗。"
      />
    );
  }
  return <ProjectFunnels key={project.id} project={project} />;
}

function ProjectFunnels({ project }: { project: Project }) {
  const analysisContext = useAnalysisContext();
  const now = useMemo(() => roundedMinute(new Date()), []);
  const rangeFrom = analysisContext?.from ?? new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const rangeTo = analysisContext?.to ?? now;
  const catalog = useQuery({
    queryKey: [
      "funnel-event-catalog",
      project.id,
      rangeFrom.toISOString(),
      rangeTo.toISOString(),
      analysisContext?.environment,
    ],
    queryFn: ({ signal }) =>
      getBehaviorAnalytics(
        {
          projectId: project.id,
          from: rangeFrom,
          to: rangeTo,
          environment: analysisContext?.environment,
          dimension: "country",
        },
        signal,
      ),
  });
  const [restored] = useState(() => readFunnelDraft(project.id));
  const [draft, setDraft] = useState<FunnelDefinition>(() => ({
    projectId: project.id,
    from: rangeFrom,
    to: rangeTo,
    environment: analysisContext?.environment,
    dimension: "country",
    windowSeconds: 3600,
    steps: defaultSteps,
    ...restored?.draft,
  }));
  const [applied, setApplied] = useState<FunnelDefinition | null>(() =>
    restored?.applied ? { ...draft, ...restored.applied } : null,
  );
  useEffect(() => rememberFunnelDraft(project.id, draft, applied), [project.id, draft, applied]);
  const effectiveApplied = {
    ...(applied ?? draft),
    from: rangeFrom,
    to: rangeTo,
    environment: analysisContext?.environment,
  };
  const result = useQuery({
    queryKey: ["funnel", effectiveApplied],
    queryFn: ({ signal }) => queryFunnel(effectiveApplied, signal),
    enabled: applied !== null,
  });
  const options = useMemo(() => {
    const values = new Map<string, FunnelStep>();
    for (const step of defaultSteps) values.set(stepKey(step), step);
    // Keep a restored selection visible even if it has no events in the current range.
    for (const step of draft.steps) values.set(stepKey(step), step);
    values.set("navigation:navigation", { kind: "navigation", name: "navigation" });
    for (const item of catalog.data?.catalog ?? []) {
      values.set(`${item.kind}:${item.name}`, { kind: item.kind, name: item.name });
    }
    return [...values.values()];
  }, [catalog.data, draft.steps]);
  const unobserved = catalog.data
    ? (applied ?? draft).steps.filter(
        (step) =>
          !catalog.data.catalog.some(
            (item) => stepKey(item) === stepKey(step) && item.metric.events > 0,
          ),
      )
    : [];

  const updateStep = (index: number, value: string) => {
    const next = options.find((item) => stepKey(item) === value);
    if (!next) return;
    setDraft((current) => ({
      ...current,
      steps: current.steps.map((step, stepIndex) => (stepIndex === index ? next : step)),
    }));
  };

  return (
    <ConsolePage width="fluid">
      <ConsolePageHeader
        title="漏斗分析"
        description="观察同一会话内用户按顺序完成关键行为的转化和流失。"
        actions={
          <Button
            size="icon"
            variant="outline"
            aria-label="刷新漏斗"
            onClick={() => {
              void catalog.refetch();
              if (applied) void result.refetch();
            }}
            disabled={catalog.isFetching || result.isFetching}
          >
            <RefreshCwIcon />
          </Button>
        }
      />
      <ConsolePageTabs>
        <AnalysisTabs projectId={project.id} active="funnels" />
      </ConsolePageTabs>

      <section className="funnel-builder" aria-labelledby="funnel-builder-title">
        <div className="behavior-panel__header">
          <div>
            <h2 id="funnel-builder-title">漏斗步骤</h2>
            <p>选择 2–5 个步骤后运行漏斗；本标签页会保留已选步骤，方便返回继续分析。</p>
          </div>
          <Button
            variant="outline"
            onClick={() =>
              setDraft((current) => ({ ...current, steps: [...current.steps, defaultSteps[1]!] }))
            }
            disabled={draft.steps.length >= 5}
          >
            <PlusIcon /> 添加步骤
          </Button>
        </div>
        <div className="funnel-steps">
          {draft.steps.map((step, index) => (
            <div className="funnel-step-editor" key={`${index}:${stepKey(step)}`}>
              <span className="funnel-step-index">{index + 1}</span>
              <div>
                <label htmlFor={`funnel-step-${index}`}>步骤 {index + 1}</label>
                <Select value={stepKey(step)} onValueChange={(value) => updateStep(index, value)}>
                  <SelectTrigger id={`funnel-step-${index}`} aria-label={`漏斗步骤 ${index + 1}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {options.map((option) => (
                        <SelectItem key={stepKey(option)} value={stepKey(option)}>
                          {eventLabel(option.kind, option.name)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`删除步骤 ${index + 1}`}
                disabled={draft.steps.length <= 2}
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    steps: current.steps.filter((_, stepIndex) => stepIndex !== index),
                  }))
                }
              >
                <Trash2Icon />
              </Button>
              {index < draft.steps.length - 1 ? (
                <ArrowDownIcon className="funnel-step-arrow" />
              ) : null}
            </div>
          ))}
        </div>
        <div className="funnel-controls">
          <Select
            value={String(draft.windowSeconds)}
            onValueChange={(value) =>
              setDraft((current) => ({
                ...current,
                windowSeconds: Number(value) as FunnelDefinition["windowSeconds"],
              }))
            }
          >
            <SelectTrigger aria-label="转化窗口">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="1800">30 分钟转化窗口</SelectItem>
                <SelectItem value="3600">1 小时转化窗口</SelectItem>
                <SelectItem value="86400">24 小时转化窗口</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <Select
            value={draft.dimension}
            onValueChange={(value) =>
              setDraft((current) => ({ ...current, dimension: value as BehaviorDimension }))
            }
          >
            <SelectTrigger aria-label="漏斗分群维度">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="country">按国家分群</SelectItem>
                <SelectItem value="device">按设备分群</SelectItem>
                <SelectItem value="browser">按浏览器分群</SelectItem>
                <SelectItem value="source">按来源分群</SelectItem>
                {catalog.data?.properties.map((property) => (
                  <SelectItem key={property.name} value={`property:${property.name}`}>
                    按属性 · {property.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Button
            onClick={() => setApplied({ ...draft, steps: [...draft.steps] })}
            disabled={result.isFetching}
          >
            运行漏斗
          </Button>
        </div>
      </section>

      {catalog.error ? (
        <AsyncError
          error={catalog.error}
          title="无法检查步骤事件"
          remediation="事件可用性暂时未知，请重试后确认步骤。"
          onRetry={() => void catalog.refetch()}
        />
      ) : null}
      {unobserved.length ? (
        <div className="alert alert-soft alert-warning" role="status">
          <span>
            当前时间与环境下未观测到：
            {unobserved.map((step) => eventLabel(step.kind, step.name)).join("、")}。
            请检查事件采集或调整范围；这些步骤为 0 不能单独说明业务流失。
          </span>
        </div>
      ) : null}
      {!applied ? (
        <p className="text-sm text-base-content/70">
          确认步骤和事件采集后，点击“运行漏斗”查看结果。
        </p>
      ) : null}

      {applied &&
      (JSON.stringify(draft.steps) !== JSON.stringify(applied.steps) ||
        draft.windowSeconds !== applied.windowSeconds ||
        draft.dimension !== applied.dimension) ? (
        <p role="status" className="alert alert-soft alert-info">
          步骤或设置已修改，下方仍是上次运行结果。点击“运行漏斗”应用新设置。
        </p>
      ) : null}
      {result.isLoading ? <FunnelSkeleton compact /> : null}
      {result.error ? (
        <AsyncError
          error={result.error}
          title="漏斗计算失败"
          remediation="请缩短时间范围、减少步骤，或改用国家、设备、浏览器等内置维度。"
          onRetry={() => void result.refetch()}
        />
      ) : null}
      {applied && result.data ? (
        <FunnelResults
          projectId={project.id}
          environment={analysisContext?.environment}
          data={result.data}
        />
      ) : null}
    </ConsolePage>
  );
}

function FunnelResults({
  data,
  projectId,
  environment,
}: {
  data: Awaited<ReturnType<typeof queryFunnel>>;
  projectId: string;
  environment?: string;
}) {
  const first = data.steps[0]?.sessions ?? 0;
  return (
    <>
      <div className="funnel-method-note">
        同一 session_id 顺序匹配 · 最多 100 个分群值 · 结果为近似统计，不进行跨设备身份合并
      </div>
      <section className="behavior-panel" aria-labelledby="funnel-result-title">
        <div className="behavior-panel__header">
          <div>
            <h2 id="funnel-result-title">转化结果</h2>
            <p>{windowLabel(data.windowSeconds)}转化窗口</p>
          </div>
          <span>{first.toLocaleString()} 个起始会话</span>
        </div>
        <div className="funnel-results">
          {data.steps.map((step) => (
            <article key={step.index}>
              <div className="funnel-result-meta">
                <span>步骤 {step.index}</span>
                <strong>{eventLabel(step.kind, step.name)}</strong>
                <small>{step.sessions.toLocaleString()} 个会话</small>
              </div>
              <div className="funnel-result-track">
                <span style={{ width: `${first ? (step.sessions / first) * 100 : 0}%` }} />
              </div>
              <div className="funnel-result-rate">
                <strong>
                  {formatRate(
                    first ? (step.conversionFromFirst ?? (step.index === 1 ? 1 : null)) : null,
                  )}
                </strong>
                <span>
                  {step.index === 1
                    ? "起始"
                    : `较上一步 ${formatRate(step.conversionFromPrevious)}`}
                </span>
              </div>
            </article>
          ))}
        </div>
      </section>
      <div className="behavior-grid funnel-details">
        <section className="behavior-panel" aria-labelledby="funnel-breakdown-title">
          <div className="behavior-panel__header">
            <div>
              <h2 id="funnel-breakdown-title">分群转化</h2>
              <p>按起始会话排序。</p>
            </div>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>分群</TableHead>
                {data.steps.map((step) => (
                  <TableHead key={step.index}>步骤 {step.index}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.breakdown.slice(0, 12).map((group) => (
                <TableRow key={group.value}>
                  <TableCell>
                    <strong>{group.value}</strong>
                  </TableCell>
                  {group.stepCounts.map((count, index) => (
                    <TableCell key={index}>{count.toLocaleString()}</TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
        <section className="behavior-panel" aria-labelledby="funnel-samples-title">
          <div className="behavior-panel__header">
            <div>
              <h2 id="funnel-samples-title">会话样本</h2>
              <p>顺序匹配到的会话样本。</p>
            </div>
            <span>最多 20 条</span>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>会话</TableHead>
                <TableHead>到达</TableHead>
                <TableHead>最近活动</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.samples.map((sample) => (
                <TableRow key={sample.sessionId}>
                  <TableCell title={sample.sessionId}>
                    <a
                      className="link link-hover"
                      aria-label={`查看会话 ${sample.sessionId}`}
                      href={analysisSessionsHref(
                        projectId,
                        { ...data, environment },
                        equalsTerm("session_id", sample.sessionId),
                        `${window.location.pathname}${window.location.search}`,
                        sample.sessionId,
                      )}
                    >
                      …{sample.sessionId.slice(-8)}
                    </a>
                  </TableCell>
                  <TableCell>步骤 {sample.reachedStep}</TableCell>
                  <TableCell>{formatTime(sample.lastSeenAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      </div>
    </>
  );
}

function FunnelSkeleton({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "grid gap-4" : "behavior-page"} aria-label="正在加载漏斗分析">
      <Skeleton className="h-24" />
      <Skeleton className="h-72" />
      <Skeleton className="h-64" />
    </div>
  );
}
function stepKey(step: FunnelStep) {
  return `${step.kind}:${step.name}`;
}
function roundedMinute(value: Date) {
  const result = new Date(value);
  result.setUTCSeconds(0, 0);
  return result;
}
function formatRate(value: number | null) {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}
function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
function windowLabel(seconds: number) {
  return seconds === 1800 ? "30 分钟" : seconds === 3600 ? "1 小时" : "24 小时";
}
