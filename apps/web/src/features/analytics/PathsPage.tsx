import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { ArrowRightIcon, GitBranchIcon, RefreshCwIcon } from "lucide-react";
import { useMemo, useState } from "react";
import {
  ConsoleFilterBar,
  ConsolePage,
  ConsolePageHeader,
  ConsolePageTabs,
} from "@/components/layout/ConsolePage";
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
import { getPaths } from "@/lib/api/analytics";
import { listOrganizations, listProjects, type Project } from "@/lib/api/projects";
import { AnalysisTabs } from "./AnalysisTabs";

type PathControls = {
  depth: 2 | 3 | 4 | 5;
  topN: 5 | 10 | 20;
};

export function PathsPage() {
  const { projectId } = useParams({ strict: false }) as { projectId?: string };
  const organizations = useQuery({ queryKey: ["organizations"], queryFn: listOrganizations });
  const organization = organizations.data?.organizations[0];
  const projects = useQuery({
    queryKey: ["projects", organization?.id],
    queryFn: () => listProjects(organization!.id),
    enabled: Boolean(organization),
  });
  if (organizations.isLoading || projects.isLoading) return <PathsSkeleton />;
  const project =
    projects.data?.projects.find((item) => item.id === projectId) ?? projects.data?.projects[0];
  if (!project) {
    return (
      <EmptyState
        icon={GitBranchIcon}
        title="尚未接入项目"
        description="接入行为事件后即可查看用户的常见访问路径。"
      />
    );
  }
  return <ProjectPaths project={project} />;
}

function ProjectPaths({ project }: { project: Project }) {
  const analysisContext = useAnalysisContext();
  const [controls, setControls] = useState<PathControls>({ depth: 5, topN: 20 });
  const to = useMemo(() => roundedMinute(new Date()), []);
  const input = {
    projectId: project.id,
    from: analysisContext?.from ?? new Date(to.getTime() - 24 * 3_600_000),
    to: analysisContext?.to ?? to,
    environment: analysisContext?.environment,
    depth: controls.depth,
    topN: controls.topN,
  };
  const query = useQuery({
    queryKey: ["paths", input],
    queryFn: ({ signal }) => getPaths(input, signal),
  });
  return (
    <ConsolePage width="fluid">
      <ConsolePageHeader
        title="用户路径"
        description="查看会话中最常见的有限事件序列，快速发现用户实际如何到达关键动作。"
        actions={
          <Button
            size="icon"
            variant="outline"
            aria-label="刷新用户路径"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
          >
            <RefreshCwIcon />
          </Button>
        }
      />
      <ConsolePageTabs>
        <AnalysisTabs projectId={project.id} active="paths" />
      </ConsolePageTabs>
      <ConsoleFilterBar
        primary={
          <div className="behavior-toolbar" aria-label="路径查询配置">
            <Select
              value={String(controls.depth)}
              onValueChange={(value) =>
                setControls((current) => ({ ...current, depth: Number(value) as 2 | 3 | 4 | 5 }))
              }
            >
              <SelectTrigger aria-label="路径最大深度">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {[2, 3, 4, 5].map((depth) => (
                    <SelectItem key={depth} value={String(depth)}>
                      最多 {depth} 步
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Select
              value={String(controls.topN)}
              onValueChange={(value) =>
                setControls((current) => ({ ...current, topN: Number(value) as 5 | 10 | 20 }))
              }
            >
              <SelectTrigger aria-label="路径返回数量">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {[5, 10, 20].map((topN) => (
                    <SelectItem key={topN} value={String(topN)}>
                      Top {topN}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <span className="behavior-toolbar__note">固定深度 · session_id · 不进行跨设备合并</span>
          </div>
        }
      />
      {query.isLoading ? <PathsSkeleton compact /> : null}
      {query.error ? (
        <AsyncError
          error={query.error}
          title="路径分析加载失败"
          remediation="请缩短时间范围或降低路径深度。"
          onRetry={() => void query.refetch()}
        />
      ) : null}
      {query.data ? <PathResults data={query.data} /> : null}
    </ConsolePage>
  );
}

function PathResults({ data }: { data: Awaited<ReturnType<typeof getPaths>> }) {
  if (data.paths.length === 0) {
    return (
      <div className="behavior-panel">
        <EmptyState
          icon={GitBranchIcon}
          title="当前范围没有可用路径"
          description="确认页面访问或自定义事件已开始采集。"
        />
      </div>
    );
  }
  return (
    <section className="behavior-panel" aria-labelledby="path-results-title">
      <div className="behavior-panel__header">
        <div>
          <h2 id="path-results-title">常见路径</h2>
          <p>每个会话最多展示 {data.depth} 步；重复率为近似统计。</p>
        </div>
        <span>{data.totalSessions.toLocaleString()} 个会话</span>
      </div>
      <div className="path-results">
        {data.paths.map((path, index) => (
          <article key={`${path.events.join("|")}:${index}`}>
            <span className="path-rank">{index + 1}</span>
            <div className="path-sequence">
              {path.events.map((event, eventIndex) => (
                <span className="path-event-group" key={`${event}:${eventIndex}`}>
                  <span className="path-event" title={event}>
                    {formatPathEvent(event)}
                  </span>
                  {eventIndex < path.events.length - 1 ? <ArrowRightIcon /> : null}
                </span>
              ))}
            </div>
            <div className="path-metric">
              <strong>{path.sessions.toLocaleString()}</strong>
              <span>{(path.share * 100).toFixed(1)}%</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function PathsSkeleton({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "grid gap-4" : "behavior-page"} aria-label="正在加载用户路径">
      <Skeleton className="h-24" />
      <Skeleton className="h-14" />
      <Skeleton className="h-96" />
    </div>
  );
}
function roundedMinute(value: Date) {
  const result = new Date(value);
  result.setUTCSeconds(0, 0);
  return result;
}
function formatPathEvent(value: string) {
  if (value === "click") return "元素点击";
  if (value.startsWith("page:")) return `页面 ${value.slice(5) || "未知"}`;
  if (value.startsWith("navigation:")) return `导航 ${value.slice(11) || "未知"}`;
  return value.startsWith("event:") ? value.slice(6) : value;
}
