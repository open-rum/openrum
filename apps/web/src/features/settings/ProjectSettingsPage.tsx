import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { toast } from "sonner";
import { Prohibit, Trash } from "@phosphor-icons/react";
import { AsyncError, AsyncLoading } from "@/components/ui/AsyncState";
import { Button } from "@/components/ui/button";
import { HoldButton } from "@/components/ui/hold-button";
import { SliderField } from "@/components/ui/slider-field";
import {
  canManageProjects,
  deleteProject,
  getProject,
  updateProject,
  type Project,
  type ProjectUpdate,
  type SDKPlatform,
} from "@/lib/api/projects";
import { ProjectPlatformSelector } from "@/features/projects/ProjectPlatformSelector";
import { SettingsShell } from "./SettingsShell";

export function ProjectSettingsRoute() {
  const { projectId } = useParams({ from: "/protected/settings/project/$projectId/general" });
  const query = useQuery({
    queryKey: ["project", projectId],
    queryFn: ({ signal }) => getProject(projectId, signal),
  });
  return (
    <SettingsShell
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
    </SettingsShell>
  );
}

function ProjectSettingsForms({ project }: { project: Project }) {
  const canManage = canManageProjects(project.role);
  return (
    <div className="grid gap-6">
      {!canManage ? (
        <p className="rounded-2xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
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
  const [sdkPlatform, setSDKPlatform] = useState<SDKPlatform>(project.sdkPlatform);
  const mutation = useProjectMutation(project, () => setSaved(true));
  const disabled = !canManage || mutation.isPending;
  return (
    <form
      className="rounded-2xl border border-border bg-card p-6"
      onSubmit={(event) => {
        event.preventDefault();
        setSaved(false);
        const form = new FormData(event.currentTarget);
        mutation.mutate({
          name: String(form.get("name") ?? "").trim(),
          sdkPlatform,
          allowedOrigins: parseOrigins(String(form.get("allowedOrigins") ?? "")),
          retentionDays: Number(form.get("retentionDays") ?? project.retentionDays),
        });
      }}
    >
      <h2 className="text-lg font-semibold text-foreground">常规</h2>
      <div className="mt-5 grid items-start gap-5 sm:grid-cols-2">
        <Field label="项目名称">
          <input name="name" required maxLength={120} defaultValue={project.name} />
        </Field>
        <ProjectPlatformSelector
          value={sdkPlatform}
          onValueChange={setSDKPlatform}
          disabled={disabled}
        />
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
        <SliderField
          name="retentionDays"
          label="原始数据保留天数"
          min={1}
          max={90}
          defaultValue={project.retentionDays}
          format={(value) => `${value} 天`}
          disabled={disabled}
        />
      </div>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">
        项目自动接收开发 <code>development</code>、测试 <code>test</code>、灰度 <code>staging</code>
        、生产 <code>production</code> 四个环境的上报，SDK <code>init()</code> 的{" "}
        <code>environment</code> 取其一即可，其他值会被拒绝。
      </p>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">
        保留天数受实例级策略约束，以更短的上限为准。采样率请前往
        <Link
          to="/settings/project/$projectId/sampling"
          params={{ projectId: project.id }}
          className="underline underline-offset-4"
        >
          数据管理 · 采样配置
        </Link>
        调整，并查看用量预估。
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
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const mutation = useProjectMutation(project);
  const deletion = useMutation({
    mutationFn: () => deleteProject(project.id),
    onSuccess: async () => {
      toast.success(`已删除项目「${project.name}」`, {
        description: "DSN 已吊销，全部数据会在后台永久删除。",
      });
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      await navigate({ to: "/projects" });
    },
  });
  const isDisabled = project.status === "disabled";
  const canDelete = project.role === "owner";
  return (
    <section
      className="rounded-2xl border border-destructive/40 bg-card p-6"
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
          disabled={!canManage || mutation.isPending || deletion.isPending}
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
      <div className="mt-6 border-t border-destructive/20 pt-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-2xl">
            <h3 className="text-sm font-medium text-foreground">删除项目</h3>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              立即吊销全部 DSN，并在后台永久删除
              Event、会话、错误、日志、API、性能、用量、告警、Release 和 Source
              Map。项目从列表中移除，只保留审计记录，无法恢复。
            </p>
            {canDelete ? (
              <p className="mt-2 text-sm text-muted-foreground">按住按钮 2 秒确认删除。</p>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">
                只有 Organization Owner 可以删除项目。
              </p>
            )}
            {deletion.error ? (
              <p className="mt-2 text-sm text-destructive" role="alert">
                删除失败，项目未改变：{deletion.error.message}
              </p>
            ) : null}
          </div>
          <HoldButton
            icon={<Trash />}
            doneIcon={<Trash />}
            doneLabel={deletion.isPending ? "正在删除…" : "已提交删除"}
            resetAfter={0}
            disabled={!canDelete || deletion.isPending || deletion.isSuccess}
            aria-label={`长按删除项目 ${project.name}`}
            onHold={() => deletion.mutate()}
          >
            长按删除项目
          </HoldButton>
        </div>
      </div>
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
    <label className="block text-sm font-medium text-foreground [&_input]:mt-2 [&_input]:h-[var(--control-height)] [&_input]:w-full [&_input]:rounded-full [&_input]:border [&_input]:border-input [&_input]:bg-background [&_input]:px-4 [&_input]:text-sm [&_input]:outline-none [&_input]:focus:border-ring [&_input]:focus:ring-2 [&_input]:focus:ring-ring/15 [&_textarea]:mt-2 [&_textarea]:w-full [&_textarea]:rounded-xl [&_textarea]:border [&_textarea]:border-input [&_textarea]:bg-background [&_textarea]:p-3 [&_textarea]:font-mono [&_textarea]:text-sm [&_textarea]:outline-none [&_textarea]:focus:border-ring [&_textarea]:focus:ring-2 [&_textarea]:focus:ring-ring/15">
      <span className="flex items-baseline justify-between gap-3">
        {label}
        {hint ? <small className="text-xs font-normal text-muted-foreground">{hint}</small> : null}
      </span>
      {children}
    </label>
  );
}
