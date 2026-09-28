import { useId } from "react";
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { OverviewFilters } from "@/lib/filters/schema";
import {
  createWidget,
  dimensionLabels,
  eventKindLabels,
  eventMetricLabels,
  eventMetricNames,
  overviewMetricLabels,
  overviewMetricNames,
  sizeLabels,
  statAppearanceLabels,
  type StatAppearance,
  withBreakdownDimension,
  viewLabels,
  type Widget,
  type WidgetSize,
  type WidgetView,
} from "./model";
import { useMetricCatalog, useModulePreview } from "./queries";
import { CatalogFields } from "./CatalogFields";
import { coerceCatalogWidget, validateCatalogWidget } from "./catalogRules";

export type ModuleFieldsProps = {
  widget: Widget;
  onChange: (widget: Widget) => void;
  filters: OverviewFilters;
  userId: string;
  sizes: readonly WidgetSize[];
  views: readonly WidgetView[];
};

export function ModuleFields({
  widget,
  onChange,
  filters,
  userId,
  sizes,
  views,
}: ModuleFieldsProps) {
  const id = useId();
  const list = widget.type === "top-issues";
  const catalogSource = widget.data.source === "catalog";
  const catalogOnly = widget.type === "ranked-table" || widget.type === "metric-table";
  const catalogQuery = useMetricCatalog(filters.projectId, userId);
  const catalog = catalogQuery.data;
  function changeSource(value: string) {
    if (value === "catalog") {
      const next: Widget = {
        ...widget,
        version: 2,
        statAppearance: widget.type === "stat" ? widget.statAppearance : undefined,
        data: { source: "catalog", metrics: ["traffic.pageViews"], filters: {} },
      };
      onChange(catalog ? coerceCatalogWidget(next, catalog).widget : next);
      return;
    }
    onChange({
      ...widget,
      version: 1,
      view:
        widget.view === "stacked-area"
          ? "area"
          : widget.view === "stacked-bar"
            ? "bar"
            : widget.view,
      data:
        value === "events"
          ? { source: "events", metrics: ["estimated"], dimension: "country", eventKind: "custom" }
          : { source: "overview", metrics: ["pageViews"] },
    });
  }
  function changeType(value: string) {
    if (widget.data.source === "catalog") {
      const type = value as Widget["type"];
      if (type === "top-issues") return;
      const single = type === "stat" || type === "ranked-table";
      const table = type === "ranked-table" || type === "metric-table";
      const next: Widget = {
        ...widget,
        type,
        version: 2,
        size: type === "stat" ? "compact" : widget.size === "compact" ? "half" : widget.size,
        view: type === "stat" ? "number" : table ? "table" : type === "breakdown" ? "bar" : "line",
        statAppearance: type === "stat" ? widget.statAppearance : undefined,
        data: {
          ...widget.data,
          metrics: single ? widget.data.metrics.slice(0, 1) : widget.data.metrics,
          dimension: type === "stat" ? undefined : widget.data.dimension,
          sparkline: undefined,
        },
      };
      onChange(catalog ? coerceCatalogWidget(next, catalog).widget : next);
      return;
    }
    if (value !== "stat" && value !== "timeseries" && value !== "breakdown") return;
    const data =
      value === "stat" ? { ...widget.data, metrics: widget.data.metrics.slice(0, 1) } : widget.data;
    onChange({
      ...createWidget(value, { title: widget.title, data: data as Widget["data"] }),
      id: widget.id,
    });
  }
  return (
    <FieldGroup>
      <Field data-invalid={!widget.title.trim()}>
        <FieldLabel htmlFor={`${id}-title`}>标题</FieldLabel>
        <Input
          id={`${id}-title`}
          value={widget.title}
          maxLength={80}
          aria-invalid={!widget.title.trim()}
          onChange={(e) => onChange({ ...widget, title: e.target.value })}
        />
      </Field>
      {!list ? (
        <>
          <Field>
            <FieldLabel htmlFor={`${id}-source`}>数据来源</FieldLabel>
            <Select value={widget.data.source} onValueChange={changeSource} disabled={catalogOnly}>
              <SelectTrigger id={`${id}-source`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="catalog">指标目录</SelectItem>
                  {widget.data.source === "overview" ? (
                    <SelectItem value="overview">项目概览（经典）</SelectItem>
                  ) : null}
                  <SelectItem value="events">行为与自定义事件</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            {widget.data.source === "overview" ? (
              <FieldDescription>
                经典来源只为已有模块保留；切换到指标目录后不能再切回。
              </FieldDescription>
            ) : null}
          </Field>
          {widget.data.source === "events" ? (
            <EventFields widget={widget} onChange={onChange} filters={filters} userId={userId} />
          ) : null}
          {catalogSource ? (
            catalog ? (
              <CatalogFields
                widget={widget}
                onChange={onChange}
                catalog={catalog}
                filters={filters}
                userId={userId}
              />
            ) : (
              <p role="status" className="text-sm text-muted-foreground">
                {catalogQuery.isError ? "暂时无法加载指标目录，请稍后重试。" : "正在加载指标目录…"}
              </p>
            )
          ) : null}
          {!catalogSource ? (
            <Field>
              <FieldLabel htmlFor={`${id}-metric`}>统计指标</FieldLabel>
              <Select
                value={widget.data.metrics.join(",")}
                onValueChange={(value) =>
                  onChange({
                    ...widget,
                    data: { ...widget.data, metrics: value.split(",") },
                  } as Widget)
                }
              >
                <SelectTrigger id={`${id}-metric`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {(widget.data.source === "overview"
                      ? overviewMetricNames
                      : eventMetricNames
                    ).map((metric) => (
                      <SelectItem key={metric} value={metric}>
                        {
                          (widget.data.source === "overview"
                            ? overviewMetricLabels
                            : eventMetricLabels)[metric]
                        }
                      </SelectItem>
                    ))}
                    {widget.type === "timeseries" && widget.data.source === "overview" ? (
                      <>
                        <SelectItem value="pageViews,uniqueUsers">PV + UV</SelectItem>
                        <SelectItem value="errorRate,apiFailureRate">
                          错误率 + API 失败率
                        </SelectItem>
                      </>
                    ) : null}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldDescription>
                {widget.type === "stat"
                  ? "取整个时间范围的聚合值。"
                  : widget.type === "breakdown"
                    ? "按所选维度统计当前时间范围；用户和会话可能跨分组重复。"
                    : "时间桶由服务端决定，跟随全局时间范围。"}
              </FieldDescription>
            </Field>
          ) : null}
        </>
      ) : null}
      {widget.data.source === "overview" ? (
        <>
          <Field>
            <FieldLabel htmlFor={`${id}-release`}>版本筛选</FieldLabel>
            <Input
              id={`${id}-release`}
              maxLength={128}
              placeholder="全部版本"
              value={widget.data.release ?? ""}
              onChange={(e) => {
                if (widget.data.source === "overview")
                  onChange({
                    ...widget,
                    data: { ...widget.data, release: e.target.value || undefined },
                  });
              }}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-route`}>路由筛选</FieldLabel>
            <Input
              id={`${id}-route`}
              maxLength={512}
              placeholder="全部路由"
              value={widget.data.route ?? ""}
              onChange={(e) => {
                if (widget.data.source === "overview")
                  onChange({
                    ...widget,
                    data: { ...widget.data, route: e.target.value || undefined },
                  });
              }}
            />
            {filters.release || filters.route ? (
              <FieldDescription>当前链接包含临时筛选，将优先于这里的模块筛选。</FieldDescription>
            ) : null}
          </Field>
        </>
      ) : null}
      {!list ? (
        <Field>
          <FieldLabel htmlFor={`${id}-type`}>模块类型</FieldLabel>
          <Select value={widget.type} onValueChange={changeType}>
            <SelectTrigger id={`${id}-type`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="stat">指标卡</SelectItem>
                <SelectItem value="timeseries">时间趋势</SelectItem>
                <SelectItem value="breakdown" disabled={widget.data.source === "overview"}>
                  维度分布
                </SelectItem>
                <SelectItem value="ranked-table" disabled={!catalogSource}>
                  排行表
                </SelectItem>
                <SelectItem value="metric-table" disabled={!catalogSource}>
                  指标表
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <FieldDescription>
            {catalogSource
              ? "同一组指标可展示为指标卡、趋势、分布或表格。"
              : widget.data.source === "overview"
                ? "概览指标支持指标卡和趋势；维度分布需要事件或指标目录数据。"
                : "同一事件可展示为聚合指标、时间趋势或维度分布。"}
          </FieldDescription>
        </Field>
      ) : null}
      {widget.type === "stat" ? (
        <Field>
          <FieldLabel>卡片外观</FieldLabel>
          <ToggleGroup
            type="single"
            variant="outline"
            className="grid w-full grid-cols-1 sm:grid-cols-3"
            value={widget.statAppearance ?? "plain"}
            onValueChange={(value) => {
              if (value) onChange({ ...widget, statAppearance: value as StatAppearance });
            }}
            aria-label="卡片外观"
          >
            {Object.entries(statAppearanceLabels).map(([value, label]) => (
              <ToggleGroupItem key={value} value={value}>
                {label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <FieldDescription>
            趋势使用当前时间范围的真实数据；数值仍为整个周期的汇总。
          </FieldDescription>
        </Field>
      ) : (
        <Field>
          <FieldLabel>展示方式</FieldLabel>
          <ToggleGroup
            type="single"
            variant="outline"
            value={widget.view}
            onValueChange={(value) => {
              if (value) onChange({ ...widget, view: value as WidgetView });
            }}
            aria-label="展示方式"
          >
            {views
              .filter(
                (view) => catalogSource || (view !== "stacked-area" && view !== "stacked-bar"),
              )
              .map((view) => {
                // Ask the validator itself, so the editor can never disagree with a save.
                const reason =
                  catalogSource && catalog
                    ? validateCatalogWidget({ ...widget, view }, catalog)
                    : null;
                return (
                  <ToggleGroupItem
                    key={view}
                    value={view}
                    disabled={Boolean(reason) && widget.view !== view}
                    title={reason ?? undefined}
                  >
                    {viewLabels[view]}
                  </ToggleGroupItem>
                );
              })}
          </ToggleGroup>
          {widget.view === "donut" ? (
            <FieldDescription>
              左侧圆环、右侧排行；超过 6 类时保留前 5 类，其余合并为“其他”。占比基于已返回分组。
            </FieldDescription>
          ) : null}
        </Field>
      )}
      <Field>
        <FieldLabel>模块尺寸</FieldLabel>
        <ToggleGroup
          type="single"
          variant="outline"
          value={widget.size}
          onValueChange={(value) => {
            if (value) onChange({ ...widget, size: value as WidgetSize });
          }}
          aria-label="模块尺寸"
        >
          {sizes.map((size) => (
            <ToggleGroupItem key={size} value={size}>
              {sizeLabels[size]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <FieldDescription>时间、环境和配色跟随页面设置。</FieldDescription>
      </Field>
    </FieldGroup>
  );
}

function EventFields({
  widget,
  onChange,
  filters,
  userId,
}: Pick<ModuleFieldsProps, "widget" | "onChange" | "filters" | "userId">) {
  const id = useId();
  const catalogWidget: Widget = {
    ...widget,
    type: "stat",
    view: "number",
    size: "compact",
    data: { source: "events", metrics: ["estimated"], dimension: "country" },
  };
  const catalogQuery = useModulePreview(catalogWidget, filters, userId);
  const catalog = catalogQuery.data?.source === "events" ? catalogQuery.data.result : undefined;
  if (widget.data.source !== "events") return null;
  const data = widget.data;
  const property = data.dimension.startsWith("property:");
  const names = [
    ...new Set(
      catalog?.catalog
        .filter((entry) => !data.eventKind || entry.kind === data.eventKind)
        .map((entry) => entry.name),
    ),
  ];
  return (
    <>
      <Field>
        <FieldLabel htmlFor={`${id}-kind`}>事件类型</FieldLabel>
        <Select
          value={data.eventKind ?? "all"}
          onValueChange={(value) =>
            onChange({
              ...widget,
              data: {
                ...data,
                eventKind: value === "all" ? undefined : (value as typeof data.eventKind),
                eventName: undefined,
              },
            })
          }
        >
          <SelectTrigger id={`${id}-kind`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="all">全部类型</SelectItem>
              {Object.entries(eventKindLabels).map(([kind, label]) => (
                <SelectItem key={kind} value={kind}>
                  {label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
      <Field>
        <FieldLabel htmlFor={`${id}-event`}>事件名称</FieldLabel>
        <Input
          id={`${id}-event`}
          list={`${id}-events`}
          maxLength={80}
          placeholder="全部事件，或输入精确名称"
          value={data.eventName ?? ""}
          onChange={(e) =>
            onChange({ ...widget, data: { ...data, eventName: e.target.value || undefined } })
          }
        />
        <datalist id={`${id}-events`}>
          {names.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        <FieldDescription>
          {catalogQuery.isError
            ? "暂时无法加载事件目录，仍可输入事件名称。"
            : "可从已有事件选择，也可输入尚未出现的事件名称。"}
        </FieldDescription>
      </Field>
      {widget.type === "breakdown" ? (
        <>
          <Field>
            <FieldLabel htmlFor={`${id}-dimension`}>分组维度</FieldLabel>
            <Select
              value={property ? "property" : data.dimension}
              onValueChange={(value) =>
                onChange(
                  withBreakdownDimension(
                    widget,
                    value === "property" ? `property:${catalog?.properties[0]?.name ?? ""}` : value,
                  ),
                )
              }
            >
              <SelectTrigger id={`${id}-dimension`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {Object.entries(dimensionLabels).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                  <SelectItem value="property">自定义属性</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          {property ? (
            <Field data-invalid={!/^property:[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(data.dimension)}>
              <FieldLabel htmlFor={`${id}-property`}>属性名称</FieldLabel>
              <Input
                id={`${id}-property`}
                list={`${id}-properties`}
                maxLength={64}
                placeholder="例如 plan、button_name"
                value={data.dimension.slice(9)}
                aria-invalid={!/^property:[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(data.dimension)}
                onChange={(e) =>
                  onChange({
                    ...widget,
                    data: { ...data, dimension: `property:${e.target.value}` },
                  })
                }
              />
              <datalist id={`${id}-properties`}>
                {catalog?.properties.map((entry) => (
                  <option key={entry.name} value={entry.name} />
                ))}
              </datalist>
              <FieldDescription>按属性值分组统计事件，不对属性本身求和或平均。</FieldDescription>
            </Field>
          ) : null}
        </>
      ) : null}
    </>
  );
}
