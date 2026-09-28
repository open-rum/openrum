import { lazy, Suspense, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useBlocker, useNavigate } from "@tanstack/react-router";
import {
  CheckIcon,
  LayoutGridIcon,
  LoaderCircleIcon,
  PlusIcon,
  RotateCcwIcon,
  PencilIcon,
  Settings2Icon,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ConsolePage,
  ConsolePageContent,
  ConsolePageHeader,
} from "@/components/layout/ConsolePage";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { AsyncError } from "@/components/ui/AsyncState";
import {
  createDashboard,
  getNamedDashboard,
  listDashboards,
  MAX_DASHBOARDS,
  readLastDashboard,
  rememberLastDashboard,
  saveDashboardConfig,
  type DashboardSummary,
  type NamedDashboard,
} from "@/lib/api/dashboards";
import { HTTPError, sessionQueryOptions } from "@/lib/auth/session";
import type { Project } from "@/lib/api/projects";
import { useFilters } from "@/lib/filters/useFilters";
import { useAnalysisContext } from "@/features/filters/AnalysisContextBar";
import { recordProductEvent } from "@/lib/telemetry/productEvents";
import { MAX_WIDGETS, type DashboardConfig, type StoredWidget, type Widget } from "./model";
import {
  BUILT_IN_DASHBOARD_ID,
  BUILT_IN_DASHBOARD_NAME,
  PERSONAL_DASHBOARD_NAME,
  defaultDashboard,
  isBuiltInDashboard,
  setPendingNotice,
  takePendingNotice,
  uniqueDashboardName,
} from "./builtIn";
import { DashboardSwitcher } from "./DashboardSwitcher";
import { useDashboardQueries } from "./queries";
import { DashboardGrid } from "./DashboardGrid";
import { DashboardDensity } from "./DashboardDensity";

const ModuleEditor = lazy(() => import("./ModuleEditor"));

export default function ProjectDashboard({
  project,
  dashboardId,
}: {
  project: Project;
  dashboardId?: string;
}) {
  const session = useQuery(sessionQueryOptions());
  if (session.isPending) return <Skeleton className="h-80" />;
  if (!session.data)
    return (
      <AsyncError
        error={session.error}
        title="无法读取登录状态"
        remediation="请重新登录后再加载仪表盘。"
        onRetry={() => void session.refetch()}
      />
    );
  return (
    <DashboardDensity>
      <DashboardResolver
        key={`${session.data.userId}:${project.id}`}
        project={project}
        userId={session.data.userId}
        dashboardId={dashboardId}
      />
    </DashboardDensity>
  );
}

function DashboardSkeleton() {
  return (
    <ConsolePage width="fluid" aria-label="正在加载仪表盘">
      <Skeleton className="h-20" />
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-40" />
        ))}
      </div>
      <Skeleton className="h-80" />
    </ConsolePage>
  );
}

/**
 * Picks the dashboard to show: the one in the address, else the one this device last
 * opened, else the first personal one, else the built-in default. The default is always
 * available and never stored; saving a change to it creates a personal dashboard. The
 * bare overview address therefore keeps working, and never redirects.
 */
function DashboardResolver({
  project,
  userId,
  dashboardId,
}: {
  project: Project;
  userId: string;
  dashboardId?: string;
}) {
  const navigate = useNavigate();
  const list = useQuery({
    queryKey: ["dashboards", userId, project.id],
    queryFn: ({ signal }) => listDashboards(project.id, signal),
    staleTime: 30_000,
    retry: false,
  });
  if (list.isPending) return <DashboardSkeleton />;
  if (list.isError && !list.data)
    return (
      <ConsolePage width="fluid">
        <AsyncError
          error={list.error}
          title="无法加载仪表盘列表"
          remediation="请确认 API 已更新、数据库迁移已完成，然后重新加载。"
          onRetry={() => void list.refetch()}
        />
      </ConsolePage>
    );
  const dashboards = list.data;
  const lastUsed = readLastDashboard(userId, project.id);
  const known = (id: string | undefined) =>
    isBuiltInDashboard(id) || dashboards.some((dashboard) => dashboard.id === id);
  const activeId =
    dashboardId ??
    (lastUsed && known(lastUsed) ? lastUsed : undefined) ??
    dashboards[0]?.id ??
    BUILT_IN_DASHBOARD_ID;
  const onNavigate = (id: string | undefined, replace = false) =>
    void navigate(
      id
        ? {
            to: "/projects/$projectId/overview/$dashboardId",
            params: { projectId: project.id, dashboardId: id },
            search: (previous) => previous,
            replace,
          }
        : {
            to: "/projects/$projectId/overview",
            params: { projectId: project.id },
            search: (previous) => previous,
            replace,
          },
    );
  return (
    <PersonalDashboard
      key={activeId}
      project={project}
      userId={userId}
      activeId={activeId}
      dashboards={dashboards}
      onNavigate={onNavigate}
    />
  );
}

function PersonalDashboard({
  project,
  userId,
  activeId,
  dashboards,
  onNavigate,
}: {
  project: Project;
  userId: string;
  activeId: string;
  dashboards: DashboardSummary[];
  onNavigate: (dashboardId: string | undefined, replace?: boolean) => void;
}) {
  const client = useQueryClient();
  const builtIn = isBuiltInDashboard(activeId);
  const context = useAnalysisContext();
  const { filters: pageFilters, updateFilters } = useFilters(project.id);
  const filters =
    context?.projectId === project.id
      ? { ...pageFilters, from: context.from, to: context.to, environment: context.environment }
      : pageFilters;
  const dashboardKey = ["dashboard", userId, project.id, activeId] as const;
  const named = useQuery({
    queryKey: dashboardKey,
    queryFn: ({ signal }) => getNamedDashboard(project.id, activeId, signal),
    enabled: !builtIn,
    staleTime: 30_000,
    retry: false,
  });
  // The built-in default has no stored copy: it is the code-defined layout at revision zero.
  const saved = !builtIn
    ? {
        data: named.data ? { config: named.data.config, revision: named.data.revision } : undefined,
        isPending: named.isPending,
        isError: named.isError,
        error: named.error,
        refetch: named.refetch,
      }
    : {
        data: { config: null, revision: 0 },
        isPending: false,
        isError: false,
        error: null,
        refetch: async () => ({ data: { config: null, revision: 0 }, isError: false }),
      };
  const activeName = builtIn ? BUILT_IN_DASHBOARD_NAME : (named.data?.name ?? "");
  useEffect(() => {
    if (builtIn || named.data) rememberLastDashboard(userId, project.id, activeId);
  }, [activeId, builtIn, named.data, project.id, userId]);
  const full = dashboards.length >= MAX_DASHBOARDS;
  const [defaults] = useState(defaultDashboard);
  const [draft, setDraft] = useState<{
    config: DashboardConfig;
    baseline: DashboardConfig;
    revision: number;
  } | null>(null);
  const [editor, setEditor] = useState<{ initial?: Widget } | null>(null);
  const [confirmation, setConfirmation] = useState<"cancel" | "reset" | "reload" | null>(null);
  const [notice, setNotice] = useState(takePendingNotice);
  const [reloading, setReloading] = useState(false);
  const config = draft?.config ?? saved.data?.config ?? defaults;
  const editing = draft !== null;
  const dirty = draft !== null && JSON.stringify(draft.config) !== JSON.stringify(draft.baseline);
  const compatible =
    config.schemaVersion === 1 &&
    config.widgets.length <= MAX_WIDGETS &&
    new Set(config.widgets.map((w) => w.id)).size === config.widgets.length;
  const queries = useDashboardQueries(
    saved.data && compatible ? config.widgets : [],
    filters,
    userId,
  );
  const blocker = useBlocker({
    shouldBlockFn: ({ current, next }) => dirty && current.pathname !== next.pathname,
    enableBeforeUnload: dirty,
    withResolver: true,
  });
  // Saving the built-in default never changes it: the edits become a new personal dashboard.
  const save = useMutation({
    mutationFn: ({ config, revision }: { config: DashboardConfig; revision: number }) =>
      builtIn
        ? createDashboard(
            project.id,
            uniqueDashboardName(PERSONAL_DASHBOARD_NAME, dashboards),
            config,
          )
        : saveDashboardConfig(project.id, activeId, config, revision),
    onSuccess: (response: NamedDashboard) => {
      client.setQueryData(["dashboard", userId, project.id, response.id], response);
      void client.invalidateQueries({ queryKey: ["dashboards", userId, project.id] });
      setDraft(null);
      if (builtIn) {
        setPendingNotice(`已保存为「${response.name}」，默认仪表盘保持不变。`);
        onNavigate(response.id, true);
      } else {
        setNotice("仪表盘已保存");
      }
    },
  });
  const busy = save.isPending || reloading;
  useEffect(() => {
    recordProductEvent("overview_viewed", project.id);
  }, [project.id]);

  function changeWidgets(widgets: StoredWidget[]) {
    if (busy || !saved.data || !compatible || widgets.length > MAX_WIDGETS) return;
    if (!draft) {
      save.reset();
      setNotice("");
    }
    const baseline = saved.data.config ?? defaults;
    const revision = saved.data.revision;
    setDraft((current) => ({
      baseline: current?.baseline ?? baseline,
      revision: current?.revision ?? revision,
      config: { ...(current?.config ?? baseline), widgets },
    }));
  }
  // Adding from outside edit mode starts a draft first, exactly like the empty state does.
  function addModule() {
    if (!editing) startEditing();
    setEditor({});
  }
  function startEditing() {
    if (!saved.data || !compatible) return;
    save.reset();
    setNotice("");
    const baseline = saved.data.config ?? defaults;
    setDraft({ config: structuredClone(baseline), baseline, revision: saved.data.revision });
  }
  function cancelEditing() {
    setDraft(null);
    setEditor(null);
    save.reset();
    setConfirmation(null);
  }
  async function confirmAction() {
    if (confirmation === "cancel") cancelEditing();
    if (confirmation === "reset") {
      changeWidgets(defaultDashboard().widgets);
      setConfirmation(null);
    }
    if (confirmation === "reload") {
      setReloading(true);
      const result = await saved.refetch();
      setReloading(false);
      if (result.data && !result.isError) {
        cancelEditing();
        setNotice("已加载最新仪表盘，可重新进入编辑模式。");
      }
    }
  }
  if (saved.isPending) return <DashboardSkeleton />;
  if (saved.isError && !saved.data) {
    const gone = saved.error instanceof HTTPError && saved.error.status === 404;
    return (
      <ConsolePage width="fluid">
        {gone ? (
          <Empty className="min-h-80 border border-dashed">
            <EmptyHeader>
              <EmptyTitle>这个仪表盘已不存在</EmptyTitle>
              <EmptyDescription>
                它可能已在其他设备上删除。你的其他仪表盘不受影响。
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={() => onNavigate(undefined, true)}>打开其他仪表盘</Button>
            </EmptyContent>
          </Empty>
        ) : (
          <AsyncError
            error={saved.error}
            title="无法加载仪表盘配置"
            remediation="请确认 API 已更新、数据库迁移已完成，然后重新加载。"
            onRetry={() => void saved.refetch()}
          />
        )}
      </ConsolePage>
    );
  }

  return (
    <ConsolePage width="fluid" className="dashboard-page">
      <ConsolePageHeader
        title={
          <DashboardSwitcher
            projectId={project.id}
            userId={userId}
            dashboards={dashboards}
            activeId={activeId}
            activeName={activeName}
            dirty={dirty}
            currentConfig={config}
            onNavigate={onNavigate}
          />
        }
        description={`${
          !filters.environment
            ? "全部环境"
            : filters.environment === "production"
              ? "生产环境"
              : `${filters.environment} 环境`
        } · ${
          builtIn
            ? "内置默认仪表盘，跟随当前时间与环境。修改后会另存为你的个人仪表盘。"
            : editing
              ? "组合你关心的数据，按自己的方式查看项目。"
              : "你的个人仪表盘，跟随当前时间与环境。"
        }`}
        actions={
          <>
            {!editing ? (
              // Hovering the gear reveals both actions. They stay in the DOM and focusable,
              // so tabbing to them reveals them too; touch and narrow screens show them always.
              <div className="dashboard-page-actions" role="group" aria-label="仪表盘操作">
                <div className="dashboard-page-actions-reveal">
                  <Button variant="outline" disabled={!compatible} onClick={startEditing}>
                    <PencilIcon data-icon="inline-start" />
                    编辑
                  </Button>
                  <Button
                    variant="outline"
                    disabled={!compatible || config.widgets.length >= MAX_WIDGETS}
                    onClick={addModule}
                  >
                    <PlusIcon data-icon="inline-start" />
                    添加模块
                  </Button>
                </div>
                <span
                  className={`dashboard-page-actions-trigger ${buttonVariants({ variant: "outline", size: "icon" })}`}
                  aria-hidden="true"
                >
                  <Settings2Icon />
                </span>
              </div>
            ) : (
              <>
                {!builtIn ? (
                  <Button variant="ghost" disabled={busy} onClick={() => setConfirmation("reset")}>
                    <RotateCcwIcon data-icon="inline-start" />
                    恢复默认
                  </Button>
                ) : null}
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => (dirty ? setConfirmation("cancel") : cancelEditing())}
                >
                  取消
                </Button>
                <Button
                  disabled={!dirty || busy || editor !== null || (builtIn && full)}
                  onClick={() => {
                    if (draft) save.mutate({ config: draft.config, revision: draft.revision });
                  }}
                >
                  {save.isPending ? (
                    <LoaderCircleIcon className="animate-spin" data-icon="inline-start" />
                  ) : (
                    <CheckIcon data-icon="inline-start" />
                  )}
                  {builtIn ? "另存为我的仪表盘" : "保存"}
                </Button>
              </>
            )}
          </>
        }
      />
      <ConsolePageContent className="grid gap-6">
        {notice ? (
          <p className="text-sm text-muted-foreground" role="status">
            {notice}
          </p>
        ) : null}
        {filters.release || filters.route ? (
          <Alert>
            <AlertTitle>链接筛选正在生效</AlertTitle>
            <AlertDescription>
              <span>
                版本 {filters.release || "全部"} · 路由 {filters.route || "全部"}
                。作用于经典概览与指标目录模块；事件模块和业务数值模块使用自己的配置。
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => updateFilters({ release: undefined, route: undefined }, "replace")}
              >
                清除链接筛选
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        {!compatible ? (
          <Alert>
            <AlertTitle>此仪表盘使用了暂不支持的配置版本</AlertTitle>
            <AlertDescription>请更新控制台后再编辑，已保存的配置不会被覆盖。</AlertDescription>
          </Alert>
        ) : null}
        {save.isError ? (
          <Alert variant="destructive">
            <AlertTitle>
              {save.error instanceof HTTPError && save.error.status === 409
                ? "仪表盘已在其他设备更新"
                : "仪表盘保存失败"}
            </AlertTitle>
            <AlertDescription>
              <span>
                {save.error instanceof HTTPError && save.error.status === 409
                  ? "当前草稿已保留。重新加载最新仪表盘后，再进行编辑。"
                  : "当前草稿已保留，请检查连接后重新保存。"}
              </span>
              {save.error instanceof HTTPError && save.error.status === 409 ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => setConfirmation("reload")}
                >
                  重新加载最新仪表盘
                </Button>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}
        {editing ? (
          <div className="dashboard-edit-toolbar">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">编辑模式</Badge>
              <span className="text-sm text-muted-foreground">
                {config.widgets.length} / {MAX_WIDGETS} 个模块 · 拖动手柄调整顺序
              </span>
              {dirty ? <Badge variant="outline">未保存</Badge> : null}
              {builtIn ? (
                <span className="text-sm text-muted-foreground">
                  {full
                    ? `你已有 ${MAX_DASHBOARDS} 个仪表盘，删除一个后才能另存。`
                    : "默认仪表盘不会被修改，保存后另存为你的个人仪表盘。"}
                </span>
              ) : null}
            </div>
            <Button
              variant="outline"
              disabled={busy || config.widgets.length >= MAX_WIDGETS}
              onClick={() => setEditor({})}
            >
              <PlusIcon data-icon="inline-start" />
              添加模块
            </Button>
          </div>
        ) : null}
        {compatible ? (
          <DashboardGrid
            widgets={config.widgets}
            queries={queries}
            filters={filters}
            editing={editing}
            disabled={busy}
            onChange={changeWidgets}
            onConfigure={(initial) => setEditor({ initial })}
          />
        ) : null}
        {compatible && !config.widgets.length ? (
          <Empty className="min-h-80 border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <LayoutGridIcon />
              </EmptyMedia>
              <EmptyTitle>从一个模块开始</EmptyTitle>
              <EmptyDescription>添加指标卡、趋势或事件分布，组合你的仪表盘。</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button
                onClick={() => {
                  addModule();
                }}
              >
                <PlusIcon data-icon="inline-start" />
                添加模块
              </Button>
            </EmptyContent>
          </Empty>
        ) : null}
        {!editing ? (
          <div className="flex justify-end">
            <Button variant="link" size="sm" asChild>
              <Link to="/projects/$projectId/onboarding" params={{ projectId: project.id }}>
                没有数据？检查接入状态
              </Link>
            </Button>
          </div>
        ) : null}
        {editor ? (
          <Suspense
            fallback={
              <p role="status" className="text-sm text-muted-foreground">
                正在打开模块配置…
              </p>
            }
          >
            <ModuleEditor
              key={editor.initial?.id ?? "new"}
              initial={editor.initial}
              filters={filters}
              userId={userId}
              onClose={() => setEditor(null)}
              onApply={(widget) => {
                changeWidgets(
                  editor.initial
                    ? config.widgets.map((current) => (current.id === widget.id ? widget : current))
                    : [...config.widgets, widget],
                );
                setEditor(null);
              }}
            />
          </Suspense>
        ) : null}
        <AlertDialog
          open={confirmation !== null}
          onOpenChange={(open) => {
            if (!open && !reloading) setConfirmation(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {confirmation === "reset"
                  ? "恢复默认模块布局？"
                  : confirmation === "reload"
                    ? "放弃草稿并加载最新仪表盘？"
                    : "放弃本次修改？"}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {confirmation === "reset"
                  ? "草稿将替换为默认仪表盘的模块。点击保存后才会更新这个仪表盘。"
                  : "尚未保存的布局和模块配置将被丢弃。"}
              </AlertDialogDescription>
            </AlertDialogHeader>
            {reloading ? <p role="status">正在加载…</p> : null}
            {saved.isError && confirmation === "reload" ? (
              <p role="alert" className="text-sm text-destructive">
                加载失败，草稿仍保留，请重试。
              </p>
            ) : null}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={reloading}>继续编辑</AlertDialogCancel>
              <AlertDialogAction
                disabled={reloading}
                onClick={(event) => {
                  event.preventDefault();
                  void confirmAction();
                }}
              >
                {confirmation === "reset"
                  ? "恢复默认"
                  : confirmation === "reload"
                    ? "加载最新仪表盘"
                    : "放弃修改"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <AlertDialog
          open={blocker.status === "blocked"}
          onOpenChange={(open) => {
            if (!open && blocker.status === "blocked") blocker.reset();
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>离开并放弃未保存的修改？</AlertDialogTitle>
              <AlertDialogDescription>当前仪表盘草稿尚未保存。</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => blocker.reset?.()}>继续编辑</AlertDialogCancel>
              <AlertDialogAction onClick={() => blocker.proceed?.()}>离开页面</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </ConsolePageContent>
    </ConsolePage>
  );
}
