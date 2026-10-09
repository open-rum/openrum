import { useEffect, useState } from "react";
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
  storefront:
    "一次生成全部数据：浏览、搜索、购买、账户与客服旅程，含页面、五项性能指标、API、错误、日志、点击与业务事件；访客会回访、部分登录，带访问来源、昼夜节奏、漏斗流失和一次支付故障。",
  "api-surface": "覆盖多种接口、状态码和耗时，包含浏览器与版本差异，适合验证 API 分析。",
  "failing-release": "模拟新版本支付故障，验证错误聚合、版本对比与告警。",
  "web-vitals": "生成良好、待优化和较差的性能样本，验证性能图表与评分。",
  "error-burst": "集中产生重复异常，验证错误趋势、指纹聚合和影响范围。",
  logs: "生成六种日志级别、支付排查属性，以及会话、Trace、设备和国家上下文。",
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
}: {
  projects: Project[];
  project?: Project;
}) {
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState(false);
  const selected = projects.find((item) => item.id === selectedId) ?? project ?? projects[0];
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        if (next) setSelectedId(project?.id ?? projects[0]?.id ?? "");
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="icon-lg"
          className="fixed right-[max(1.5rem,env(safe-area-inset-right))] bottom-[max(1.5rem,env(safe-area-inset-bottom))] z-40 rounded-full shadow-lg"
          aria-label="造数据"
          title="本地开发 · 快速造数据"
        >
          <FlaskConicalIcon aria-hidden="true" />
        </Button>
      </DialogTrigger>
      <DialogContent
        className="sm:max-w-2xl max-h-[90dvh] overflow-y-auto"
        showCloseButton={!busy}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            快速造数据 <Badge variant="outline">仅开发环境</Badge>
          </DialogTitle>
          <DialogDescription>
            无需复制 DSN。按项目、环境和时间投递真实管道，完成后检查样本是否入库。
          </DialogDescription>
        </DialogHeader>
        {selected ? (
          <>
            <Field>
              <FieldLabel htmlFor="dev-project">目标项目</FieldLabel>
              <Choice
                id="dev-project"
                value={selected.id}
                onChange={setSelectedId}
                disabled={busy}
                items={projects.map((item) => ({
                  value: item.id,
                  label: `${item.name}${item.status !== "active" ? "（已停止）" : ""}`,
                }))}
              />
            </Field>
            <DevDataForm key={selected.id} project={selected} onBusyChange={setBusy} />
          </>
        ) : (
          <EmptyState
            icon={DatabaseIcon}
            title="尚未创建项目"
            description="先创建项目，再生成测试数据。"
          />
        )}
      </DialogContent>
    </Dialog>
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
        title="开发数据生成器"
        description="右下角的造数据悬浮按钮可在任何控制台页面打开同一工具。"
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
  onBusyChange,
}: {
  project: Project;
  onBusyChange?: (busy: boolean) => void;
}) {
  const context = useAnalysisContext();
  const queryClient = useQueryClient();
  const current = context?.projectId === project.id ? context : null;
  const [environment, setEnvironment] = useState(current?.environment || project.environment);
  const [windowValue, setWindowValue] = useState(current ? "current" : "60");
  const [preset, setPreset] = useState("storefront");
  const [sessions, setSessions] = useState(300);
  const [userIds, setUserIds] = useState("");
  const [signedIn, setSignedIn] = useState("0.45");
  const [advanced, setAdvanced] = useState(false);
  const [draft, setDraft] = useState("");
  const presets = useQuery({
    queryKey: ["dev-data-presets", project.id, preset],
    queryFn: () => getDevDataPresets(project.id, preset, 60),
    retry: false,
  });
  const generate = useMutation({
    mutationFn: () => {
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
  useEffect(() => {
    onBusyChange?.(generate.isPending);
  }, [generate.isPending, onBusyChange]);
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
    enabled: Boolean(result?.probeSessionId && result?.probeAt),
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
    Boolean(result?.probeEventId) && !probe.data && !probe.error && attempts < 15;
  const environments = projectEnvironments.map((item) => item.id);
  const blocked = project.status !== "active" || project.role === "viewer";

  return (
    <div className="flex flex-col gap-5">
      <fieldset disabled={generate.isPending} className="min-w-0">
        <FieldGroup>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="dev-environment">写入环境</FieldLabel>
              <Choice
                id="dev-environment"
                value={environment}
                onChange={setEnvironment}
                items={environments.map((value) => ({ value, label: value }))}
              />
              <FieldDescription>
                “全部环境”不是写入环境，未指定时使用项目默认环境。
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="dev-window">数据时间</FieldLabel>
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
              <FieldDescription>
                {windowValue === "current" && current
                  ? `${formatTime(current.from)} — ${formatTime(current.to)}`
                  : "以提交时刻为结束时间；可在结果中一键切换到生成范围。"}
                <span className="block">历史数据仍按保留策略到期清除，过老范围可能无法查询。</span>
              </FieldDescription>
            </Field>
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
                  label: labels[item.id] ?? item.name,
                }))}
              />
              <FieldDescription>
                {descriptions[preset] ??
                  presets.data?.presets.find((item) => item.id === preset)?.description}
              </FieldDescription>
            </Field>
            <Field data-invalid={!Number.isInteger(sessions) || sessions < 1 || sessions > 5000}>
              <FieldLabel htmlFor="dev-sessions">会话数量</FieldLabel>
              <Input
                id="dev-sessions"
                type="number"
                min={1}
                max={5000}
                value={sessions}
                disabled={advanced}
                onChange={(event) => setSessions(Number(event.target.value))}
              />
              <FieldDescription>
                建议 300 条看趋势，1,000 条以上更接近真实，上限 5,000。数量越大耗时越长。
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="dev-user-ids">业务用户 ID（可选）</FieldLabel>
              <Textarea
                id="dev-user-ids"
                rows={2}
                placeholder="每行或用逗号分隔，例如 alice、vip-001；留空自动生成 cust_10001 起的 ID"
                value={userIds}
                disabled={advanced}
                onChange={(event) => setUserIds(event.target.value)}
              />
              <FieldDescription>
                登录访客会固定使用其中一个 ID，可在会话、错误和日志中按 user.id 查找。SDK
                目前只上报用户 ID，不支持用户名。
              </FieldDescription>
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
              <FieldDescription>访客会跨会话回访，所以 UV 少于会话数。</FieldDescription>
            </Field>
          </div>
          <Alert>
            <AlertTitle>使用当前项目的默认 DSN</AlertTitle>
            <AlertDescription>
              本地来源会模拟为 https://shop.example.com，避免被 localhost
              过滤规则丢弃。其他项目过滤规则、限流和存储保护仍然生效。
            </AlertDescription>
          </Alert>
          <Button
            variant="outline"
            type="button"
            disabled={!presets.data}
            onClick={() => {
              if (!advanced && presets.data)
                setDraft(JSON.stringify(presets.data.scenario, null, 2));
              setAdvanced(!advanced);
            }}
          >
            {advanced ? "收起高级场景" : "高级：编辑场景 JSON"}
          </Button>
          {advanced ? (
            <Field>
              <FieldLabel htmlFor="dev-scenario">场景 JSON</FieldLabel>
              <Textarea
                id="dev-scenario"
                rows={12}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
              />
              <FieldDescription>
                可调整 API、错误、性能、日志和旅程；会话数取
                JSON，时间与环境始终以上方选择为准。历史数据仍受保留期限影响。
              </FieldDescription>
            </Field>
          ) : null}
        </FieldGroup>
      </fieldset>
      {blocked ? (
        <Alert variant="destructive">
          <AlertTitle>当前不能造数据</AlertTitle>
          <AlertDescription>
            {project.status !== "active"
              ? "项目已停止，请先在项目设置启用。"
              : "需要项目成员、管理员或所有者权限。"}
          </AlertDescription>
        </Alert>
      ) : null}
      <Button
        disabled={
          blocked ||
          generate.isPending ||
          !presets.data ||
          (!advanced && (!Number.isInteger(sessions) || sessions < 1 || sessions > 5000))
        }
        onClick={() => generate.mutate()}
      >
        <PlayIcon data-icon="inline-start" />
        {generate.isPending ? "正在生成并投递，请勿重复提交…" : "生成测试数据"}
      </Button>
      {presets.error ? (
        <AsyncError
          error={presets.error}
          title="场景加载失败"
          remediation="仅 APP_ENV=development 的本地 API 支持造数据。"
          onRetry={() => void presets.refetch()}
        />
      ) : null}
      {generate.error ? (
        <AsyncError
          error={generate.error}
          title="生成失败"
          remediation={`${generate.error.message} 没有自动重试，以免重复写入。`}
        />
      ) : null}
      {result ? (
        <DevDataOutcome
          result={result}
          pending={probePending}
          queryable={Boolean(probe.data)}
          onRefresh={() => {
            void probe.refetch();
            void queryClient.invalidateQueries({
              predicate: (query) => query.queryKey.includes(project.id),
            });
          }}
          projectId={project.id}
        />
      ) : null}
    </div>
  );
}

function DevDataOutcome({
  result,
  pending,
  queryable,
  onRefresh,
  projectId,
}: {
  result: DevDataResult;
  pending: boolean;
  queryable: boolean;
  onRefresh: () => void;
  projectId: string;
}) {
  const search = new URLSearchParams({
    from: result.from,
    to: result.to,
    environment: result.environment,
  });
  return (
    <section className="flex flex-col gap-3" aria-label="生成结果" aria-live="polite">
      <Alert variant={result.lastError || result.accepted === 0 ? "destructive" : "default"}>
        <AlertTitle>
          {queryable
            ? "已确认样本入库，页面数据已刷新"
            : pending
              ? "Ingest 已接收，正在检查入库…"
              : "请检查投递结果"}
        </AlertTitle>
        <AlertDescription>
          {result.lastError ?? (queryable ? "本次生成的会话样本已可查询。" : result.message)}
          {!queryable && !pending && result.accepted > 0
            ? " 尚未确认样本可查询：请检查 Consumer、项目入站过滤和数据保留期限，不要反复追加数据。"
            : null}
          {queryable ? " 样本检查不代表每条事件均已入库或每项仪表盘指标都有数据。" : null}
        </AlertDescription>
      </Alert>
      <div className="flex flex-wrap gap-2">
        <Badge variant="outline">生成 {result.summary.events} 条</Badge>
        <Badge variant="outline">接收 {result.accepted}</Badge>
        <Badge variant="outline">拒收 {result.rejected}</Badge>
        <Badge variant="outline">失败 {result.failed} 批</Badge>
        <Badge variant="outline">未发送 {result.unsent} 批</Badge>
        <Badge variant="outline">{(result.elapsedMs / 1000).toFixed(1)} 秒</Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        {Object.entries(result.summary.byType)
          .map(([type, count]) => `${labels[type] ?? type} ${count}`)
          .join(" · ")}
      </p>
      <p className="text-sm text-muted-foreground">
        {result.environment} · {formatTime(new Date(result.from))} —{" "}
        {formatTime(new Date(result.to))}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline">
          <a href={`/projects/${projectId}/overview?${search}`}>按生成范围查看仪表盘</a>
        </Button>
        <Button variant="ghost" disabled={!result.probeEventId} onClick={onRefresh}>
          检查入库并刷新
        </Button>
      </div>
    </section>
  );
}
