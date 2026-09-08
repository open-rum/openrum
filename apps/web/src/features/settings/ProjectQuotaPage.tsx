import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { AsyncError, AsyncLoading } from "@/components/ui/AsyncState";
import { Button } from "@/components/ui/button";
import {
  canManageProjects,
  getProject,
  updateProject,
  type OverLimitBehavior,
  type Project,
} from "@/lib/api/projects";
import { ProjectSettingsLayout } from "./ProjectSettingsLayout";

export function ProjectQuotaRoute() {
  const { projectId } = useParams({ from: "/protected/projects/$projectId/settings/quota" });
  const project = useQuery({
    queryKey: ["project", projectId],
    queryFn: ({ signal }) => getProject(projectId, signal),
  });
  return (
    <ProjectSettingsLayout
      projectId={projectId}
      titleId="project-quota-title"
      breadcrumb={`项目 / ${project.data?.name ?? "…"} / 配额`}
      title="配额"
      description="限制这个项目每秒能提交多少次上报。没有项目级配额时，一个项目的突发流量会挤占同一实例上其他项目的余量。"
    >
      {project.isLoading ? (
        <AsyncLoading label="正在加载配额设置…" />
      ) : project.error ? (
        <AsyncError
          error={project.error}
          title="无法加载配额设置"
          remediation="项目可能已被删除，或你已不在该组织中。"
          onRetry={() => void project.refetch()}
        />
      ) : project.data ? (
        <QuotaForm projectId={projectId} project={project.data} />
      ) : null}
    </ProjectSettingsLayout>
  );
}

function QuotaForm({ projectId, project }: { projectId: string; project: Project }) {
  const queryClient = useQueryClient();
  const canManage = canManageProjects(project.role);
  // An empty string is the "no override" state. It is kept as text rather than
  // as a number so that clearing the field is distinguishable from typing 0,
  // which the server refuses.
  const [limit, setLimit] = useState(
    project.ingestRateLimit === null ? "" : String(project.ingestRateLimit),
  );
  const [behavior, setBehavior] = useState<OverLimitBehavior>(project.overLimitBehavior);
  const [saved, setSaved] = useState(false);

  const mutation = useMutation({
    mutationFn: () =>
      updateProject(projectId, {
        ingestRateLimit: limit.trim() === "" ? null : Number(limit),
        overLimitBehavior: behavior,
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(["project", projectId], updated);
      setLimit(updated.ingestRateLimit === null ? "" : String(updated.ingestRateLimit));
      setBehavior(updated.overLimitBehavior);
      setSaved(true);
    },
  });
  const disabled = !canManage || mutation.isPending;

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate();
      }}
    >
      {!canManage ? (
        <p className="border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          当前角色为 {project.role}，只有 Owner 或 Admin 可以修改配额。
        </p>
      ) : null}

      <section className="border border-border bg-card p-6">
        <h2 className="text-lg font-semibold text-foreground">每秒请求上限</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          按<strong>请求</strong>计，不是按事件计——一次请求里可以带最多 100 个事件。
          留空表示沿用实例默认值（当前为 {project.defaultIngestRateLimit.toLocaleString()} /
          秒）。Redis 不可用时每个副本各自退化到一半额度，因为此时没有共享计数可依。
        </p>
        <label className="mt-5 flex max-w-xs flex-col gap-1.5 text-sm">
          <span className="font-medium text-foreground">上限（次 / 秒）</span>
          <input
            type="number"
            min={1}
            max={1000000}
            value={limit}
            disabled={disabled}
            placeholder={String(project.defaultIngestRateLimit)}
            aria-label="每秒请求上限"
            onChange={(event) => {
              setSaved(false);
              setLimit(event.target.value);
            }}
          />
          <span className="text-xs text-muted-foreground">留空则沿用实例默认值。</span>
        </label>
      </section>

      <section className="border border-border bg-card p-6">
        <h2 className="text-lg font-semibold text-foreground">超限行为</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          两种都会返回 429，区别在于<strong>丢谁</strong>。
        </p>
        <ul className="mt-5 flex flex-col gap-4">
          <BehaviorOption
            value="reject"
            current={behavior}
            disabled={disabled}
            title="拒绝"
            description="上限是精确的。一秒内先到的请求通过，其余全部拒绝，所以一次突发会把会话拦腰截断——会话在突发前开始，在突发中断掉，它的指标是按半页算出来的。"
            onChange={(next) => {
              setSaved(false);
              setBehavior(next);
            }}
          />
          <BehaviorOption
            value="sample"
            current={behavior}
            disabled={disabled}
            title="降采样"
            description="按调用方哈希丢弃，一个客户端在一个窗口内要么全过要么全不过，所以会话是完整的，速率和 Web Vitals 仍然可比。代价是上限变成近似值，单窗口最多放行到上限的两倍。"
            onChange={(next) => {
              setSaved(false);
              setBehavior(next);
            }}
          />
        </ul>
      </section>

      {mutation.error ? (
        <p role="alert" className="text-sm text-destructive">
          保存失败：{mutation.error instanceof Error ? mutation.error.message : "未知错误"}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={disabled}>
          {mutation.isPending ? "保存中…" : "保存"}
        </Button>
        {saved ? (
          <span role="status" className="text-sm text-muted-foreground">
            已保存。Ingest 缓存写入 Key 约 30 秒，之后生效。
          </span>
        ) : null}
      </div>
    </form>
  );
}

function BehaviorOption({
  value,
  current,
  disabled,
  title,
  description,
  onChange,
}: {
  value: OverLimitBehavior;
  current: OverLimitBehavior;
  disabled: boolean;
  title: string;
  description: string;
  onChange: (value: OverLimitBehavior) => void;
}) {
  return (
    <li>
      <label className="flex gap-3">
        <input
          type="radio"
          name="over-limit-behavior"
          className="mt-1"
          value={value}
          checked={current === value}
          disabled={disabled}
          onChange={() => onChange(value)}
        />
        <span className="min-w-0">
          <span className="block text-sm font-medium text-foreground">{title}</span>
          <span className="mt-1 block text-xs leading-5 text-muted-foreground">{description}</span>
        </span>
      </label>
    </li>
  );
}
