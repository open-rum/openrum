import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { AsyncError, AsyncLoading } from "@/components/ui/AsyncState";
import { Button } from "@/components/ui/button";
import { SamplingForm } from "@/features/usage/SamplingForm";
import { getProject } from "@/lib/api/projects";
import { getUsage, usageRange } from "@/lib/api/usage";
import { ProjectDataSettingsShell } from "./ProjectDataSettingsShell";

export function ProjectSamplingRoute() {
  const { projectId } = useParams({ from: "/protected/settings/project/$projectId/sampling" });
  // A project-wide estimate must include all event classes, independently of report filters.
  const range = useMemo(() => usageRange(7), []);
  const project = useQuery({
    queryKey: ["project", projectId],
    queryFn: ({ signal }) => getProject(projectId, signal),
  });
  const usage = useQuery({
    queryKey: ["usage", projectId, range.from.toISOString(), range.to.toISOString(), ""],
    queryFn: ({ signal }) => getUsage(projectId, range, signal),
    enabled: Boolean(project.data),
  });
  const previewUsage =
    !usage.error &&
    usage.data &&
    usage.data.breakdown.length < 5000 &&
    usage.data.breakdown.some((row) => row.outcome === "accepted")
      ? usage.data
      : undefined;

  return (
    <ProjectDataSettingsShell projectId={projectId} section="sampling">
      {project.isLoading ? (
        <AsyncLoading label="正在加载采样配置…" />
      ) : project.error ? (
        <AsyncError
          error={project.error}
          title="无法加载采样配置"
          remediation="请确认项目存在且你有访问权限。"
          onRetry={() => void project.refetch()}
        />
      ) : project.data ? (
        <SamplingForm
          key={projectId}
          project={project.data}
          usage={previewUsage}
          previewFallback={
            usage.isLoading ? (
              <AsyncLoading label="正在计算最近 7 天的用量预估…" />
            ) : usage.error ? (
              <div className="space-y-3">
                <p>用量预估暂时不可用，不影响查看和保存采样配置。</p>
                <Button variant="outline" onClick={() => void usage.refetch()}>
                  重新加载预估
                </Button>
              </div>
            ) : (
              <p>
                {usage.data && usage.data.breakdown.length >= 5000
                  ? "最近 7 天的用量明细已达查询上限，暂不展示不完整的预估。仍可正常保存配置。"
                  : "最近 7 天尚无可用于预估的已接收事件。完成上报后会显示预估，当前仍可配置采样率。"}
              </p>
            )
          }
        />
      ) : null}
    </ProjectDataSettingsShell>
  );
}
