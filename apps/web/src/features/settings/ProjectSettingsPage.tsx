import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { Prohibit, Warning } from "@phosphor-icons/react";
import { AsyncError, AsyncLoading } from "@/components/ui/AsyncState";
import { Button } from "@/components/ui/button";
import {
  canManageProjects,
  getProject,
  updateProject,
  type Project,
  type ProjectUpdate,
} from "@/lib/api/projects";
import { ProjectSettingsLayout } from "./ProjectSettingsLayout";

export function ProjectSettingsRoute() {
  const { projectId } = useParams({ from: "/protected/projects/$projectId/settings" });
  const query = useQuery({
    queryKey: ["project", projectId],
    queryFn: ({ signal }) => getProject(projectId, signal),
  });
  return (
    <ProjectSettingsLayout
      projectId={projectId}
      titleId="project-settings-title"
      title="项目设置"
      description="这些设置决定哪些站点可以上报、事件归属哪个环境，以及原始数据保留多久。"
    >
      {query.isLoading ? (
        <AsyncLoading label="正在加载项目设置…" />
      ) : query.error ? (
        <AsyncError
          error={query.error}
          title="无法加载项目设置"
          remediation="项目可能已被删除，或你已不在该组织中。"
          onRetry={() => void query.refetch()}
        />
      ) : query.data ? (
        <ProjectSettingsForms project={query.data} />
      ) : null}
    </ProjectSettingsLayout>
  );
}

function ProjectSettingsForms({ project }: { project: Project }) {
  const canManage = canManageProjects(project.role);
  return (
    <div className="grid gap-6">
      {!canManage ? (
        <p className="border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          当前角色为 {project.role}，只有 Owner 或 Admin 可以修改项目设置。
        </p>
      ) : null}
      <GeneralForm project={project} canManage={canManage} />
      <DangerZone project={project} canManage={canManage} />
    </div>
  );
}

function useProjectMutation(project: Project, onDone?: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ProjectUpdate) => updateProject(project.id, input),
    onSuccess: (updated) => {
      queryClient.setQueryData(["project", project.id], updated);
      // The project list caches its own copy, and the sidebar reads from it.
      void queryClient.invalidateQueries({ queryKey: ["projects", project.organizationId] });
      onDone?.();
    },
  });
}

function GeneralForm({ project, canManage }: { project: Project; canManage: boolean }) {
  const [saved, setSaved] = useState(false);
  const mutation = useProjectMutation(project, () => setSaved(true));
  const disabled = !canManage || mutation.isPending;
  return (
    <form
      className="border border-border bg-card p-6"
      onSubmit={(event) => {
        event.preventDefault();
        setSaved(false);
        const form = new FormData(event.currentTarget);
        mutation.mutate({
          name: String(form.get("name") ?? "").trim(),
          slug: String(form.get("slug") ?? "").trim(),
          allowedOrigins: parseOrigins(String(form.get("allowedOrigins") ?? "")),
          environment: String(form.get("environment") ?? "").trim(),
          environments: parseEnvironments(String(form.get("environments") ?? "")),
          retentionDays: Number(form.get("retentionDays") ?? project.retentionDays),
        });
      }}
    >
      <h2 className="text-lg font-semibold text-foreground">常规</h2>
      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <Field label="项目名称">
          <input name="name" required maxLength={120} defaultValue={project.name} />
        </Field>
        <Field label="项目 Slug" hint="小写字母、数字和连字符">
          <input
            name="slug"
            required
            maxLength={63}
            pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
            defaultValue={project.slug}
          />
        </Field>
      </div>
      <div className="mt-5">
        <Field label="允许的 Origin" hint="每行一个，不包含路径或结尾斜杠">
          <textarea
            name="allowedOrigins"
            required
            rows={4}
            defaultValue={project.allowedOrigins.join("\n")}
          />
        </Field>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          Ingest 会按 <code>Origin</code> 请求头逐条比对。移除某个 Origin
          后，来自该站点的上报会立刻被拒绝。
        </p>
      </div>
      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <Field label="默认环境" hint="进入项目时默认选择">
          <input
            name="environment"
            required
            maxLength={64}
            pattern="[a-z][a-z0-9_-]{0,63}"
            defaultValue={project.environment}
          />
        </Field>
        <Field label="可用环境" hint="每行一个，最多 16 个">
          <textarea
            name="environments"
            required
            rows={4}
            defaultValue={(project.environments?.length
              ? project.environments
              : [project.environment]
            ).join("\n")}
            placeholder={"production\ncanary\ntest\ndevelopment"}
          />
        </Field>
        <Field label="原始数据保留天数" hint="1–90 天">
          <input
            name="retentionDays"
            type="number"
            min={1}
            max={90}
            required
            defaultValue={project.retentionDays}
          />
        </Field>
      </div>
      <div className="mt-3 flex items-start gap-2 border border-(--ds-warning)/30 bg-(--ds-warning-soft) px-3 py-2.5 text-xs leading-5 text-(--ds-warning) dark:text-(--ds-warning)">
        <Warning className="mt-0.5 size-4 shrink-0" weight="fill" aria-hidden="true" />
        <span>
          SDK <code>init()</code> 里的 <code>environment</code> 必须存在于可用环境列表。
          未注册的环境会被 Ingest 拒绝，页面上只会表现为「没有数据」。
        </span>
      </div>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">
        保留天数最终还要经过实例级策略：实例设置了更短的上限时以更短的为准。采样率在「采样与用量」里配置，
        那里能同时看到调整后的量级预估。
      </p>
      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-border pt-5">
        <Button type="submit" disabled={disabled}>
          {mutation.isPending ? "保存中…" : "保存设置"}
        </Button>
        {saved && !mutation.isPending ? (
          <span className="text-sm text-(--ds-success)" role="status">
            已保存
          </span>
        ) : null}
      </div>
      {mutation.error ? (
        <p className="mt-3 text-sm text-destructive" role="alert">
          保存失败，项目设置未改变：{mutation.error.message}
        </p>
      ) : null}
    </form>
  );
}

function DangerZone({ project, canManage }: { project: Project; canManage: boolean }) {
  const mutation = useProjectMutation(project);
  const disabled = !canManage || mutation.isPending;
  const isDisabled = project.status === "disabled";
  return (
    <section
      className="border border-destructive/40 bg-card p-6"
      aria-labelledby="project-danger-zone"
    >
      <h2 id="project-danger-zone" className="text-lg font-semibold text-foreground">
        危险区域
      </h2>
      <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-2xl">
          <h3 className="text-sm font-medium text-foreground">
            {isDisabled ? "项目已停用" : "停用项目"}
          </h3>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {isDisabled
              ? "该项目当前拒绝所有上报。已入库的数据仍可查询，并继续按保留策略过期。"
              : "停用后 Ingest 会拒绝该项目的全部上报，客户端 DSN 不会被吊销。适合先止住噪声，再决定是否删除。"}
          </p>
        </div>
        <Button
          type="button"
          variant={isDisabled ? "outline" : "destructive"}
          disabled={disabled}
          onClick={() => {
            const nextStatus = isDisabled ? "active" : "disabled";
            const confirmation = isDisabled
              ? "恢复后该项目会重新接收上报。确认继续？"
              : "停用后该项目的全部上报都会被拒绝。确认继续？";
            if (window.confirm(confirmation)) mutation.mutate({ status: nextStatus });
          }}
        >
          <Prohibit />
          {isDisabled ? "恢复项目" : "停用项目"}
        </Button>
      </div>
      {mutation.error ? (
        <p className="mt-3 text-sm text-destructive" role="alert">
          操作失败，项目状态未改变：{mutation.error.message}
        </p>
      ) : null}
    </section>
  );
}

// Origins are entered one per line. Blank lines are dropped rather than sent as
// empty strings, which the server would reject for the whole request.
function parseOrigins(value: string) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseEnvironments(value: string) {
  return [
    ...new Set(
      value
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  ];
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm font-medium text-foreground [&_input]:mt-2 [&_input]:h-10 [&_input]:w-full [&_input]:rounded-md [&_input]:border [&_input]:border-input [&_input]:bg-background [&_input]:px-3 [&_input]:text-sm [&_input]:outline-none [&_input]:focus:border-ring [&_input]:focus:ring-2 [&_input]:focus:ring-ring/15 [&_textarea]:mt-2 [&_textarea]:w-full [&_textarea]:rounded-md [&_textarea]:border [&_textarea]:border-input [&_textarea]:bg-background [&_textarea]:p-3 [&_textarea]:font-mono [&_textarea]:text-sm [&_textarea]:outline-none [&_textarea]:focus:border-ring [&_textarea]:focus:ring-2 [&_textarea]:focus:ring-ring/15">
      <span className="flex items-baseline justify-between gap-3">
        {label}
        {hint ? <small className="text-xs font-normal text-muted-foreground">{hint}</small> : null}
      </span>
      {children}
    </label>
  );
}
