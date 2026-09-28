import { useId, useState } from "react";
import { XIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { CatalogMetric, MetricCatalog } from "@/lib/api/metricsQuery";
import type { OverviewFilters } from "@/lib/filters/schema";
import { catalogFilterLabels, coerceCatalogWidget, compatibleMetric } from "./catalogRules";
import {
  catalogDimensionLabels,
  eventKindLabels,
  type CatalogFilterKey,
  type Widget,
} from "./model";
import { useQuery } from "@tanstack/react-query";
import { useDashboardPointBudget } from "./chartDensity";
import { moduleQueryOptions } from "./queries";

type CatalogData = Extract<Widget["data"], { source: "catalog" }>;

const unitLabels: Record<string, string> = {
  count: "数量",
  ratio: "比例",
  ms: "毫秒",
  score: "分数",
  number: "数值",
};

const filterPlaceholders: Record<CatalogFilterKey, string> = {
  release: "全部版本",
  route: "全部路由",
  country: "如 CN、US，或 unknown",
  browser: "全部浏览器",
  device: "如 desktop、mobile",
  apiMethod: "如 GET、POST",
  apiUrl: "归一化后的地址",
  eventKind: "全部类型",
  eventName: "全部事件",
};

/** How many metrics this module can hold, and whether a new pick replaces the old one. */
function selectionLimit(widget: Widget, catalog: MetricCatalog) {
  if (widget.data.source !== "catalog") return 1;
  if (widget.type === "metric-table") return catalog.limits.maxMetrics.table ?? 6;
  if (widget.type === "timeseries" && !widget.data.dimension)
    return catalog.limits.maxMetrics.series ?? 4;
  return 1;
}

export function CatalogFields({
  widget,
  onChange,
  catalog,
  filters,
  userId,
}: {
  widget: Widget;
  onChange: (widget: Widget) => void;
  catalog: MetricCatalog;
  filters: OverviewFilters;
  userId: string;
}) {
  const id = useId();
  const [family, setFamily] = useState(() => {
    const first = widget.data.source === "catalog" ? widget.data.metrics[0] : undefined;
    return (
      catalog.metrics.find((metric) => metric.id === first)?.family ?? catalog.families[0]?.id ?? ""
    );
  });
  const [removed, setRemoved] = useState<string[]>([]);
  const measurementNames = useMeasurementNames(widget, filters, userId, catalog);
  const eventNames = useEventNames(widget, filters, userId, catalog);
  const [eventDraft, setEventDraft] = useState("");
  if (widget.data.source !== "catalog") return null;
  const data = widget.data;
  const byId = new Map(catalog.metrics.map((metric) => [metric.id, metric]));
  const selected = data.metrics
    .map((metricId) => byId.get(metricId))
    .filter((m): m is CatalogMetric => Boolean(m));
  const first = selected[0];
  const limit = selectionLimit(widget, catalog);
  const table = widget.type === "metric-table";

  const change = (next: Widget) => {
    const coerced = coerceCatalogWidget(next, catalog);
    setRemoved(coerced.removed);
    onChange(coerced.widget);
  };
  const setData = (patch: Partial<CatalogData>) =>
    change({ ...widget, data: { ...data, ...patch } });

  const pick = (metric: CatalogMetric) => {
    const already = data.metrics.includes(metric.id);
    if (already) {
      if (data.metrics.length > 1)
        setData({ metrics: data.metrics.filter((entry) => entry !== metric.id) });
      return;
    }
    // A pick from another source, or into a single-metric module, replaces the selection.
    const replace = limit === 1 || (first && metric.source !== first.source);
    const metrics = replace ? [metric.id] : [...data.metrics, metric.id].slice(0, limit);
    const measurement = metric.requiresMeasurementKey
      ? (data.measurement ?? measurementNames[0] ?? "")
      : undefined;
    setData({ metrics, measurement: measurement || undefined });
  };

  const dimensions = first
    ? first.dimensions.filter((dimension) =>
        selected.every((metric) => metric.dimensions.includes(dimension)),
      )
    : [];
  const needsDimension =
    widget.type === "breakdown" || widget.type === "ranked-table" || widget.type === "metric-table";
  const canSplit = widget.type === "timeseries";
  const property = data.dimension?.startsWith("property:") ?? false;
  const shape = needsDimension ? "grouped" : canSplit && data.dimension ? "split" : "plain";
  const topNOptions =
    shape === "split"
      ? [3, 5, catalog.limits.maxDimensionTopN]
      : [5, 10, 15, 20, 30].filter((value) => value <= catalog.limits.maxTableTopN);
  const compareAvailable =
    (widget.type === "timeseries" && !data.dimension) ||
    widget.type === "breakdown" ||
    widget.type === "metric-table";
  const groups = data.groups ?? [];
  const groupLimit =
    widget.type === "timeseries"
      ? catalog.limits.maxDimensionTopN
      : widget.type === "breakdown"
        ? catalog.limits.maxBreakdownTopN
        : catalog.limits.maxTableTopN;
  const setGroups = (next: string[]) =>
    setData({ groups: next.length ? next : undefined, topN: undefined });
  const addGroup = (raw: string) => {
    const name = raw.trim();
    if (!name || groups.includes(name) || groups.length >= groupLimit) return;
    setGroups([...groups, name]);
    setEventDraft("");
  };
  const suggestedEvents = eventNames.filter((name) => !groups.includes(name)).slice(0, 12);
  const filterKeys = (first?.filters ?? []).filter(
    (key): key is CatalogFilterKey =>
      key in filterPlaceholders &&
      key !== data.dimension &&
      !(data.dimension === "api" && (key === "apiMethod" || key === "apiUrl")),
  );

  return (
    <>
      <Field>
        <FieldLabel id={`${id}-metrics-label`}>指标</FieldLabel>
        {selected.length ? (
          <div className="flex flex-wrap gap-2" aria-label="已选指标">
            {selected.map((metric) => (
              <Badge key={metric.id} variant="outline" className="gap-1 pr-1">
                {metric.label}
                <span className="text-muted-foreground">· {unitLabels[metric.unit]}</span>
                {selected.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`移除${metric.label}`}
                    onClick={() => pick(metric)}
                  >
                    <XIcon />
                  </Button>
                ) : null}
              </Badge>
            ))}
          </div>
        ) : null}
        <div className="dashboard-metric-picker grid gap-3 rounded-lg border p-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
          <ToggleGroup
            type="single"
            orientation="vertical"
            className="flex h-fit w-full flex-row flex-wrap items-stretch sm:flex-col"
            value={family}
            onValueChange={(value) => value && setFamily(value)}
            aria-label="指标分组"
          >
            {catalog.families.map((entry) => (
              <ToggleGroupItem key={entry.id} value={entry.id} className="justify-start">
                {entry.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <ul className="grid gap-1.5" aria-labelledby={`${id}-metrics-label`}>
            {catalog.metrics
              .filter((metric) => metric.family === family)
              .map((metric) => {
                const active = data.metrics.includes(metric.id);
                // Only a multi-metric module can conflict; a single pick simply replaces.
                const reason = limit > 1 ? compatibleMetric(metric, selected, table) : null;
                return (
                  <li key={metric.id}>
                    <button
                      type="button"
                      aria-pressed={active}
                      aria-disabled={reason ? true : undefined}
                      disabled={Boolean(reason)}
                      title={reason ?? metric.description}
                      onClick={() => pick(metric)}
                      className="dashboard-metric-option flex w-full items-start justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm"
                    >
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="font-medium">{metric.label}</span>
                        <span className="text-xs text-muted-foreground">
                          {reason ?? metric.description}
                        </span>
                      </span>
                      <Badge variant="outline" className="shrink-0">
                        {unitLabels[metric.unit]}
                      </Badge>
                    </button>
                  </li>
                );
              })}
          </ul>
        </div>
        <FieldDescription>
          {limit > 1
            ? `最多 ${limit} 个指标；${table ? "表格每列可以使用不同单位。" : "同一图表的指标需要相同单位。"}`
            : "选择一个指标。"}
          {first && first.minIntervalSeconds >= 300 ? " 错误指标按 5 分钟聚合，不会更细。" : ""}
        </FieldDescription>
      </Field>

      {first?.requiresMeasurementKey ? (
        <Field data-invalid={!data.measurement}>
          <FieldLabel htmlFor={`${id}-measurement`}>数值名称</FieldLabel>
          <Input
            id={`${id}-measurement`}
            list={`${id}-measurements`}
            maxLength={64}
            placeholder="如 amount、items"
            value={data.measurement ?? ""}
            aria-invalid={!data.measurement}
            onChange={(event) => setData({ measurement: event.target.value || undefined })}
          />
          <datalist id={`${id}-measurements`}>
            {measurementNames.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          <FieldDescription>
            自定义事件 measurements 里的键。可输入尚未出现的名称。
          </FieldDescription>
        </Field>
      ) : null}

      {needsDimension || canSplit ? (
        <Field>
          <FieldLabel htmlFor={`${id}-dimension`}>
            {needsDimension ? "分组维度" : "按维度拆分"}
          </FieldLabel>
          <Select
            value={property ? "property" : (data.dimension ?? "none")}
            onValueChange={(value) =>
              setData({
                dimension:
                  value === "none" ? undefined : value === "property" ? "property:" : value,
                topN: undefined,
                // Pinned values belong to the dimension they were picked from.
                groups: value === data.dimension ? data.groups : undefined,
              })
            }
          >
            <SelectTrigger id={`${id}-dimension`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {canSplit ? <SelectItem value="none">不拆分</SelectItem> : null}
                {dimensions.map((dimension) => (
                  <SelectItem key={dimension} value={dimension}>
                    {catalogDimensionLabels[dimension] ?? dimension}
                  </SelectItem>
                ))}
                {first?.propertyDimensions ? (
                  <SelectItem value="property">自定义属性</SelectItem>
                ) : null}
              </SelectGroup>
            </SelectContent>
          </Select>
          {canSplit && data.dimension ? (
            <FieldDescription>
              拆分后每个分组一条线，只保留一个指标，也不叠加上一周期。
            </FieldDescription>
          ) : null}
        </Field>
      ) : null}

      {property ? (
        <Field data-invalid={!/^property:[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(data.dimension ?? "")}>
          <FieldLabel htmlFor={`${id}-property`}>属性名称</FieldLabel>
          <Input
            id={`${id}-property`}
            maxLength={64}
            placeholder="如 payment、plan"
            value={(data.dimension ?? "").slice("property:".length)}
            onChange={(event) => setData({ dimension: `property:${event.target.value}` })}
          />
          <FieldDescription>
            按属性值分组；没有设置该属性的事件不计入任何分组，因此不计算占比。
          </FieldDescription>
        </Field>
      ) : null}

      {data.dimension === "eventName" ? (
        <Field>
          <FieldLabel htmlFor={`${id}-events`}>要对比的事件</FieldLabel>
          {groups.length ? (
            <ol className="flex flex-wrap gap-2" aria-label="已选事件">
              {groups.map((name) => (
                <li key={name}>
                  <Badge variant="outline" className="gap-1 pr-1">
                    {name}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`移除${name}`}
                      onClick={() => setGroups(groups.filter((entry) => entry !== name))}
                    >
                      <XIcon />
                    </Button>
                  </Badge>
                </li>
              ))}
            </ol>
          ) : null}
          <div className="flex gap-2">
            <Input
              id={`${id}-events`}
              list={`${id}-event-names`}
              maxLength={80}
              placeholder="输入或选择事件名称"
              value={eventDraft}
              disabled={groups.length >= groupLimit}
              onChange={(event) => setEventDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                addGroup(eventDraft);
              }}
            />
            <Button
              type="button"
              variant="outline"
              disabled={!eventDraft.trim() || groups.length >= groupLimit}
              onClick={() => addGroup(eventDraft)}
            >
              添加
            </Button>
          </div>
          <datalist id={`${id}-event-names`}>
            {eventNames.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          {suggestedEvents.length && groups.length < groupLimit ? (
            <div className="flex flex-wrap gap-1.5" aria-label="最近出现的事件">
              {suggestedEvents.map((name) => (
                <Button
                  key={name}
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => addGroup(name)}
                >
                  + {name}
                </Button>
              ))}
            </div>
          ) : null}
          <FieldDescription>
            {groups.length
              ? `按选择顺序展示，最多 ${groupLimit} 个；某个事件没有发生时显示为空，而不是 0。`
              : `不指定时展示次数最多的事件。指定后只看这些事件，例如发起支付、支付成功、支付失败。`}
          </FieldDescription>
        </Field>
      ) : null}

      {shape !== "plain" && !groups.length ? (
        <Field>
          <FieldLabel htmlFor={`${id}-topn`}>
            {shape === "split" ? "展示分组数" : "最多分组数"}
          </FieldLabel>
          <Select
            value={String(data.topN ?? (shape === "split" ? 5 : 10))}
            onValueChange={(value) => setData({ topN: Number(value) })}
          >
            <SelectTrigger id={`${id}-topn`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {[...new Set(topNOptions)].map((value) => (
                  <SelectItem key={value} value={String(value)}>
                    {value} 组
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <FieldDescription>超出的分组，对于可相加的指标会合并为「其他」。</FieldDescription>
        </Field>
      ) : null}

      {table && selected.length > 1 ? (
        <Field>
          <FieldLabel htmlFor={`${id}-sort`}>按哪一列取前 N 组</FieldLabel>
          <Select
            value={data.sort ?? data.metrics[0]}
            onValueChange={(value) => setData({ sort: value })}
          >
            <SelectTrigger id={`${id}-sort`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {selected.map((metric) => (
                  <SelectItem key={metric.id} value={metric.id}>
                    {metric.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <FieldDescription>表格内的排序可以在表头随时切换，不影响取哪些分组。</FieldDescription>
        </Field>
      ) : null}

      {compareAvailable ? (
        <Field orientation="horizontal">
          <Switch
            id={`${id}-compare`}
            checked={data.compare === "previous"}
            onCheckedChange={(checked) => setData({ compare: checked ? "previous" : undefined })}
          />
          <FieldLabel htmlFor={`${id}-compare`}>叠加上一周期</FieldLabel>
        </Field>
      ) : null}

      {filterKeys.length ? (
        <Field>
          <FieldLabel>模块筛选</FieldLabel>
          <div className="grid gap-3 sm:grid-cols-2">
            {filterKeys.map((key) =>
              key === "eventKind" ? (
                <label key={key} className="flex flex-col gap-1.5 text-sm">
                  <span className="text-muted-foreground">{catalogFilterLabels[key]}</span>
                  <Select
                    value={data.filters.eventKind ?? "all"}
                    onValueChange={(value) =>
                      setData({
                        filters: {
                          ...data.filters,
                          eventKind:
                            value === "all"
                              ? undefined
                              : (value as NonNullable<CatalogData["filters"]["eventKind"]>),
                        },
                      })
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="all">{filterPlaceholders.eventKind}</SelectItem>
                        {Object.entries(eventKindLabels).map(([kind, label]) => (
                          <SelectItem key={kind} value={kind}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </label>
              ) : (
                <label key={key} className="flex flex-col gap-1.5 text-sm">
                  <span className="text-muted-foreground">{catalogFilterLabels[key]}</span>
                  <Input
                    value={data.filters[key] ?? ""}
                    placeholder={filterPlaceholders[key]}
                    maxLength={key === "apiUrl" ? 2048 : key === "route" ? 512 : 128}
                    list={key === "eventName" ? `${id}-event-names` : undefined}
                    onChange={(event) =>
                      setData({
                        filters: { ...data.filters, [key]: event.target.value || undefined },
                      })
                    }
                  />
                </label>
              ),
            )}
          </div>
          <FieldDescription>
            只作用于这个模块；时间与环境跟随页面。
            {filters.release || filters.route ? " 当前链接里的版本或路由筛选会优先于这里。" : ""}
          </FieldDescription>
        </Field>
      ) : null}

      {removed.length ? (
        <p role="status" className="text-xs text-muted-foreground">
          为保持配置有效，已移除：{removed.join("、")}。
        </p>
      ) : null}
    </>
  );
}

/** Measurement keys already seen on this Project, read from the events response. */
function useMeasurementNames(
  widget: Widget,
  filters: OverviewFilters,
  userId: string,
  catalog: MetricCatalog,
) {
  const first = widget.data.source === "catalog" ? widget.data.metrics[0] : undefined;
  const needed = Boolean(
    catalog.metrics.find((metric) => metric.id === first)?.requiresMeasurementKey,
  );
  const probe: Widget = {
    id: "measurement-probe",
    type: "stat",
    version: 1,
    title: "probe",
    size: "compact",
    view: "number",
    data: { source: "events", metrics: ["estimated"], dimension: "country", eventKind: "custom" },
  };
  const maxPoints = useDashboardPointBudget();
  const options = moduleQueryOptions(probe, filters, userId, maxPoints);
  // Only a measurement metric needs the key list; other modules skip the request entirely.
  const query = useQuery({ ...options, enabled: needed && options.enabled });
  if (!needed || query.data?.source !== "events") return [];
  return query.data.result.measurements.map((measurement) => measurement.name);
}

/** Event names seen on this Project in the page range, most frequent first. */
function useEventNames(
  widget: Widget,
  filters: OverviewFilters,
  userId: string,
  catalog: MetricCatalog,
) {
  const data = widget.data.source === "catalog" ? widget.data : undefined;
  const needed =
    catalog.metrics.find((metric) => metric.id === data?.metrics[0])?.source === "behavior";
  const eventKind = data?.filters.eventKind;
  const probe: Widget = {
    id: "event-name-probe",
    type: "stat",
    version: 1,
    title: "probe",
    size: "compact",
    view: "number",
    data: { source: "events", metrics: ["estimated"], dimension: "country" },
  };
  const maxPoints = useDashboardPointBudget();
  const options = moduleQueryOptions(probe, filters, userId, maxPoints);
  const query = useQuery({ ...options, enabled: needed && options.enabled });
  if (!needed || query.data?.source !== "events") return [];
  return query.data.result.catalog
    .filter((entry) => !eventKind || entry.kind === eventKind)
    .map((entry) => entry.name);
}
