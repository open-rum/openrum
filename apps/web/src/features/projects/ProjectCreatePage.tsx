import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Check, Copy, Key, Plus, Warning } from "@phosphor-icons/react";
import { ConsolePage, ConsolePageHeader } from "@/components/layout/ConsolePage";
import { Button } from "@/components/ui/button";
import {
  canManageProjects,
  createOrganization,
  createProject,
  listOrganizations,
  type Project,
  type SDKPlatform,
} from "@/lib/api/projects";
import { recordProductEvent } from "@/lib/telemetry/productEvents";
import { SliderField } from "@/components/ui/slider-field";
import { ProjectPlatformSelector } from "./ProjectPlatformSelector";

export function ProjectCreatePage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [organizationId, setOrganizationId] = useState("");
  const [showOrganizationForm, setShowOrganizationForm] = useState(false);
  const [createdProject, setCreatedProject] = useState<Project | null>(null);
  const [copied, setCopied] = useState(false);
  const [sdkPlatform, setSDKPlatform] = useState<SDKPlatform>("javascript");
  const organizationsQuery = useQuery({
    queryKey: ["organizations"],
    queryFn: listOrganizations,
  });
  const organizations = useMemo(
    () => organizationsQuery.data?.organizations ?? [],
    [organizationsQuery.data],
  );

  const activeOrganizationId = organizationId || organizations[0]?.id || "";
  const organization = organizations.find((item) => item.id === activeOrganizationId);
  const canCreate = organization ? canManageProjects(organization.role) : false;
  const organizationMutation = useMutation({
    mutationFn: createOrganization,
    onSuccess: async (created) => {
      queryClient.setQueryData<{ organizations: typeof organizations }>(
        ["organizations"],
        (current) => ({ organizations: [...(current?.organizations ?? []), created] }),
      );
      setOrganizationId(created.id);
      setShowOrganizationForm(false);
      await queryClient.invalidateQueries({ queryKey: ["organizations"] });
    },
  });
  const projectMutation = useMutation({
    mutationFn: (input: Parameters<typeof createProject>[1]) =>
      createProject(activeOrganizationId, input),
    onSuccess: async (project) => {
      recordProductEvent("project_created", project.id);
      setCopied(false);
      setCreatedProject(project);
      await queryClient.invalidateQueries({ queryKey: ["projects", activeOrganizationId] });
      await navigate({ to: "/projects/$projectId/onboarding", params: { projectId: project.id } });
    },
  });

  return (
    <ConsolePage width="wide">
      <ConsolePageHeader
        title="创建监控项目"
        description="选择开发平台并配置站点 Origin、环境、数据保留与采样率，创建后继续完成对应 SDK 接入。"
      />

      {createdProject?.dsn ? (
        <OneTimeProjectKey
          project={createdProject}
          copied={copied}
          onCopy={async () => {
            await navigator.clipboard.writeText(createdProject.dsn ?? "");
            setCopied(true);
          }}
          onDismiss={() => setCreatedProject(null)}
        />
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <form
          className="rounded-2xl border border-border bg-card p-6"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            projectMutation.mutate({
              name: String(form.get("name") ?? ""),
              sdkPlatform,
              allowedOrigins: String(form.get("allowedOrigins") ?? "")
                .split("\n")
                .map((value) => value.trim())
                .filter(Boolean),
              retentionDays: Number(form.get("retentionDays") ?? 14),
              eventSampleRate: Number(form.get("eventSampleRate") ?? 1),
              apiSampleRate: Number(form.get("apiSampleRate") ?? 0.2),
              errorSampleRate: Number(form.get("errorSampleRate") ?? 1),
            });
          }}
        >
          <div className="grid items-start gap-5 sm:grid-cols-2">
            <FormField label="项目名称">
              <input name="name" required maxLength={120} placeholder="例如：商城 H5" />
            </FormField>
            <ProjectPlatformSelector value={sdkPlatform} onValueChange={setSDKPlatform} />
          </div>
          <div className="mt-5">
            <FormField label="允许的 Origin" hint="每行一个，不包含路径或结尾斜杠">
              <textarea
                name="allowedOrigins"
                required
                rows={4}
                placeholder={"https://www.example.com\nhttp://localhost:4173"}
              />
            </FormField>
          </div>
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <SliderField
              name="retentionDays"
              label="原始数据保留天数"
              min={1}
              max={90}
              defaultValue={14}
              format={(value) => `${value} 天`}
            />
            <SliderField
              name="eventSampleRate"
              label="事件采样率"
              min={0}
              max={1}
              scale={100}
              step={10}
              defaultValue={1}
              format={(value) => `${Math.round(value * 100)}%`}
            />
            <SliderField
              name="apiSampleRate"
              label="API 采样率"
              min={0}
              max={1}
              scale={100}
              step={10}
              defaultValue={0.2}
              format={(value) => `${Math.round(value * 100)}%`}
            />
            <SliderField
              name="errorSampleRate"
              label="错误采样率"
              hint="建议保持 100%"
              min={0}
              max={1}
              scale={100}
              step={10}
              defaultValue={1}
              format={(value) => `${Math.round(value * 100)}%`}
            />
          </div>

          {!canCreate && organization ? (
            <p className="mt-5 rounded-xl border border-(--ds-warning)/30 bg-(--ds-warning-soft) px-3 py-2.5 text-sm text-(--ds-warning) dark:text-(--ds-warning)">
              当前角色为 {organization.role}，只有 Owner 或 Admin 可以创建项目。
            </p>
          ) : null}
          {projectMutation.error ? (
            <p className="mt-5 text-sm text-destructive" role="alert">
              {projectMutation.error.message}
            </p>
          ) : null}
          <div className="mt-6 flex justify-end">
            <Button
              type="submit"
              size="lg"
              className="h-10 px-5"
              disabled={!canCreate || projectMutation.isPending}
            >
              <Plus weight="bold" />
              {projectMutation.isPending ? "正在创建…" : "创建项目"}
            </Button>
          </div>
        </form>

        <aside className="space-y-4">
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold">所属组织</h2>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setShowOrganizationForm((value) => !value)}
              >
                <Plus /> 新组织
              </Button>
            </div>
            {organizationsQuery.isLoading ? (
              <p className="mt-4 text-sm text-muted-foreground">正在加载组织…</p>
            ) : organizationsQuery.error ? (
              <p className="mt-4 text-sm text-destructive" role="alert">
                {organizationsQuery.error.message}
              </p>
            ) : (
              <select
                className="mt-4 h-10 w-full rounded-full border border-input bg-background px-3 text-sm"
                aria-label="所属组织"
                value={activeOrganizationId}
                onChange={(event) => setOrganizationId(event.target.value)}
              >
                {organizations.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {item.role}
                  </option>
                ))}
              </select>
            )}
          </div>

          {showOrganizationForm || organizations.length === 0 ? (
            <form
              className="rounded-2xl border border-border bg-card p-5"
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                organizationMutation.mutate({
                  name: String(form.get("organizationName") ?? ""),
                  slug: String(form.get("organizationSlug") ?? ""),
                });
              }}
            >
              <h2 className="text-base font-semibold">创建组织</h2>
              <div className="mt-4 space-y-4">
                <FormField label="组织名称">
                  <input name="organizationName" required maxLength={120} />
                </FormField>
                <FormField label="组织 Slug">
                  <input
                    name="organizationSlug"
                    required
                    maxLength={63}
                    pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                  />
                </FormField>
              </div>
              {organizationMutation.error ? (
                <p className="mt-4 text-sm text-destructive" role="alert">
                  {organizationMutation.error.message}
                </p>
              ) : null}
              <Button
                type="submit"
                className="mt-4 w-full"
                disabled={organizationMutation.isPending}
              >
                {organizationMutation.isPending ? "正在创建…" : "创建组织"}
              </Button>
            </form>
          ) : null}
        </aside>
      </div>
    </ConsolePage>
  );
}

function FormField({
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

function OneTimeProjectKey({
  project,
  copied,
  onCopy,
  onDismiss,
}: {
  project: Project;
  copied: boolean;
  onCopy: () => void;
  onDismiss: () => void;
}) {
  const dsn = project.dsn ?? "";
  const snippet = `import { init } from "@openrum/browser";\n\ninit({\n  dsn: "${dsn}"\n});`;
  return (
    <section
      className="mt-6 rounded-2xl border border-(--ds-warning)/30 bg-(--ds-warning-soft) p-5 text-(--ds-warning) dark:text-(--ds-warning)"
      aria-labelledby="dsn-created"
    >
      <div className="flex items-start gap-3">
        <Warning className="mt-0.5 size-5 shrink-0" weight="fill" />
        <div className="min-w-0 flex-1">
          <h2 id="dsn-created" className="text-base font-semibold">
            {project.name} 已创建
          </h2>
          <p className="mt-1 text-sm leading-6 opacity-80">
            DSN 是浏览器公开的只写连接串，之后也可以在项目设置中查看和复制。
          </p>
          <code className="mt-4 block overflow-x-auto border border-(--ds-warning)/30 bg-white px-3 py-2.5 font-mono text-sm whitespace-nowrap text-slate-950 dark:bg-black/30 dark:text-white">
            {dsn}
          </code>
          <pre className="mt-3 overflow-x-auto border border-(--ds-warning)/30/70 bg-white/70 p-3 font-mono text-xs leading-5 text-slate-800 dark:bg-black/20 dark:text-slate-200">
            {snippet}
          </pre>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={onCopy}>
              {copied ? <Check weight="bold" /> : <Copy />}
              {copied ? "已复制" : "复制 DSN"}
            </Button>
            <Button type="button" variant="ghost" onClick={onDismiss}>
              <Key /> 关闭
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
