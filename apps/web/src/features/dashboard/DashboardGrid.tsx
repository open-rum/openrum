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
import { DaisyDropdown } from "@/components/daisy/DaisyDropdown";
import { catalogFilterLabels } from "./catalogRules";
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
                        <div
                          role="tablist"
                          aria-label="切换卡片内容"
                          className="dashboard-module-tabs tabs tabs-box tabs-xs"
                        >
                          {block.records.map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              role="tab"
                              aria-selected={item.id === record.id}
                              className={cn("tab", item.id === record.id && "tab-active")}
                              title={recordTitle(item)}
                              onClick={() => onActiveTabChange(block.key, item.id)}
                            >
                              <span className="dashboard-module-tab-label">
                                {recordTitle(item)}
                              </span>
                            </button>
                          ))}
                        </div>
                      ) : undefined
                    }
                    actions={(openDetails) => (
                      <>
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs btn-circle"
                          aria-label={`放大 ${recordTitle(record)}`}
                          title="放大查看"
                          disabled={!widget}
                          onClick={openDetails}
                        >
                          <Maximize2Icon className="size-3.5" aria-hidden="true" />
                        </button>
                        <DaisyDropdown
                          label={`${recordTitle(record)} 操作`}
                          placement="top-end"
                          triggerClassName="dashboard-settings-trigger btn btn-ghost btn-xs btn-circle"
                          menuClassName="w-56"
                          disabled={disabled}
                          trigger={<Settings2Icon className="size-3.5" aria-hidden="true" />}
                        >
                          {(close) => {
                            const run = (action: () => void) => () => {
                              close();
                              action();
                            };
                            return (
                              <>
                                <li className={cn(!widget && "menu-disabled")}>
                                  <button
                                    type="button"
                                    disabled={!widget}
                                    onClick={run(() => widget && onConfigure(widget))}
                                  >
                                    <Settings2Icon className="size-4" aria-hidden="true" />
                                    {grouped ? "配置当前标签页" : "配置模块"}
                                  </button>
                                </li>
                                <li
                                  className={cn(
                                    (widgets.length >= MAX_WIDGETS || !widget) && "menu-disabled",
                                  )}
                                >
                                  <button
                                    type="button"
                                    disabled={widgets.length >= MAX_WIDGETS || !widget}
                                    onClick={run(() => {
                                      const at =
                                        widgets.indexOf(block.records[block.records.length - 1]) +
                                        1;
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
                                    })}
                                  >
                                    <CopyIcon className="size-4" aria-hidden="true" />
                                    复制为新卡片
                                  </button>
                                </li>
                                <div className="divider my-0" />
                                {targets.length ? (
                                  <li>
                                    <details>
                                      <summary>
                                        <CombineIcon className="size-4" aria-hidden="true" />
                                        合并到…
                                      </summary>
                                      <ul>
                                        {targets.map((target) => (
                                          <li key={target.key}>
                                            <button
                                              type="button"
                                              onClick={run(() =>
                                                onChange(
                                                  mergeBlocks(widgets, block.key, target.key),
                                                ),
                                              )}
                                            >
                                              <span className="truncate">
                                                {target.records.map(recordTitle).join(" / ")}
                                              </span>
                                            </button>
                                          </li>
                                        ))}
                                      </ul>
                                    </details>
                                  </li>
                                ) : (
                                  <li className="menu-disabled">
                                    <span>
                                      <CombineIcon className="size-4" aria-hidden="true" />
                                      合并到…
                                    </span>
                                  </li>
                                )}
                                {grouped ? (
                                  <li>
                                    <button
                                      type="button"
                                      onClick={run(() =>
                                        onChange(splitFromGroup(widgets, record.id)),
                                      )}
                                    >
                                      <SplitIcon className="size-4" aria-hidden="true" />
                                      移出为独立卡片
                                    </button>
                                  </li>
                                ) : null}
                                <div className="divider my-0" />
                                <li className="menu-title">尺寸</li>
                                {widget
                                  ? moduleRegistry[widget.type].sizes.map((size) => (
                                      <li key={size}>
                                        <button
                                          type="button"
                                          className={cn(record.size === size && "menu-active")}
                                          onClick={run(() =>
                                            onChange(resizeBlock(widgets, block.key, size)),
                                          )}
                                        >
                                          {sizeLabels[size]}
                                        </button>
                                      </li>
                                    ))
                                  : null}
                                <div className="divider my-0" />
                                <li className={cn(index === 0 && "menu-disabled")}>
                                  <button
                                    type="button"
                                    disabled={index === 0}
                                    onClick={run(() =>
                                      onChange(
                                        moveBlock(widgets, block.key, blocks[index - 1].key),
                                      ),
                                    )}
                                  >
                                    <ArrowUpIcon className="size-4" aria-hidden="true" />
                                    上移
                                  </button>
                                </li>
                                <li className={cn(index === blocks.length - 1 && "menu-disabled")}>
                                  <button
                                    type="button"
                                    disabled={index === blocks.length - 1}
                                    onClick={run(() =>
                                      onChange(
                                        moveBlock(widgets, block.key, blocks[index + 1].key),
                                      ),
                                    )}
                                  >
                                    <ArrowDownIcon className="size-4" aria-hidden="true" />
                                    下移
                                  </button>
                                </li>
                                {grouped ? (
                                  <li>
                                    <button
                                      type="button"
                                      className="text-error"
                                      onClick={run(() =>
                                        onChange(
                                          normalizeGroups(
                                            widgets.filter((item) => item.id !== record.id),
                                          ),
                                        ),
                                      )}
                                    >
                                      <Trash2Icon className="size-4" aria-hidden="true" />
                                      移除当前标签页
                                    </button>
                                  </li>
                                ) : null}
                                <li>
                                  <button
                                    type="button"
                                    className="text-error"
                                    onClick={run(() =>
                                      onChange(
                                        widgets.filter((item) => !block.records.includes(item)),
                                      ),
                                    )}
                                  >
                                    <Trash2Icon className="size-4" aria-hidden="true" />
                                    {grouped ? "移除整张卡片" : "移除模块"}
                                  </button>
                                </li>
                              </>
                            );
                          }}
                        </DaisyDropdown>
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
          <div className="dashboard-drag-preview card card-border bg-base-100 shadow-xl">
            <div className="card-body">
              <h3 className="card-title">{dragged.records.map(recordTitle).join(" / ")}</h3>
              <p className="text-base-content/70">拖到新位置后放下</p>
            </div>
          </div>
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
        <button
          type="button"
          ref={setActivatorNodeRef}
          className="dashboard-drag-handle btn btn-ghost btn-sm btn-square"
          disabled={!enabled}
          {...attributes}
          {...listeners}
          aria-label={`移动 ${label}`}
        >
          <GripVerticalIcon className="size-4" aria-hidden="true" />
        </button>,
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
      <div
        ref={cardRef}
        className={cn(
          "dashboard-module card card-border h-full bg-base-100 [&_table_th]:px-3 [&_table_th]:py-2.5 [&_table_th]:text-xs [&_table_th]:font-medium [&_table_th]:text-base-content/70 [&_table_td]:px-3 [&_table_td]:py-2.5 [&_table_td]:text-[13px] [&_table_td]:leading-5",
          widget?.type === "stat" ? "card-sm relative isolate" : "card-md",
        )}
        data-module-title={title}
      >
        <div className="card-body min-w-0 gap-4">
          <div className="dashboard-module-header relative z-10">
            <div className="min-w-0">
              <h3
                className={cn(
                  "card-title min-w-0 text-base-content/85",
                  widget?.type === "stat"
                    ? "text-sm leading-5 font-medium"
                    : "text-[15px] leading-6 font-semibold",
                )}
              >
                <span
                  className={
                    widget?.type === "stat"
                      ? "whitespace-normal [overflow-wrap:anywhere]"
                      : "truncate"
                  }
                  title={title}
                >
                  {title}
                </span>
                <ModuleFilterHint widget={widget} filters={filters} />
                {freshness?.stale ? (
                  <span
                    className="status status-warning size-1.5 shrink-0"
                    role="img"
                    aria-label="数据延迟，详情中查看接收时间"
                    title="数据延迟"
                  />
                ) : null}
              </h3>
              {showDescription || !widget ? (
                <p className="text-xs text-base-content/70">
                  {widget ? widgetDescription(widget) : `${record.type} · v${record.version}`}
                </p>
              ) : null}
            </div>
            {headerAction || tabs ? (
              <div className="flex min-w-0 shrink-0 items-center gap-2">
                {tabs}
                {headerAction}
              </div>
            ) : null}
          </div>
          <div className="dashboard-module-content flex min-w-0 flex-1 flex-col">
            <ModuleContent record={record} query={query} filters={filters} />
          </div>
        </div>
        <div className="dashboard-module-actions" role="toolbar" aria-label={`${title} 操作`}>
          {actions(() => setDetailsOpen(true))}
        </div>
      </div>
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
    <span className="tooltip tooltip-bottom" data-tip={conditions.join("；")}>
      <span className="dashboard-filter-hint" role="img" aria-label={label} tabIndex={0}>
        <FilterIcon aria-hidden="true" />
      </span>
    </span>
  );
}
