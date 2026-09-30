import { useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  CopyIcon,
  ListOrderedIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  createDashboard,
  deleteDashboard,
  duplicateDashboard,
  MAX_DASHBOARDS,
  renameDashboard,
  reorderDashboards,
  type DashboardSummary,
  type NamedDashboard,
} from "@/lib/api/dashboards";
import { HTTPError } from "@/lib/auth/session";
import {
  BUILT_IN_DASHBOARD_ID,
  BUILT_IN_DASHBOARD_NAME,
  isBuiltInDashboard,
  uniqueDashboardName,
} from "./builtIn";
import type { DashboardConfig } from "./model";
import { useMetricCatalog } from "./queries";
import { availableTemplates } from "./templates";

type Dialogs = "create" | "rename" | "delete" | "manage" | null;

function errorMessage(error: unknown) {
  if (error instanceof HTTPError) {
    if (error.code === "DASHBOARD_NAME_TAKEN") return "已有同名仪表盘，请换一个名称。";
    if (error.code === "DASHBOARD_LIMIT_REACHED")
      return `每个项目最多 ${MAX_DASHBOARDS} 个个人仪表盘。`;
    if (error.code === "DASHBOARD_ORDER_STALE")
      return "仪表盘列表已在其他地方变化，请重新打开后排序。";
    return error.message;
  }
  return "操作失败，请稍后重试。";
}

/**
 * The page title is the dashboard's name and opens the list: the built-in default first,
 * then the user's own dashboards for this Project. The default cannot be renamed, moved or
 * deleted. Actions that change the list are disabled while the current dashboard has
 * unsaved changes, so a draft is never silently left behind.
 */
export function DashboardSwitcher({
  projectId,
  userId,
  dashboards,
  activeId,
  activeName,
  dirty,
  currentConfig,
  onNavigate,
}: {
  projectId: string;
  userId: string;
  dashboards: DashboardSummary[];
  activeId: string;
  activeName: string;
  dirty: boolean;
  currentConfig: DashboardConfig;
  onNavigate: (dashboardId: string | undefined, replace?: boolean) => void;
}) {
  const client = useQueryClient();
  const builtIn = isBuiltInDashboard(activeId);
  const [dialog, setDialog] = useState<Dialogs>(null);
  const listKey = ["dashboards", userId, projectId] as const;
  const refresh = () => client.invalidateQueries({ queryKey: listKey });
  const full = dashboards.length >= MAX_DASHBOARDS;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="dashboard-switcher inline-flex max-w-full items-center gap-1.5 rounded-full text-left"
            aria-label={`切换仪表盘，当前为 ${activeName}`}
          >
            <span className="truncate">{activeName}</span>
            <ChevronDownIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuRadioGroup value={activeId} onValueChange={(value) => onNavigate(value)}>
            <DropdownMenuRadioItem value={BUILT_IN_DASHBOARD_ID}>
              <span className="truncate">{BUILT_IN_DASHBOARD_NAME}</span>
              <span className="ml-auto pl-3 text-xs text-muted-foreground">内置</span>
            </DropdownMenuRadioItem>
            <DropdownMenuLabel>我的仪表盘</DropdownMenuLabel>
            {dashboards.map((dashboard) => (
              <DropdownMenuRadioItem key={dashboard.id} value={dashboard.id}>
                <span className="truncate">{dashboard.name}</span>
                <span className="ml-auto pl-3 text-xs text-muted-foreground">
                  {dashboard.widgetCount} 个模块
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          {!dashboards.length ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              编辑默认仪表盘并保存，或新建一个。
            </p>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={dirty || full} onSelect={() => setDialog("create")}>
            <PlusIcon />
            新建仪表盘…
          </DropdownMenuItem>
          <DropdownMenuItem disabled={dirty || builtIn} onSelect={() => setDialog("rename")}>
            <PencilIcon />
            重命名…
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={dirty || dashboards.length < 2}
            onSelect={() => setDialog("manage")}
          >
            <ListOrderedIcon />
            调整顺序…
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            disabled={dirty || builtIn}
            onSelect={() => setDialog("delete")}
          >
            <Trash2Icon />
            删除当前仪表盘…
          </DropdownMenuItem>
          {dirty ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              保存或取消当前修改后再管理仪表盘。
            </p>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {dialog === "create" ? (
        <CreateDashboardDialog
          projectId={projectId}
          userId={userId}
          activeId={activeId}
          activeName={activeName}
          currentConfig={currentConfig}
          existing={dashboards}
          onClose={() => setDialog(null)}
          onCreated={(created) => {
            setDialog(null);
            void refresh();
            onNavigate(created.id);
          }}
        />
      ) : null}
      {dialog === "rename" && !builtIn ? (
        <RenameDashboardDialog
          projectId={projectId}
          dashboardId={activeId}
          name={activeName}
          onClose={() => setDialog(null)}
          onRenamed={(renamed) => {
            setDialog(null);
            client.setQueryData(["dashboard", userId, projectId, renamed.id], renamed);
            void refresh();
          }}
        />
      ) : null}
      {dialog === "manage" ? (
        <ManageDashboardsDialog
          projectId={projectId}
          dashboards={dashboards}
          onClose={() => setDialog(null)}
          onReordered={(ordered) => {
            client.setQueryData(listKey, ordered);
            setDialog(null);
          }}
        />
      ) : null}
      {dialog === "delete" && !builtIn ? (
        <DeleteDashboardDialog
          projectId={projectId}
          dashboardId={activeId}
          name={activeName}
          onClose={() => setDialog(null)}
          onDeleted={() => {
            setDialog(null);
            const next = dashboards.find((dashboard) => dashboard.id !== activeId);
            client.removeQueries({ queryKey: ["dashboard", userId, projectId, activeId] });
            void refresh();
            onNavigate(next?.id, true);
          }}
        />
      ) : null}
    </>
  );
}

function CreateDashboardDialog({
  projectId,
  userId,
  activeId,
  activeName,
  currentConfig,
  existing,
  onClose,
  onCreated,
}: {
  projectId: string;
  userId: string;
  activeId: string;
  activeName: string;
  currentConfig: DashboardConfig;
  existing: DashboardSummary[];
  onClose: () => void;
  onCreated: (dashboard: NamedDashboard) => void;
}) {
  const id = useId();
  const catalog = useMetricCatalog(projectId, userId).data;
  const templates = availableTemplates(catalog);
  const [start, setStart] = useState<string>("copy");
  const [name, setName] = useState(() => uniqueDashboardName(`${activeName} 副本`, existing));
  const create = useMutation({
    mutationFn: async () => {
      const trimmed = name.trim();
      if (start === "copy") {
        // Copying a saved dashboard happens on the server so unknown modules survive.
        return isBuiltInDashboard(activeId)
          ? createDashboard(projectId, trimmed, currentConfig)
          : duplicateDashboard(projectId, activeId, trimmed);
      }
      const template = templates.find((entry) => entry.id === start);
      return createDashboard(projectId, trimmed, template ? template.build() : currentConfig);
    },
    onSuccess: onCreated,
  });
  const valid = name.trim().length > 0 && name.trim().length <= 80;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>新建仪表盘</DialogTitle>
          <DialogDescription>每个仪表盘都是你个人的，只有你能看到和修改。</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid) create.mutate();
          }}
        >
          <Field data-invalid={!valid}>
            <FieldLabel htmlFor={`${id}-name`}>名称</FieldLabel>
            <Input
              id={`${id}-name`}
              value={name}
              maxLength={80}
              autoFocus
              aria-invalid={!valid}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel id={`${id}-start`}>从哪里开始</FieldLabel>
            <div
              role="radiogroup"
              aria-labelledby={`${id}-start`}
              className="grid gap-2 sm:grid-cols-2"
            >
              {[
                { id: "copy", name: "复制当前仪表盘", description: `以「${activeName}」为起点` },
                ...templates,
              ].map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={start === option.id}
                  onClick={() => {
                    setStart(option.id);
                    setName(
                      uniqueDashboardName(
                        option.id === "copy" ? `${activeName} 副本` : option.name,
                        existing,
                      ),
                    );
                  }}
                  className="dashboard-template-option flex flex-col gap-0.5 rounded-xl border px-3 py-2 text-left"
                >
                  <span className="text-sm font-medium">{option.name}</span>
                  <span className="text-xs text-muted-foreground">{option.description}</span>
                </button>
              ))}
            </div>
            {!catalog ? <FieldDescription>指标目录加载后会显示更多模板。</FieldDescription> : null}
          </Field>
          {create.isError ? (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage(create.error)}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={!valid || create.isPending}>
              <CopyIcon data-icon="inline-start" />
              创建
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RenameDashboardDialog({
  projectId,
  dashboardId,
  name: initial,
  onClose,
  onRenamed,
}: {
  projectId: string;
  dashboardId: string;
  name: string;
  onClose: () => void;
  onRenamed: (dashboard: NamedDashboard) => void;
}) {
  const id = useId();
  const [name, setName] = useState(initial);
  const rename = useMutation({
    mutationFn: () => renameDashboard(projectId, dashboardId, name.trim()),
    onSuccess: onRenamed,
  });
  const valid = name.trim().length > 0 && name.trim().length <= 80;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>重命名仪表盘</DialogTitle>
          <DialogDescription>名称只影响你自己的仪表盘列表。</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid) rename.mutate();
          }}
        >
          <Field data-invalid={!valid}>
            <FieldLabel htmlFor={`${id}-name`}>名称</FieldLabel>
            <Input
              id={`${id}-name`}
              value={name}
              maxLength={80}
              autoFocus
              aria-invalid={!valid}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          {rename.isError ? (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage(rename.error)}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={!valid || rename.isPending || name.trim() === initial}>
              保存名称
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ManageDashboardsDialog({
  projectId,
  dashboards,
  onClose,
  onReordered,
}: {
  projectId: string;
  dashboards: DashboardSummary[];
  onClose: () => void;
  onReordered: (dashboards: DashboardSummary[]) => void;
}) {
  const [order, setOrder] = useState(dashboards);
  const [announcement, setAnnouncement] = useState("");
  const reorder = useMutation({
    mutationFn: () =>
      reorderDashboards(
        projectId,
        order.map((dashboard) => dashboard.id),
      ),
    onSuccess: onReordered,
  });
  const move = (index: number, offset: -1 | 1) => {
    const target = index + offset;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    [next[index], next[target]] = [next[target], next[index]];
    setOrder(next);
    setAnnouncement(`「${next[target].name}」已移到第 ${target + 1} 位`);
  };
  const changed = order.some((dashboard, index) => dashboard.id !== dashboards[index]?.id);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>调整仪表盘顺序</DialogTitle>
          <DialogDescription>
            顺序决定切换菜单的排列；内置默认仪表盘始终排在最前。
          </DialogDescription>
        </DialogHeader>
        <ol className="flex flex-col gap-2" aria-label="仪表盘顺序">
          {order.map((dashboard, index) => (
            <li key={dashboard.id} className="flex items-center gap-2 rounded-md border px-3 py-2">
              <span className="w-5 text-sm text-muted-foreground tabular-nums">{index + 1}</span>
              <span className="min-w-0 flex-1 truncate text-sm">{dashboard.name}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`上移${dashboard.name}`}
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                <ArrowUpIcon />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`下移${dashboard.name}`}
                disabled={index === order.length - 1}
                onClick={() => move(index, 1)}
              >
                <ArrowDownIcon />
              </Button>
            </li>
          ))}
        </ol>
        <p className="sr-only" role="status" aria-live="polite">
          {announcement}
        </p>
        {reorder.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage(reorder.error)}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            type="button"
            disabled={!changed || reorder.isPending}
            onClick={() => reorder.mutate()}
          >
            保存顺序
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDashboardDialog({
  projectId,
  dashboardId,
  name,
  onClose,
  onDeleted,
}: {
  projectId: string;
  dashboardId: string;
  name: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const remove = useMutation({
    mutationFn: () => deleteDashboard(projectId, dashboardId),
    onSuccess: onDeleted,
  });
  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除「{name}」？</AlertDialogTitle>
          <AlertDialogDescription>
            这个仪表盘的布局和模块配置会被永久删除，项目数据不受影响。其他仪表盘和内置默认仪表盘保持不变。
          </AlertDialogDescription>
        </AlertDialogHeader>
        {remove.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage(remove.error)}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={remove.isPending}>保留</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={remove.isPending}
            onClick={(event) => {
              event.preventDefault();
              remove.mutate();
            }}
          >
            删除仪表盘
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
