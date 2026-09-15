import { useState, type ReactNode } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  sortableKeyboardCoordinates,
  arrayMove,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CopyIcon,
  GripVerticalIcon,
  MoreHorizontalIcon,
  Maximize2Icon,
  XIcon,
  Settings2Icon,
  Trash2Icon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { OverviewFilters } from "@/lib/filters/schema";
import {
  MAX_WIDGETS,
  readWidget,
  sizeLabels,
  widgetDescription,
  type StoredWidget,
  type Widget,
} from "./model";
import { moduleRegistry } from "./registry";
import { ModuleContent } from "./ModuleContent";
import { effectiveOverviewFilters, type ModuleQuery } from "./queries";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";

type GridProps = {
  widgets: StoredWidget[];
  queries: Map<string, ModuleQuery>;
  filters: OverviewFilters;
  editing: boolean;
  disabled: boolean;
  onChange: (widgets: StoredWidget[]) => void;
  onConfigure: (widget: Widget) => void;
};

export function DashboardGrid({
  widgets,
  queries,
  filters,
  editing,
  disabled,
  onChange,
  onConfigure,
}: GridProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  function move(id: string, to: number) {
    const from = widgets.findIndex((widget) => widget.id === id);
    if (from >= 0 && to >= 0 && to < widgets.length) onChange(arrayMove(widgets, from, to));
  }
  function finish(event: DragEndEvent) {
    setActiveId(null);
    if (event.over && event.active.id !== event.over.id)
      move(
        String(event.active.id),
        widgets.findIndex((widget) => widget.id === event.over!.id),
      );
  }
  const active = widgets.find((widget) => widget.id === activeId);
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={(e) => setActiveId(String(e.active.id))}
      onDragEnd={finish}
      onDragCancel={() => setActiveId(null)}
      accessibility={{
        screenReaderInstructions: {
          draggable: "按空格键开始移动模块，使用方向键调整位置，再按空格键放下。按 Escape 取消。",
        },
        announcements: {
          onDragStart: () => "已拾起模块。",
          onDragOver: ({ over }) =>
            over
              ? `移动到第 ${widgets.findIndex((w) => w.id === over.id) + 1} 个位置。`
              : "移出可放置区域。",
          onDragEnd: ({ over }) => (over ? "已放下模块。请保存概览。" : "已取消移动。"),
          onDragCancel: () => "已取消移动。",
        },
      }}
    >
      <SortableContext items={widgets.map((widget) => widget.id)} strategy={rectSortingStrategy}>
        <div className="dashboard-grid" data-editing={editing}>
          {widgets.map((record, index) => (
            <SortableModule key={record.id} record={record} enabled={editing && !disabled}>
              {(handle) => (
                <ModuleCard
                  record={record}
                  query={queries.get(record.id)}
                  filters={filters}
                  actions={
                    editing ? (
                      <div className="flex items-center gap-1">
                        {handle}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`${typeof record.title === "string" ? record.title : "模块"} 操作`}
                              disabled={disabled}
                            >
                              <MoreHorizontalIcon />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuGroup>
                              <DropdownMenuItem
                                disabled={!readWidget(record)}
                                onSelect={() => {
                                  const widget = readWidget(record);
                                  if (widget) onConfigure(widget);
                                }}
                              >
                                <Settings2Icon />
                                配置模块
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                disabled={widgets.length >= MAX_WIDGETS || !readWidget(record)}
                                onSelect={() =>
                                  onChange([
                                    ...widgets.slice(0, index + 1),
                                    {
                                      ...record,
                                      id: crypto.randomUUID(),
                                      title: `${record.title} 副本`.slice(0, 80),
                                    },
                                    ...widgets.slice(index + 1),
                                  ])
                                }
                              >
                                <CopyIcon />
                                复制模块
                              </DropdownMenuItem>
                            </DropdownMenuGroup>
                            <DropdownMenuSeparator />
                            <DropdownMenuGroup>
                              <DropdownMenuLabel>尺寸</DropdownMenuLabel>
                              {readWidget(record)
                                ? moduleRegistry[readWidget(record)!.type].sizes.map((size) => (
                                    <DropdownMenuItem
                                      key={size}
                                      onSelect={() =>
                                        onChange(
                                          widgets.map((item) =>
                                            item.id === record.id ? { ...item, size } : item,
                                          ),
                                        )
                                      }
                                    >
                                      {sizeLabels[size]}
                                      {record.size === size ? " ✓" : ""}
                                    </DropdownMenuItem>
                                  ))
                                : null}
                            </DropdownMenuGroup>
                            <DropdownMenuSeparator />
                            <DropdownMenuGroup>
                              <DropdownMenuItem
                                disabled={index === 0}
                                onSelect={() => move(record.id, index - 1)}
                              >
                                <ArrowUpIcon />
                                上移
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                disabled={index === widgets.length - 1}
                                onSelect={() => move(record.id, index + 1)}
                              >
                                <ArrowDownIcon />
                                下移
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                variant="destructive"
                                onSelect={() =>
                                  onChange(widgets.filter((item) => item.id !== record.id))
                                }
                              >
                                <Trash2Icon />
                                移除模块
                              </DropdownMenuItem>
                            </DropdownMenuGroup>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    ) : undefined
                  }
                />
              )}
            </SortableModule>
          ))}
        </div>
      </SortableContext>
      <DragOverlay dropAnimation={null}>
        {active ? (
          <Card className="dashboard-drag-preview">
            <CardHeader>
              <CardTitle>{typeof active.title === "string" ? active.title : "模块"}</CardTitle>
              <CardDescription>拖到新位置后放下</CardDescription>
            </CardHeader>
          </Card>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function SortableModule({
  record,
  enabled,
  children,
}: {
  record: StoredWidget;
  enabled: boolean;
  children: (handle: ReactNode) => ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: record.id, disabled: !enabled });
  const size = readWidget(record)?.size ?? "half";
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "dashboard-grid-item",
        `dashboard-size-${size}`,
        isDragging && "dashboard-dragging",
      )}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      {children(
        <Button
          ref={setActivatorNodeRef}
          variant="ghost"
          size="icon-sm"
          className="dashboard-drag-handle"
          disabled={!enabled}
          {...attributes}
          {...listeners}
          aria-label={`移动 ${typeof record.title === "string" ? record.title : "模块"}`}
        >
          <GripVerticalIcon />
        </Button>,
      )}
    </div>
  );
}

export function ModuleCard({
  record,
  query,
  filters,
  actions,
}: {
  record: StoredWidget;
  query?: ModuleQuery;
  filters: OverviewFilters;
  actions?: ReactNode;
}) {
  const widget = readWidget(record);
  const effective =
    widget?.data.source === "overview" ? effectiveOverviewFilters(widget, filters) : undefined;
  const freshness = query?.data?.result.freshness;
  const [detailsOpen, setDetailsOpen] = useState(false);
  const title = typeof record.title === "string" ? record.title : "暂不可用的模块";
  return (
    <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
      <Card
        className="dashboard-module h-full"
        data-module-title={title}
        size={widget?.type === "stat" ? "sm" : "default"}
      >
        <CardHeader className="dashboard-module-header">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              <span className="truncate" title={title}>
                {title}
              </span>
              {freshness?.stale ? (
                <span
                  className="dashboard-status-dot"
                  role="img"
                  aria-label="数据延迟，详情中查看接收时间"
                  title="数据延迟"
                />
              ) : null}
            </CardTitle>
            {actions || !widget ? (
              <CardDescription>
                {widget ? widgetDescription(widget) : `${record.type} · v${record.version}`}
              </CardDescription>
            ) : null}
          </div>
          <CardAction className="flex items-center gap-2">
            {actions ??
              (widget ? (
                <TooltipProvider delayDuration={250}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <DialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="dashboard-detail-trigger"
                          aria-label={`${title} 详情`}
                        >
                          <Maximize2Icon />
                        </Button>
                      </DialogTrigger>
                    </TooltipTrigger>
                    <TooltipContent>查看详情与数据表</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : null)}
          </CardAction>
        </CardHeader>
        {effective?.release || effective?.route ? (
          <div className="flex flex-wrap gap-1 px-4">
            {effective.release ? <Badge variant="outline">版本 {effective.release}</Badge> : null}
            {effective.route ? <Badge variant="outline">路由 {effective.route}</Badge> : null}
            {filters.release || filters.route ? <Badge variant="secondary">链接筛选</Badge> : null}
          </div>
        ) : null}
        <CardContent className="min-w-0 flex-1">
          <ModuleContent record={record} query={query} filters={filters} />
        </CardContent>
      </Card>
      <DialogContent className="dashboard-detail-dialog sm:max-w-4xl" showCloseButton={false}>
        <DialogHeader className="pr-8">
          <DialogTitle>{title} 详情</DialogTitle>
          <DialogDescription>当前筛选范围内的统计口径、详细数值与数据表。</DialogDescription>
          <DialogClose asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="absolute top-2 right-2"
              aria-label="关闭详情"
            >
              <XIcon />
            </Button>
          </DialogClose>
        </DialogHeader>
        <div className="dashboard-detail-body">
          {detailsOpen ? (
            <ModuleContent record={record} query={query} filters={filters} detailed />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
