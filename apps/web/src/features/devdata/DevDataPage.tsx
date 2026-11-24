import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DatabaseIcon, FlaskConicalIcon, PlayIcon } from "lucide-react";
import { ConsolePage, ConsolePageHeader } from "@/components/layout/ConsolePage";
import { AsyncError } from "@/components/ui/AsyncState";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useAnalysisContext } from "@/features/filters/AnalysisContextBar";
import {
  devDataWindows,
  generateDevData,
  getDevDataPresets,
  type DevDataResult,
  type DevDataScenario,
} from "@/lib/api/devData";
import { getSessionTimelinePage } from "@/lib/api/sessions";
import { listOrganizations, listProjects, type Project } from "@/lib/api/projects";
import { HTTPError } from "@/lib/auth/session";
import { projectIdFromPathname } from "@/lib/projects/currentProject";
import { projectEnvironments } from "@/lib/projects/environments";
import type { DevDataDialogRequest } from "./devDataDialog";
import {
  devDataDestination,
  devDataRangeError,
  type DevDataDestination,
} from "./devDataExperience";

const labels: Record<string, string> = {
  storefront: "综合电商旅程",
  "api-surface": "丰富 API 场景",
  "failing-release": "版本故障",
  "web-vitals": "性能指标",
  "error-burst": "集中错误",
  logs: "结构化日志",
  page_view: "页面浏览",
  api: "API",
  web_vital: "性能",
  error: "错误",
  custom: "自定义事件",
  log: "日志",
};

const descriptions: Record<string, string> = {
  storefront: "包含页面、日志、性能、API、错误和业务事件，适合体验完整产品。",
  "api-surface": "覆盖多种接口、状态码和耗时，包含浏览器与版本差异，适合验证 API 分析。",
  "failing-release": "模拟新版本支付故障，验证错误聚合、版本对比与告警。",
  "web-vitals": "生成良好、待优化和较差的性能样本，验证性能图表与评分。",
  "error-burst": "集中产生重复异常，验证错误趋势、指纹聚合和影响范围。",
  logs: "包含不同级别的日志、结构化属性和关联会话。",
};

function formatTime(value: Date) {
  return value.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function Choice({
  id,
  value,
  onChange,
  items,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  items: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

export function DevDataQuickEntry({
  projects,
  project,
  trigger,
  preset,
  request,
}: {
  projects: Project[];
  project?: Project;
  /** Replaces the floating button, e.g. a page-level button next to a title. */
  trigger?: ReactElement;
  /** Optional preset override; otherwise recommend a scenario for the source page. */
  preset?: string;
  /** An explicit request from a page; the global dialog survives that page unmounting. */
  request?: DevDataDialogRequest;
}) {
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState(false);
  const [sourcePath, setSourcePath] = useState(window.location.pathname);
  const [requestedProject, setRequestedProject] = useState<Project>();
  const [handledRequest, setHandledRequest] = useState<DevDataDialogRequest>();
  // Also handle a request that arrives before this lazy-loaded entry mounts.
  if (request && request !== handledRequest) {
    setHandledRequest(request);
    if (!busy) {
      setRequestedProject(request.project);
      setSelectedId(request.project.id);
      setSourcePath(window.location.pathname);
    }
    setOpen(true);
  }
  const availableProjects =
    requestedProject && !projects.some((item) => item.id === requestedProject.id)
      ? [requestedProject, ...projects]
      : projects;
  const selected =
    availableProjects.find((item) => item.id === selectedId) ??
    requestedProject ??
    project ??
    projects[0];
  const renderDialog = (form: ReactNode) => (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next && !busy) {
          setSourcePath(window.location.pathname);
          setRequestedProject(project);
          setSelectedId(project?.id ?? projects[0]?.id ?? "");
        }
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button
            variant="outline"
            size="icon-lg"
            className="fixed right-[max(1.5rem,env(safe-area-inset-right))] bottom-[max(1.5rem,env(safe-area-inset-bottom))] z-40 rounded-full shadow-lg"
            aria-label="造数据"
            title={busy ? "测试数据处理中 · 点击查看" : "添加测试数据（仅开发环境）"}
          >
            {busy ? (
              <span className="loading loading-spinner loading-sm" aria-hidden="true" />
            ) : (
              <FlaskConicalIcon aria-hidden="true" />
            )}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 border-b border-base-300 p-6 pr-12">
          <DialogTitle>
            添加测试数据 <Badge variant="outline">仅开发环境</Badge>
          </DialogTitle>
          <DialogDescription>为当前项目添加示例数据，体验图表和列表。</DialogDescription>
        </DialogHeader>
        {form ?? (
          <div className="p-6">
            <EmptyState
              icon={DatabaseIcon}
              title="尚未创建项目"
              description="先创建项目，再添加测试数据。"
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
  // Keep the job outside the dialog portal so closing it does not discard progress.
  return selected && selectedId ? (
    <DevDataForm
      key={`${selected.id}:${sourcePath}`}
      project={selected}
      initialPreset={preset ?? devDataDestination(sourcePath).preset}
      destination={devDataDestination(sourcePath)}
      onBusyChange={setBusy}
      inDialog
      renderContent={renderDialog}
      projectPicker={
        availableProjects.length > 1 ? (
          <Field>
            <FieldLabel htmlFor="dev-project">目标项目</FieldLabel>
            <Choice
              id="dev-project"
              value={selected.id}
              onChange={setSelectedId}
              disabled={busy}
              items={availableProjects.map((item) => ({
                value: item.id,
                label: `${item.name}${item.status !== "active" ? "（已停止）" : ""}`,
              }))}
            />
          </Field>
        ) : null
      }
    />
  ) : (
    renderDialog(null)
  );
}

export function DevDataPage() {
  const projectId = projectIdFromPathname(window.location.pathname);
  const organizations = useQuery({ queryKey: ["organizations"], queryFn: listOrganizations });
  const organization = organizations.data?.organizations[0];
  const projects = useQuery({
    queryKey: ["projects", organization?.id],
    queryFn: () => listProjects(organization!.id),
    enabled: Boolean(organization),
  });
  const project = projects.data?.projects.find((item) => item.id === projectId);
  return (
    <ConsolePage width="wide">
      <ConsolePageHeader
        title="添加测试数据"
        description="为当前项目添加示例数据，体验图表和列表。"
      />
      {organizations.error || projects.error ? (
        <AsyncError
          error={organizations.error ?? projects.error}
          title="项目加载失败"
          remediation="请刷新后重试。"
        />
      ) : project ? (
        <DevDataForm key={project.id} project={project} />
      ) : projects.isLoading || organizations.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <EmptyState icon={DatabaseIcon} title="找不到项目" description="请选择有权限访问的项目。" />
      )}
    </ConsolePage>
  );
}

export function DevDataForm({
  project,
  initialPreset = "storefront",
  onBusyChange,
  inDialog = false,
  projectPicker,
  destination = devDataDestination(window.location.pathname),
  renderContent = (content) => content,
}: {
  project: Project;
  initialPreset?: string;
  onBusyChange?: (busy: boolean) => void;
  inDialog?: boolean;
  projectPicker?: ReactNode;
  destination?: DevDataDestination;
  renderContent?: (content: ReactNode) => ReactNode;
}) {
  const context = useAnalysisContext();
  const queryClient = useQueryClient();
  const current = context?.projectId === project.id ? context : null;
  const [environment, setEnvironment] = useState(current?.environment || project.environment);
  const [windowValue, setWindowValue] = useState(current ? "current" : "60");
  const [preset, setPreset] = useState(initialPreset);
  const [sessions, setSessions] = useState(300);
  const [userIds, setUserIds] = useState("");
  const [signedIn, setSignedIn] = useState("0.45");
  const [advanced, setAdvanced] = useState(false);
  const [draft, setDraft] = useState("");
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const rangeError =
    windowValue === "current" && current ? devDataRangeError(current.from, current.to, now) : null;
  let jsonError: string | null = null;
  if (advanced) {
    try {
      const value = JSON.parse(draft);
      if (!value || typeof value !== "object" || Array.isArray(value))
        jsonError = "场景 JSON 必须是一个对象。";
    } catch {
      jsonError = "JSON 格式有误，请检查引号、逗号和括号。";
    }
  }
  const presets = useQuery({
    queryKey: ["dev-data-presets", project.id, preset],
    queryFn: () => getDevDataPresets(project.id, preset, 60),
    retry: false,
  });
  const generate = useMutation({
    mutationFn: () => {
      if (windowValue === "current" && current) {
        const error = devDataRangeError(current.from, current.to, Date.now());
        if (error) throw new Error(error);
      }
      const scenario = advanced ? (JSON.parse(draft) as DevDataScenario) : undefined;
      return generateDevData(project.id, {
        preset,
        sessions: advanced ? undefined : sessions,
        scenario,
        environment,
        users: advanced
          ? undefined
          : {
              ids: userIds
                .split(/[\s,，]+/)
                .map((id) => id.trim())
                .filter(Boolean),
              signedIn: Number(signedIn),
            },
        ...(windowValue === "current" && current
          ? { from: current.from.toISOString(), to: current.to.toISOString() }
          : { minutes: Number(windowValue) }),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        predicate: (query) =>
          query.queryKey.includes(project.id) && query.queryKey[0] !== "dev-data-presets",
      });
    },
  });
  const result = generate.data;
  const probe = useQuery({
    queryKey: ["dev-data-probe", result?.probeEventId],
    queryFn: async ({ signal }) => {
      try {
        const at = new Date(result!.probeAt!).getTime();
        return await getSessionTimelinePage(
          {
            projectId: project.id,
            sessionId: result!.probeSessionId!,
            from: new Date(at - 1000),
            to: new Date(at + 1000),
            limit: 1,
          },
          signal,
        );
      } catch (error) {
        if (error instanceof HTTPError && error.status === 404) return null;
        throw error;
      }
    },
    enabled: Boolean(result && result.accepted > 0 && result.probeSessionId && result.probeAt),
    retry: false,
    notifyOnChangeProps: "all",
    refetchInterval: (query) =>
      !query.state.data && !query.state.error && query.state.dataUpdateCount < 15 ? 2000 : false,
    refetchOnWindowFocus: false,
  });
  useEffect(() => {
    if (probe.data)
      void queryClient.invalidateQueries({
        predicate: (query) =>
          query.queryKey.includes(project.id) && query.queryKey[0] !== "dev-data-presets",
      });
  }, [probe.data, project.id, queryClient]);
  const attempts =
    queryClient.getQueryState(["dev-data-probe", result?.probeEventId])?.dataUpdateCount ?? 0;
  const probePending =
    Boolean(
      result &&
      result.accepted > 0 &&
      result.probeEventId &&
      result.probeSessionId &&
      result.probeAt,
    ) &&
    !probe.data &&
    !probe.error &&
    attempts < 15;
  const busy = generate.isPending || probePending;
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);
  const environments = projectEnvironments.map((item) => item.id);
  const blocked = project.status !== "active" || project.role === "viewer";

  const hasOutcome = Boolean(result) || generate.isPending;
  const problematic = Boolean(
    result &&
    (result.lastError ||
      result.rejected ||
      result.failed ||
      result.unsent ||
      result.accepted === 0),
  );
  const ready = Boolean(probe.data);
  const destinationSearch = result
    ? new URLSearchParams({ from: result.from, to: result.to, environment: result.environment })
    : null;
  return renderContent(
    <div className={inDialog ? "flex min-h-0 flex-1 flex-col" : "flex flex-col gap-5"}>
      <div className={inDialog ? "min-h-0 overflow-y-auto p-6" : ""}>
        {hasOutcome ? (
          <section className="flex flex-col gap-5" aria-label="生成结果" aria-live="polite">
            <ol className="steps w-full text-xs">
              <li className="step step-primary">生成并写入</li>
              <li className={`step ${result?.accepted ? "step-primary" : ""}`}>确认可查询</li>
              <li className={`step ${ready ? "step-primary" : ""}`}>查看数据</li>
            </ol>
            {generate.isPending ? (
              <div className="flex flex-col items-center gap-3 py-6 text-center" role="status">
                <span className="loading loading-spinner loading-md" aria-hidden="true" />
                <h3 className="font-semibold">正在生成并写入测试数据</h3>
                <p className="text-base-content/70">
                  您可以暂时关闭弹窗，稍后从右下角继续查看。请保持此页面打开。
                </p>
              </div>
            ) : result ? (
              <DevDataOutcome
                result={result}
                pending={probePending}
                queryable={ready}
                problem={problematic}
                onRetry={() => void probe.refetch()}
                canRetry={Boolean(result.probeSessionId && result.probeAt && result.accepted > 0)}
              />
            ) : null}
          </section>
        ) : (
          <fieldset disabled={generate.isPending} className="min-w-0">
            <FieldGroup>
              {projectPicker}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-base-content/70">
                <span>项目：{project.name}</span>
                <span>写入环境：{environment}</span>
              </div>
              <Field>
                <FieldLabel htmlFor="dev-preset">测试场景</FieldLabel>
                <Choice
                  id="dev-preset"
                  value={preset}
                  onChange={(value) => {
                    setPreset(value);
                    setAdvanced(false);
                  }}
                  items={(presets.data?.presets ?? []).map((item) => ({
                    value: item.id,
                    label: `${labels[item.id] ?? item.name}${item.id === destination.preset ? "（推荐）" : ""}`,
                  }))}
                />
                <FieldDescription>
                  {descriptions[preset] ??
                    presets.data?.presets.find((item) => item.id === preset)?.description}
                </FieldDescription>
              </Field>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="dev-sessions">数据量</FieldLabel>
                  <Choice
                    id="dev-sessions"
                    value={String(sessions)}
                    onChange={(value) => setSessions(Number(value))}
                    disabled={advanced}
                    items={[
                      { value: "100", label: "少量 · 100 个会话" },
                      { value: "300", label: "标准 · 300 个会话" },
                      { value: "1000", label: "丰富 · 1,000 个会话" },
                      ...(![100, 300, 1000].includes(sessions)
                        ? [{ value: String(sessions), label: `自定义 · ${sessions} 个会话` }]
                        : []),
                    ]}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="dev-window">时间范围</FieldLabel>
                  <Choice
                    id="dev-window"
                    value={windowValue}
                    onChange={setWindowValue}
                    items={[
                      ...(current ? [{ value: "current", label: "当前页面时间范围" }] : []),
                      ...devDataWindows.map((item) => ({
                        value: String(item.minutes),
                        label: item.label,
                      })),
                    ]}
                  />
                </Field>
              </div>
              {rangeError ? (
                <Alert variant="warning" className="flex flex-col items-start gap-2">
                  <AlertTitle>请选择可生成的时间范围</AlertTitle>
                  <AlertDescription>{rangeError}</AlertDescription>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    onClick={() => setWindowValue("60")}
                  >
                    使用最近 1 小时
                  </Button>
                </Alert>
              ) : windowValue === "current" && current ? (
                <p className="text-sm text-base-content/70">
                  {formatTime(current.from)} — {formatTime(current.to)}
                </p>
              ) : null}
              <details className="collapse collapse-arrow border border-base-300 rounded-box">
                <summary className="collapse-title min-h-0 py-3 font-medium">高级设置</summary>
                <div className="collapse-content">
                  <div className="flex flex-col gap-5 pt-2">
                    <div className="grid gap-5 sm:grid-cols-2">
                      <Field>
                        <FieldLabel htmlFor="dev-environment">写入环境</FieldLabel>
                        <Choice
                          id="dev-environment"
                          value={environment}
                          onChange={setEnvironment}
                          items={environments.map((value) => ({ value, label: value }))}
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="dev-custom-sessions">自定义会话数</FieldLabel>
                        <Input
                          id="dev-custom-sessions"
                          type="number"
                          min={1}
                          max={5000}
                          value={sessions}
                          disabled={advanced}
                          aria-invalid={
                            !Number.isInteger(sessions) || sessions < 1 || sessions > 5000
                          }
                          onChange={(event) => setSessions(Number(event.target.value))}
                        />
                        <FieldDescription>1–5,000 个会话，数量越大耗时越长。</FieldDescription>
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="dev-user-ids">业务用户 ID（可选）</FieldLabel>
                        <Textarea
                          id="dev-user-ids"
                          rows={2}
                          placeholder="用逗号或换行分隔，留空自动生成"
                          value={userIds}
                          disabled={advanced}
                          onChange={(event) => setUserIds(event.target.value)}
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="dev-signed-in">登录访客占比</FieldLabel>
                        <Choice
                          id="dev-signed-in"
                          value={signedIn}
                          onChange={setSignedIn}
                          disabled={advanced}
                          items={[
                            { value: "0", label: "全部匿名" },
                            { value: "0.2", label: "20%" },
                            { value: "0.45", label: "45%（推荐）" },
                            { value: "0.7", label: "70%" },
                            { value: "1", label: "全部登录" },
                          ]}
                        />
                      </Field>
                    </div>
                    <p className="text-sm text-base-content/70">
                      自动使用项目默认 DSN。测试数据会实际写入，仍受项目过滤规则与保留期限约束。
                    </p>
                    <Button
                      variant="outline"
                      type="button"
                      disabled={!presets.data}
                      onClick={() => {
                        if (!advanced && presets.data)
                          setDraft(JSON.stringify({ ...presets.data.scenario, sessions }, null, 2));
                        setAdvanced(!advanced);
                      }}
                    >
                      {advanced ? "使用表单配置" : "编辑场景 JSON"}
                    </Button>
                    {advanced ? (
                      <Field>
                        <FieldLabel htmlFor="dev-scenario">场景 JSON</FieldLabel>
                        <Textarea
                          id="dev-scenario"
                          rows={12}
                          value={draft}
                          aria-invalid={Boolean(jsonError)}
                          onChange={(event) => setDraft(event.target.value)}
                        />
                        <FieldDescription>
                          时间和环境以上方选择为准，其余配置使用 JSON。
                        </FieldDescription>
                        {jsonError ? (
                          <p role="alert" className="text-sm text-error">
                            {jsonError}
                          </p>
                        ) : null}
                      </Field>
                    ) : null}
                  </div>
                </div>
              </details>
              {blocked ? (
                <Alert variant="destructive">
                  <AlertTitle>当前不能添加测试数据</AlertTitle>
                  <AlertDescription>
                    {project.status !== "active"
                      ? "项目已停止，请先在项目设置启用。"
                      : "需要项目成员、管理员或所有者权限。"}
                  </AlertDescription>
                </Alert>
              ) : null}
              {presets.error ? (
                <AsyncError
                  error={presets.error}
                  title="场景加载失败"
                  remediation="请确认本地 API 已启用开发模式。"
                  onRetry={() => void presets.refetch()}
                />
              ) : null}
              {generate.error ? (
                <AsyncError
                  error={generate.error}
                  title="生成失败"
                  remediation={`${generate.error.message} 未自动重试，避免重复写入。`}
                />
              ) : null}
            </FieldGroup>
          </fieldset>
        )}
      </div>
      <div
        className={
          inDialog
            ? "flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-base-300 bg-base-100 px-6 py-4"
            : "flex flex-wrap items-center justify-between gap-3"
        }
      >
        {busy ? (
          <span className="text-sm text-base-content/70">可暂时关闭，稍后继续查看</span>
        ) : (
          <a
            className="link link-hover text-sm text-base-content/70"
            href={`/projects/${project.id}/onboarding`}
          >
            查看 SDK 接入指引
          </a>
        )}
        {hasOutcome ? (
          <div className="flex flex-wrap gap-2">
            {!busy ? (
              <Button variant="outline" onClick={() => generate.reset()}>
                返回配置
              </Button>
            ) : (
              <span className="text-sm text-base-content/70" role="status">
                {generate.isPending ? "正在写入…" : "正在确认…"}
              </span>
            )}
            {ready && result ? (
              <Button asChild>
                <a href={`/projects/${project.id}/${destination.page}?${destinationSearch}`}>
                  {destination.label}
                </a>
              </Button>
            ) : null}
          </div>
        ) : (
          <Button
            disabled={
              blocked ||
              busy ||
              !presets.data ||
              Boolean(rangeError) ||
              Boolean(jsonError) ||
              (!advanced && (!Number.isInteger(sessions) || sessions < 1 || sessions > 5000))
            }
            onClick={() => generate.mutate()}
          >
            <PlayIcon data-icon="inline-start" />
            添加测试数据
          </Button>
        )}
      </div>
    </div>,
  );
}

function DevDataOutcome({
  result,
  pending,
  queryable,
  problem,
  onRetry,
  canRetry,
}: {
  result: DevDataResult;
  pending: boolean;
  queryable: boolean;
  problem: boolean;
  onRetry: () => void;
  canRetry: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div role="status" className="text-center py-4">
        {pending ? (
          <span className="loading loading-spinner loading-md mb-3" aria-hidden="true" />
        ) : null}
        <h3 className="text-lg font-semibold">
          {problem
            ? "部分数据未能写入"
            : queryable
              ? "测试数据已可查看"
              : pending
                ? "已接收，正在确认数据可查询"
                : "暂未确认数据可查询"}
        </h3>
        <p className="mt-2 text-sm text-base-content/70">
          {queryable
            ? `已接收 ${result.accepted.toLocaleString()} 条事件，并确认会话样本可查询。`
            : result.accepted > 0
              ? `已接收 ${result.accepted.toLocaleString()} 条事件，写入后即可查看。`
              : "本次没有接收到测试数据。"}
        </p>
        <p className="mt-1 text-sm text-base-content/70">
          {result.environment} · {formatTime(new Date(result.from))} —{" "}
          {formatTime(new Date(result.to))}
        </p>
      </div>
      {problem || (!pending && !queryable) ? (
        <Alert variant="warning" className="flex flex-col items-start gap-2">
          <AlertTitle>{result.accepted === 0 ? "数据未写入" : "请检查本次生成结果"}</AlertTitle>
          <AlertDescription>
            {result.lastError ?? "请检查数据处理服务、项目过滤规则和保留期限，避免反复追加数据。"}
          </AlertDescription>
          {!pending && !queryable && canRetry ? (
            <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
              重新检查样本
            </Button>
          ) : null}
        </Alert>
      ) : null}
      <details
        className="collapse collapse-arrow rounded-box border border-base-300"
        open={problem || undefined}
      >
        <summary className="collapse-title min-h-0 py-3 font-medium">生成详情</summary>
        <div className="collapse-content">
          <div className="flex flex-col gap-3 pt-2">
            <dl className="grid grid-cols-3 gap-3 text-sm">
              {[
                ["生成事件", result.summary.events],
                ["已接收", result.accepted],
                ["拒收事件", result.rejected],
                ["失败批次", result.failed],
                ["未发送批次", result.unsent],
                ["耗时", `${(result.elapsedMs / 1000).toFixed(1)} 秒`],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-base-content/70">{label}</dt>
                  <dd className="mt-1 font-medium">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="text-sm text-base-content/70">
              {Object.entries(result.summary.byType)
                .map(([type, count]) => `${labels[type] ?? type} ${count}`)
                .join(" · ")}
            </p>
            <p className="text-sm text-base-content/70">
              样本可查询不代表所有事件均已入库或所有图表都有数据。
            </p>
          </div>
        </div>
      </details>
    </div>
  );
}
