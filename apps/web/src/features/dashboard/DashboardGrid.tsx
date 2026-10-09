import { useRef, useState, type ReactNode } from "react";
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
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CombineIcon,
  CopyIcon,
  FilterIcon,
  GripVerticalIcon,
  Maximize2Icon,
  Settings2Icon,
  SplitIcon,
  Trash2Icon,
} from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { catalogFilterLabels } from "./catalogRules";
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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { OverviewFilters } from "@/lib/filters/schema";
import {
  MAX_WIDGETS,
  readWidget,
  sizeLabels,
  widgetDescription,
  type CatalogFilterKey,
  type StoredWidget,
  type Widget,
} from "./model";
import { moduleRegistry } from "./registry";
import {
  mergeBlocks,
  mergeTargets,
  moveBlock,
  normalizeGroups,
  resizeBlock,
  splitFromGroup,
  toBlocks,
  withoutGroup,
} from "./groups";
import { ModuleContent } from "./ModuleContent";
import { effectiveOverviewFilters, type ModuleQuery } from "./queries";
import { Dialog } from "@/components/ui/dialog";
import { ModuleDetailsDialog } from "./ModuleDetailsDialog";

type GridProps = {
  widgets: StoredWidget[];
  queries: Map<string, ModuleQuery>;
  filters: OverviewFilters;
  editing: boolean;
  disabled: boolean;
  /** Visible tab per tabbed card, keyed by the card's first module id. */
  activeTabs: Record<string, string>;
  onActiveTabChange: (blockKey: string, moduleId: string) => void;
  onChange: (widgets: StoredWidget[]) => void;
  onConfigure: (widget: Widget) => void;
};

const recordTitle = (record: StoredWidget) =>
  typeof record.title === "string" ? record.title : "模块";

export function DashboardGrid({
  widgets,
  queries,
  filters,
  editing,
  disabled,
  activeTabs,
  onActiveTabChange,
  onChange,
  onConfigure,
}: GridProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const blocks = toBlocks(widgets);
  function finish(event: DragEndEvent) {
    setActiveId(null);
    if (event.over && event.active.id !== event.over.id)
      onChange(moveBlock(widgets, String(event.active.id), String(event.over.id)));
  }
  const dragged = blocks.find((block) => block.key === activeId);
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
              ? `移动到第 ${blocks.findIndex((b) => b.key === over.id) + 1} 个位置。`
              : "移出可放置区域。",
          onDragEnd: ({ over }) => (over ? "已放下模块。请保存仪表盘。" : "已取消移动。"),
          onDragCancel: () => "已取消移动。",
        },
      }}
    >
      <SortableContext items={blocks.map((block) => block.key)} strategy={rectSortingStrategy}>
        <div className="dashboard-grid" data-editing={editing}>
          {blocks.map((block, index) => {
            const grouped = block.records.length > 1;
            const record =
              block.records.find((item) => item.id === activeTabs[block.key]) ?? block.records[0];
            const widget = readWidget(record);
            const targets = mergeTargets(widgets, block.key);
            return (
              <SortableModule
                key={block.key}
                id={block.key}
                record={record}
                label={
                  grouped
                    ? `${recordTitle(record)} 等 ${block.records.length} 个模块`
                    : recordTitle(record)
                }
                enabled={editing && !disabled}
              >
                {(handle) => (
                  <ModuleCard
                    record={record}
                    query={queries.get(record.id)}
                    filters={filters}
                    showDescription={editing}
                    headerAction={editing ? handle : undefined}
                    tabs={
                      grouped ? (
                        <ToggleGroup
                          type="single"
                          variant="outline"
                          size="sm"
                          value={record.id}
                          onValueChange={(value) => value && onActiveTabChange(block.key, value)}
                          aria-label="切换卡片内容"
                          className="dashboard-module-tabs"
                        >
                          {block.records.map((item) => (
                            <ToggleGroupItem
                              key={item.id}
                              value={item.id}
                              title={recordTitle(item)}
                            >
                              <span className="dashboard-module-tab-label">
                                {recordTitle(item)}
                              </span>
                            </ToggleGroupItem>
                          ))}
                        </ToggleGroup>
                      ) : undefined
                    }
                    actions={(openDetails) => (
                      <>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`放大 ${recordTitle(record)}`}
                          title="放大查看"
                          disabled={!widget}
                          onClick={openDetails}
                        >
                          <Maximize2Icon />
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="dashboard-settings-trigger"
                              aria-label={`${recordTitle(record)} 操作`}
                              disabled={disabled}
                            >
                              <Settings2Icon />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="min-w-44">
                            <DropdownMenuGroup>
                              <DropdownMenuItem
                                disabled={!widget}
                                onSelect={() => widget && onConfigure(widget)}
                              >
                                <Settings2Icon />
                                {grouped ? "配置当前标签页" : "配置模块"}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                disabled={widgets.length >= MAX_WIDGETS || !widget}
                                onSelect={() => {
                                  const at =
                                    widgets.indexOf(block.records[block.records.length - 1]) + 1;
                                  const copy = withoutGroup(record);
                                  onChange([
                                    ...widgets.slice(0, at),
                                    {
                                      ...copy,
                                      id: crypto.randomUUID(),
                                      title: `${recordTitle(record)} 副本`.slice(0, 80),
                                    },
                                    ...widgets.slice(at),
                                  ]);
                                }}
                              >
                                <CopyIcon />
                                复制为新卡片
                              </DropdownMenuItem>
                            </DropdownMenuGroup>
                            <DropdownMenuSeparator />
                            <DropdownMenuGroup>
                              <DropdownMenuSub>
                                <DropdownMenuSubTrigger disabled={!targets.length}>
                                  <CombineIcon />
                                  合并到…
                                </DropdownMenuSubTrigger>
                                <DropdownMenuSubContent className="min-w-48 max-w-72">
                                  {targets.map((target) => (
                                    <DropdownMenuItem
                                      key={target.key}
                                      onSelect={() =>
                                        onChange(mergeBlocks(widgets, block.key, target.key))
                                      }
                                    >
                                      {target.records.map(recordTitle).join(" / ")}
                                    </DropdownMenuItem>
                                  ))}
                                </DropdownMenuSubContent>
                              </DropdownMenuSub>
                              {grouped ? (
                                <DropdownMenuItem
                                  onSelect={() => onChange(splitFromGroup(widgets, record.id))}
                                >
                                  <SplitIcon />
                                  移出为独立卡片
                                </DropdownMenuItem>
                              ) : null}
                            </DropdownMenuGroup>
                            <DropdownMenuSeparator />
                            <DropdownMenuGroup>
                              <DropdownMenuLabel>尺寸</DropdownMenuLabel>
                              {widget
                                ? moduleRegistry[widget.type].sizes.map((size) => (
                                    <DropdownMenuItem
                                      key={size}
                                      onSelect={() =>
                                        onChange(resizeBlock(widgets, block.key, size))
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
                                onSelect={() =>
                                  onChange(moveBlock(widgets, block.key, blocks[index - 1].key))
                                }
                              >
                                <ArrowUpIcon />
                                上移
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                disabled={index === blocks.length - 1}
                                onSelect={() =>
                                  onChange(moveBlock(widgets, block.key, blocks[index + 1].key))
                                }
                              >
                                <ArrowDownIcon />
                                下移
                              </DropdownMenuItem>
                              {grouped ? (
                                <DropdownMenuItem
                                  variant="destructive"
                                  onSelect={() =>
                                    onChange(
                                      normalizeGroups(
                                        widgets.filter((item) => item.id !== record.id),
                                      ),
                                    )
                                  }
                                >
                                  <Trash2Icon />
                                  移除当前标签页
                                </DropdownMenuItem>
                              ) : null}
                              <DropdownMenuItem
                                variant="destructive"
                                onSelect={() =>
                                  onChange(widgets.filter((item) => !block.records.includes(item)))
                                }
                              >
                                <Trash2Icon />
                                {grouped ? "移除整张卡片" : "移除模块"}
                              </DropdownMenuItem>
                            </DropdownMenuGroup>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </>
                    )}
                  />
                )}
              </SortableModule>
            );
          })}
        </div>
      </SortableContext>
      <DragOverlay dropAnimation={null}>
        {dragged ? (
          <Card className="dashboard-drag-preview">
            <CardHeader>
              <CardTitle>{dragged.records.map(recordTitle).join(" / ")}</CardTitle>
              <CardDescription>拖到新位置后放下</CardDescription>
            </CardHeader>
          </Card>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function SortableModule({
  id,
  record,
  label,
  enabled,
  children,
}: {
  id: string;
  record: StoredWidget;
  label: string;
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
  } = useSortable({ id, disabled: !enabled });
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
          aria-label={`移动 ${label}`}
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
  headerAction,
  tabs,
  showDescription = false,
}: {
  record: StoredWidget;
  query?: ModuleQuery;
  filters: OverviewFilters;
  /** Floating hover toolbar at the card's bottom-right (expand, settings). */
  actions: (openDetails: () => void) => ReactNode;
  /** Always-visible control in the header, such as the drag handle while editing. */
  headerAction?: ReactNode;
  /** The tab switch of a tabbed card, shown at the header's top-right. */
  tabs?: ReactNode;
  showDescription?: boolean;
}) {
  const widget = readWidget(record);
  const freshness = query?.data?.result.freshness;
  const [detailsOpen, setDetailsOpen] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const title = typeof record.title === "string" ? record.title : "暂不可用的模块";
  return (
    <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
      <Card
        ref={cardRef}
        className={cn("dashboard-module h-full", widget?.type === "stat" && "relative isolate")}
        data-module-title={title}
        size={widget?.type === "stat" ? "sm" : "default"}
      >
        <CardHeader className="dashboard-module-header relative z-10">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              <span className="truncate" title={title}>
                {title}
              </span>
              <ModuleFilterHint widget={widget} filters={filters} />
              {freshness?.stale ? (
                <span
                  className="dashboard-status-dot"
                  role="img"
                  aria-label="数据延迟，详情中查看接收时间"
                  title="数据延迟"
                />
              ) : null}
            </CardTitle>
            {showDescription || !widget ? (
              <CardDescription>
                {widget ? widgetDescription(widget) : `${record.type} · v${record.version}`}
              </CardDescription>
            ) : null}
          </div>
          {headerAction || tabs ? (
            <CardAction className="flex min-w-0 items-center gap-2">
              {tabs}
              {headerAction}
            </CardAction>
          ) : null}
        </CardHeader>
        <CardContent className="min-w-0 flex-1">
          <ModuleContent record={record} query={query} filters={filters} />
        </CardContent>
        <div className="dashboard-module-actions" role="toolbar" aria-label={`${title} 操作`}>
          {actions(() => setDetailsOpen(true))}
        </div>
      </Card>
      <ModuleDetailsDialog record={record} query={query} filters={filters} sourceRef={cardRef} />
    </Dialog>
  );
}

/**
 * A filtered module says so with one quiet icon beside its title; the conditions show on
 * hover or focus, so filters never push the value or chart down the card.
 */
function ModuleFilterHint({ widget, filters }: { widget?: Widget; filters: OverviewFilters }) {
  if (!widget) return null;
  const conditions: string[] = [];
  if (widget.data.source === "catalog") {
    const entries = Object.entries(widget.data.filters) as Array<
      [CatalogFilterKey, string | undefined]
    >;
    for (const [key, value] of entries) {
      // An event name already implies its kind; listing both only adds noise.
      if (!value || (key === "eventKind" && widget.data.filters.eventName)) continue;
      conditions.push(`${catalogFilterLabels[key]}：${value}`);
    }
  } else if (widget.data.source === "overview") {
    const effective = effectiveOverviewFilters(widget, filters);
    if (effective.release) conditions.push(`版本：${effective.release}`);
    if (effective.route) conditions.push(`路由：${effective.route}`);
  }
  if (filters.release || filters.route) conditions.push("另有链接中的筛选");
  if (!conditions.length) return null;
  const label = `筛选条件：${conditions.join("；")}`;
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="dashboard-filter-hint" role="img" aria-label={label} tabIndex={0}>
            <FilterIcon aria-hidden="true" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="start">
          <span className="grid gap-0.5">
            {conditions.map((condition) => (
              <span key={condition}>{condition}</span>
            ))}
          </span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
