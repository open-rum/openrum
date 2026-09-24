import { lazy, Suspense, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useBlocker } from "@tanstack/react-router";
import {
  CheckIcon,
  LayoutGridIcon,
  LoaderCircleIcon,
  PlusIcon,
  RotateCcwIcon,
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
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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
import { getDashboard, saveDashboard } from "@/lib/api/dashboard";
import { HTTPError, sessionQueryOptions } from "@/lib/auth/session";
import type { Project } from "@/lib/api/projects";
import { useFilters } from "@/lib/filters/useFilters";
import { useAnalysisContext } from "@/features/filters/AnalysisContextBar";
import { recordProductEvent } from "@/lib/telemetry/productEvents";
import {
  MAX_WIDGETS,
  defaultDashboard,
  type DashboardConfig,
  type DashboardResponse,
  type StoredWidget,
  type Widget,
} from "./model";
import { useDashboardQueries } from "./queries";
import { DashboardGrid } from "./DashboardGrid";
import { DashboardDensity } from "./DashboardDensity";

const ModuleEditor = lazy(() => import("./ModuleEditor"));

export default function ProjectDashboard({ project }: { project: Project }) {
  const session = useQuery(sessionQueryOptions());
  if (session.isPending) return <Skeleton className="h-80" />;
  if (!session.data)
    return (
      <AsyncError
        error={session.error}
        title="无法读取登录状态"
        remediation="请重新登录后再加载个人概览。"
        onRetry={() => void session.refetch()}
      />
    );
  return (
    <DashboardDensity>
      <PersonalDashboard
        key={`${session.data.userId}:${project.id}`}
        project={project}
        userId={session.data.userId}
      />
    </DashboardDensity>
  );
}

function PersonalDashboard({ project, userId }: { project: Project; userId: string }) {
  const client = useQueryClient();
  const context = useAnalysisContext();
  const { filters: pageFilters, updateFilters } = useFilters(project.id);
  const filters =
    context?.projectId === project.id
      ? { ...pageFilters, from: context.from, to: context.to, environment: context.environment }
      : pageFilters;
  const configKey = ["dashboard-config", userId, project.id] as const;
  const saved = useQuery({
    queryKey: configKey,
    queryFn: ({ signal }) => getDashboard(project.id, signal),
    staleTime: 30_000,
    retry: false,
  });
  const [defaults] = useState(defaultDashboard);
  const [draft, setDraft] = useState<{
    config: DashboardConfig;
    baseline: DashboardConfig;
    revision: number;
  } | null>(null);
  const [editor, setEditor] = useState<{ initial?: Widget } | null>(null);
  const [confirmation, setConfirmation] = useState<"cancel" | "reset" | "reload" | null>(null);
  const [notice, setNotice] = useState("");
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
  const save = useMutation({
    mutationFn: ({ config, revision }: { config: DashboardConfig; revision: number }) =>
      saveDashboard(project.id, config, revision),
    onSuccess: (response) => {
      client.setQueryData<DashboardResponse>(configKey, response);
      setDraft(null);
      setNotice("个人概览已保存");
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
        setNotice("已加载最新概览，可重新进入编辑模式。");
      }
    }
  }
  if (saved.isPending)
    return (
      <ConsolePage width="fluid" aria-label="正在加载数据大盘">
        <Skeleton className="h-20" />
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-40" />
          ))}
        </div>
        <Skeleton className="h-80" />
      </ConsolePage>
    );
  if (saved.isError && !saved.data)
    return (
      <ConsolePage width="fluid">
        <AsyncError
          error={saved.error}
          title="无法加载个人概览配置"
          remediation="请确认 API 已更新、数据库迁移已完成，然后重新加载。"
          onRetry={() => void saved.refetch()}
        />
      </ConsolePage>
    );

  return (
    <ConsolePage width="fluid" className="dashboard-page">
      <ConsolePageHeader
        title={
          !filters.environment
            ? "全部环境概览"
            : filters.environment === "production"
              ? "生产环境概览"
              : `${filters.environment} 环境概览`
        }
        description={
          editing
            ? "组合你关心的数据，按自己的方式查看项目。"
            : "你的个人概览，跟随当前时间与环境。"
        }
        actions={
          <>
            {!editing ? (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label="编辑概览"
                      disabled={!compatible}
                      onClick={startEditing}
                    >
                      <Settings2Icon />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>编辑概览</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : (
              <>
                <Button variant="ghost" disabled={busy} onClick={() => setConfirmation("reset")}>
                  <RotateCcwIcon data-icon="inline-start" />
                  恢复默认
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => (dirty ? setConfirmation("cancel") : cancelEditing())}
                >
                  取消
                </Button>
                <Button
                  disabled={!dirty || busy || editor !== null}
                  onClick={() => {
                    if (draft) save.mutate({ config: draft.config, revision: draft.revision });
                  }}
                >
                  {save.isPending ? (
                    <LoaderCircleIcon className="animate-spin" data-icon="inline-start" />
                  ) : (
                    <CheckIcon data-icon="inline-start" />
                  )}
                  保存概览
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
                。仅作用于概览指标和列表，事件模块使用自己的配置。
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
            <AlertTitle>此概览使用了暂不支持的配置版本</AlertTitle>
            <AlertDescription>请更新控制台后再编辑，已保存的配置不会被覆盖。</AlertDescription>
          </Alert>
        ) : null}
        {save.isError ? (
          <Alert variant="destructive">
            <AlertTitle>
              {save.error instanceof HTTPError && save.error.status === 409
                ? "概览已在其他设备更新"
                : "概览保存失败"}
            </AlertTitle>
            <AlertDescription>
              <span>
                {save.error instanceof HTTPError && save.error.status === 409
                  ? "当前草稿已保留。重新加载最新概览后，再进行编辑。"
                  : "当前草稿已保留，请检查连接后重新保存。"}
              </span>
              {save.error instanceof HTTPError && save.error.status === 409 ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => setConfirmation("reload")}
                >
                  重新加载最新概览
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
              <EmptyDescription>添加指标卡、趋势或事件分布，创建你的个人概览。</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button
                onClick={() => {
                  if (!editing) startEditing();
                  setEditor({});
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
                    ? "放弃草稿并加载最新概览？"
                    : "放弃本次概览修改？"}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {confirmation === "reset"
                  ? "草稿将替换为默认指标、趋势和列表。点击保存后才会更新你的个人概览。"
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
                    ? "加载最新概览"
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
              <AlertDialogDescription>当前概览草稿尚未保存。</AlertDialogDescription>
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
