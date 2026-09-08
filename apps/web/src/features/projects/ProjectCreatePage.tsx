import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Check, Copy, Key, Plus, Warning } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import {
  canManageProjects,
  createOrganization,
  createProject,
  listOrganizations,
  type Project,
} from "@/lib/api/projects";
import { recordProductEvent } from "@/lib/telemetry/productEvents";

export function ProjectCreatePage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [organizationId, setOrganizationId] = useState("");
  const [showOrganizationForm, setShowOrganizationForm] = useState(false);
  const [createdProject, setCreatedProject] = useState<Project | null>(null);
  const [copied, setCopied] = useState(false);
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
      if (project.writeKey)
        sessionStorage.setItem(`openrum:write-key:${project.id}`, project.writeKey);
      await queryClient.invalidateQueries({ queryKey: ["projects", activeOrganizationId] });
      await navigate({ to: "/projects/$projectId/onboarding", params: { projectId: project.id } });
    },
  });

  return (
    <section className="mx-auto w-full max-w-6xl px-6 py-8">
      <header className="border-b border-border pb-6">
        <p className="text-xs text-muted-foreground">项目 / 接入向导</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">创建监控项目</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          配置允许上报的站点 Origin、环境、数据保留与采样率，然后复制仅显示一次的 Write Key。
        </p>
      </header>

      {createdProject?.writeKey ? (
        <OneTimeProjectKey
          project={createdProject}
          copied={copied}
          onCopy={async () => {
            await navigator.clipboard.writeText(createdProject.writeKey ?? "");
            setCopied(true);
          }}
          onDismiss={() => setCreatedProject(null)}
        />
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <form
          className="border border-border bg-card p-6"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            projectMutation.mutate({
              name: String(form.get("name") ?? ""),
              slug: String(form.get("slug") ?? ""),
              allowedOrigins: String(form.get("allowedOrigins") ?? "")
                .split("\n")
                .map((value) => value.trim())
                .filter(Boolean),
              environment: String(form.get("environment") ?? "production"),
              retentionDays: Number(form.get("retentionDays") ?? 14),
              eventSampleRate: Number(form.get("eventSampleRate") ?? 1),
              apiSampleRate: Number(form.get("apiSampleRate") ?? 0.2),
              errorSampleRate: Number(form.get("errorSampleRate") ?? 1),
            });
          }}
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <FormField label="项目名称">
              <input name="name" required maxLength={120} placeholder="例如：商城 H5" />
            </FormField>
            <FormField label="项目 Slug" hint="小写字母、数字和连字符">
              <input
                name="slug"
                required
                maxLength={63}
                pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                placeholder="mall-h5"
              />
            </FormField>
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
            <FormField label="环境">
              <input
                name="environment"
                required
                defaultValue="production"
                pattern="[a-z][a-z0-9_-]{0,63}"
              />
            </FormField>
            <FormField label="原始数据保留天数" hint="1–90 天">
              <input
                name="retentionDays"
                type="number"
                min={1}
                max={90}
                required
                defaultValue={14}
              />
            </FormField>
            <FormField label="事件采样率" hint="0–1">
              <input
                name="eventSampleRate"
                type="number"
                min={0}
                max={1}
                step={0.01}
                required
                defaultValue={1}
              />
            </FormField>
            <FormField label="API 采样率" hint="0–1">
              <input
                name="apiSampleRate"
                type="number"
                min={0}
                max={1}
                step={0.01}
                required
                defaultValue={0.2}
              />
            </FormField>
            <FormField label="错误采样率" hint="0–1，建议保持 1">
              <input
                name="errorSampleRate"
                type="number"
                min={0}
                max={1}
                step={0.01}
                required
                defaultValue={1}
              />
            </FormField>
          </div>

          {!canCreate && organization ? (
            <p className="mt-5 border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
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
          <div className="border border-border bg-card p-5">
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
                className="mt-4 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
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
              className="border border-border bg-card p-5"
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
    </section>
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
    <label className="block text-sm font-medium text-foreground [&_input]:mt-2 [&_input]:h-10 [&_input]:w-full [&_input]:rounded-md [&_input]:border [&_input]:border-input [&_input]:bg-background [&_input]:px-3 [&_input]:text-sm [&_input]:outline-none [&_input]:focus:border-ring [&_input]:focus:ring-2 [&_input]:focus:ring-ring/15 [&_textarea]:mt-2 [&_textarea]:w-full [&_textarea]:rounded-md [&_textarea]:border [&_textarea]:border-input [&_textarea]:bg-background [&_textarea]:p-3 [&_textarea]:font-mono [&_textarea]:text-sm [&_textarea]:outline-none [&_textarea]:focus:border-ring [&_textarea]:focus:ring-2 [&_textarea]:focus:ring-ring/15">
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
  const writeKey = project.writeKey ?? "";
  const snippet = `import { init } from "@openrum/browser";\n\ninit({\n  writeKey: "${writeKey}",\n  endpoint: window.location.origin + "/ingest/v1/envelope"\n});`;
  return (
    <section
      className="mt-6 border border-amber-300 bg-amber-50 p-5 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100"
      aria-labelledby="write-key-created"
    >
      <div className="flex items-start gap-3">
        <Warning className="mt-0.5 size-5 shrink-0" weight="fill" />
        <div className="min-w-0 flex-1">
          <h2 id="write-key-created" className="text-base font-semibold">
            {project.name} 已创建，请立即保存 Write Key
          </h2>
          <p className="mt-1 text-sm leading-6 opacity-80">
            完整 Key 只显示这一次。关闭后只能轮换，无法找回。
          </p>
          <code className="mt-4 block overflow-x-auto border border-amber-300 bg-white px-3 py-2.5 font-mono text-sm whitespace-nowrap text-slate-950 dark:border-amber-800 dark:bg-black/30 dark:text-white">
            {writeKey}
          </code>
          <pre className="mt-3 overflow-x-auto border border-amber-300/70 bg-white/70 p-3 font-mono text-xs leading-5 text-slate-800 dark:border-amber-800 dark:bg-black/20 dark:text-slate-200">
            {snippet}
          </pre>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={onCopy}>
              {copied ? <Check weight="bold" /> : <Copy />}
              {copied ? "已复制" : "复制 Write Key"}
            </Button>
            <Button type="button" variant="ghost" onClick={onDismiss}>
              <Key /> 我已安全保存
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
