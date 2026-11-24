import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Check, Copy, Key, Warning } from "@phosphor-icons/react";
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
import { validateProjectOrigins } from "./projectOrigins";

const DEFAULT_ALLOWED_ORIGINS = "http://localhost:4173";

export function ProjectCreatePage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [originsValue, setOriginsValue] = useState(DEFAULT_ALLOWED_ORIGINS);
  const [showOriginIssues, setShowOriginIssues] = useState(false);
  const originsRef = useRef<HTMLTextAreaElement>(null);
  const originValidation = validateProjectOrigins(originsValue);
  const originIssues = showOriginIssues ? originValidation.issues : [];
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
    <ConsolePage width="narrow" className="mx-auto max-w-[744px]">
      <ConsolePageHeader title="创建项目" description="填写项目信息，下一步接入 SDK。" />

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

      <div className="card card-border bg-base-100">
        <div className="card-body gap-6">
          <section
            aria-labelledby="project-organization-label"
            className="border-b border-base-300 pb-6"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 id="project-organization-label" className="text-sm font-medium">
                所属组织
              </h2>
              {organizations.length > 0 ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={projectMutation.isPending}
                  aria-expanded={showOrganizationForm}
                  aria-controls="create-organization-form"
                  onClick={() => setShowOrganizationForm((value) => !value)}
                >
                  {showOrganizationForm ? "取消新建" : "新建组织"}
                </Button>
              ) : null}
            </div>
            {organizationsQuery.isLoading ? (
              <p className="mt-2 text-sm text-base-content/70" role="status">
                正在加载组织…
              </p>
            ) : organizationsQuery.error ? (
              <div className="mt-2 flex items-center justify-between gap-3">
                <p className="text-sm text-error" role="alert">
                  组织加载失败，请重试。
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void organizationsQuery.refetch()}
                >
                  重试
                </Button>
              </div>
            ) : organizations.length > 1 ? (
              <select
                className="select mt-2 w-full"
                aria-labelledby="project-organization-label"
                value={activeOrganizationId}
                disabled={projectMutation.isPending}
                onChange={(event) => setOrganizationId(event.target.value)}
              >
                {organizations.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            ) : organization ? (
              <p className="mt-2 text-sm text-base-content/85">{organization.name}</p>
            ) : (
              <p className="mt-2 text-sm text-base-content/70">
                先创建一个组织，用于管理项目和成员。
              </p>
            )}
            {!organizationsQuery.isLoading &&
            !organizationsQuery.error &&
            (showOrganizationForm || organizations.length === 0) ? (
              <form
                id="create-organization-form"
                className="mt-4 space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (organizationMutation.isPending || projectMutation.isPending) return;
                  const form = new FormData(event.currentTarget);
                  organizationMutation.mutate({
                    name: String(form.get("organizationName") ?? "").trim(),
                    slug: String(form.get("organizationSlug") ?? ""),
                  });
                }}
              >
                <fieldset
                  disabled={organizationMutation.isPending || projectMutation.isPending}
                  className="grid gap-4 sm:grid-cols-2"
                >
                  <FormField label="组织名称">
                    <input name="organizationName" required maxLength={120} />
                  </FormField>
                  <FormField label="组织标识" hint="小写字母、数字或连字符">
                    <input
                      name="organizationSlug"
                      required
                      maxLength={63}
                      placeholder="my-team"
                      pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                    />
                  </FormField>
                </fieldset>
                {organizationMutation.error ? (
                  <p className="text-sm text-error" role="alert">
                    {organizationMutation.error.message}
                  </p>
                ) : null}
                <Button
                  type="submit"
                  size="sm"
                  variant="outline"
                  disabled={organizationMutation.isPending || projectMutation.isPending}
                >
                  {organizationMutation.isPending ? "正在创建…" : "创建组织"}
                </Button>
              </form>
            ) : null}
          </section>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!canCreate || projectMutation.isPending || organizationMutation.isPending) return;
              setShowOriginIssues(true);
              if (originValidation.issues.length) {
                originsRef.current?.focus();
                return;
              }
              const form = new FormData(event.currentTarget);
              projectMutation.mutate({
                name: String(form.get("name") ?? "").trim(),
                sdkPlatform,
                allowedOrigins: originValidation.origins,
                retentionDays: Number(form.get("retentionDays") ?? 14),
                eventSampleRate: Number(form.get("eventSampleRate") ?? 1),
                apiSampleRate: Number(form.get("apiSampleRate") ?? 0.2),
                errorSampleRate: Number(form.get("errorSampleRate") ?? 1),
              });
            }}
          >
            <fieldset disabled={projectMutation.isPending} className="space-y-5">
              <FormField label="项目名称">
                <input name="name" required maxLength={120} placeholder="例如：商城 H5" />
              </FormField>
              <ProjectPlatformSelector
                value={sdkPlatform}
                onValueChange={setSDKPlatform}
                disabled={projectMutation.isPending}
                description="创建后提供对应平台的接入指引。"
              />
              <div>
                <label htmlFor="project-origins" className="block text-sm font-medium">
                  允许上报的站点
                </label>
                <textarea
                  id="project-origins"
                  ref={originsRef}
                  name="allowedOrigins"
                  required
                  rows={3}
                  className="textarea mt-2 w-full rounded-box font-mono"
                  value={originsValue}
                  onChange={(event) => setOriginsValue(event.target.value)}
                  onBlur={() => setShowOriginIssues(true)}
                  onInvalid={() => setShowOriginIssues(true)}
                  aria-invalid={originIssues.length > 0}
                  aria-describedby={`project-origins-hint${originIssues.length ? " project-origins-errors" : ""}`}
                  placeholder={"https://www.example.com\nhttp://localhost:4173"}
                />
                <p id="project-origins-hint" className="mt-2 text-xs text-base-content/70">
                  每行一个，包含协议和端口（如有），不含路径或结尾斜杠。
                </p>
                {originIssues.length ? (
                  <ul
                    id="project-origins-errors"
                    className="mt-2 space-y-2 text-sm"
                    aria-live="polite"
                  >
                    {originIssues.map((issue) => (
                      <li key={issue.line}>
                        <p className="text-error">
                          {issue.line ? `第 ${issue.line} 行：` : ""}
                          {issue.message}
                        </p>
                        {issue.suggestion ? (
                          <button
                            type="button"
                            className="btn btn-link mt-1 h-auto min-h-0 justify-start p-0 text-left font-normal whitespace-normal text-base-content underline-offset-4 break-all"
                            onClick={() => {
                              setOriginsValue((current) =>
                                current
                                  .split("\n")
                                  .map((line, index) =>
                                    index === issue.line - 1 ? issue.suggestion! : line,
                                  )
                                  .join("\n"),
                              );
                              originsRef.current?.focus();
                            }}
                          >
                            改为 {issue.suggestion}
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <details className="collapse collapse-arrow mt-5 border border-base-300">
                <summary className="collapse-title text-sm font-medium">
                  采样与保留设置 · 可选
                </summary>
                <div className="collapse-content">
                  <p className="text-sm text-base-content/70">
                    默认保留 14 天；事件与错误采样 100%，API 采样 20%。创建后可在数据管理中调整。
                  </p>
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
                </div>
              </details>
            </fieldset>
            {!canCreate && organization ? (
              <p role="status" className="alert alert-warning alert-soft mt-5 text-sm">
                只有组织 Owner 或 Admin 可以创建项目。
              </p>
            ) : null}
            {projectMutation.error ? (
              <p className="mt-5 text-sm text-error" role="alert">
                {projectMutation.error.message}
              </p>
            ) : null}
            <div className="mt-6 flex items-center justify-end gap-3 border-t border-base-300 pt-5">
              {projectMutation.isPending ? (
                <Button variant="ghost" disabled>
                  取消
                </Button>
              ) : (
                <Button asChild variant="ghost">
                  <Link to="/projects">取消</Link>
                </Button>
              )}
              <Button
                type="submit"
                disabled={!canCreate || projectMutation.isPending || organizationMutation.isPending}
              >
                {projectMutation.isPending ? "正在创建…" : "创建并接入"}
              </Button>
            </div>
          </form>
        </div>
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
    <label className="block text-sm font-medium text-base-content [&_input]:input [&_input]:mt-2 [&_input]:w-full [&_textarea]:textarea [&_textarea]:mt-2 [&_textarea]:w-full [&_textarea]:font-mono">
      <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
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
      className="mt-6 rounded-box border border-warning/40 bg-warning/10 p-6 text-base-content"
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
          <code className="mt-4 block overflow-x-auto rounded-field border border-warning/30 bg-base-100 px-3 py-2.5 font-mono text-sm whitespace-nowrap text-base-content">
            {dsn}
          </code>
          <pre className="mt-3 overflow-x-auto rounded-field border border-warning/30 bg-base-100 p-3 font-mono text-xs leading-5 text-base-content/85">
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
