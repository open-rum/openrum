import { environmentLabel, projectEnvironments } from "@/lib/projects/environments";
/* eslint-disable react-refresh/only-export-components -- shared analysis context and toolbar are one product contract */
import {
  createContext,
  lazy,
  Fragment,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { ArrowLeftIcon, CalendarRangeIcon, ChevronRightIcon } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Project } from "@/lib/api/projects";
import { cn } from "@/lib/utils";

const RangeCalendar = lazy(() => import("./RangeCalendar"));

const DAY = 24 * 60 * 60 * 1000;
const MAX_RANGE = 30 * DAY;
const STORAGE_PREFIX = "openrum-analysis-context:";

export const analysisRangePresets = [
  { value: "5m", label: "最近 5 分钟", duration: 5 * 60 * 1000 },
  { value: "15m", label: "最近 15 分钟", duration: 15 * 60 * 1000 },
  { value: "30m", label: "最近 30 分钟", duration: 30 * 60 * 1000 },
  { value: "1h", label: "最近 1 小时", duration: 60 * 60 * 1000 },
  { value: "6h", label: "最近 6 小时", duration: 6 * 60 * 60 * 1000 },
  { value: "12h", label: "最近 12 小时", duration: 12 * 60 * 60 * 1000 },
  { value: "24h", label: "最近 24 小时", duration: DAY },
  { value: "7d", label: "最近 7 天", duration: 7 * DAY },
  { value: "30d", label: "最近 30 天", duration: MAX_RANGE },
  { value: "yesterday", label: "昨天", calendar: "yesterday" },
  { value: "day-before-yesterday", label: "前天", calendar: "day-before-yesterday" },
  { value: "same-day-last-week", label: "上周的今天", calendar: "same-day-last-week" },
  { value: "last-week", label: "上周", calendar: "last-week" },
  { value: "today", label: "今天", calendar: "today" },
  { value: "month-to-date", label: "本月", calendar: "month-to-date" },
] as const;

type AnalysisRangePreset = (typeof analysisRangePresets)[number];
type AnalysisRangePresetValue = AnalysisRangePreset["value"];

const calendarOrder = [
  "today",
  "yesterday",
  "day-before-yesterday",
  "same-day-last-week",
  "last-week",
  "month-to-date",
];
// Rolling windows and calendar periods answer different questions, so the picker lists
// them in two labelled columns, the way the Console's other menus group options.
const presetGroups = [
  {
    label: "相对时间",
    items: analysisRangePresets.filter((item) => "duration" in item),
  },
  {
    label: "日历",
    items: analysisRangePresets
      .filter((item) => "calendar" in item)
      .sort((a, b) => calendarOrder.indexOf(a.value) - calendarOrder.indexOf(b.value)),
  },
];

type AnalysisContextValue = {
  projectId: string;
  from: Date;
  to: Date;
  timePreset?: AnalysisRangePresetValue;
  environment?: string;
  update: (
    patch: Partial<Pick<AnalysisContextValue, "from" | "to" | "timePreset" | "environment">>,
  ) => void;
};

const AnalysisContext = createContext<AnalysisContextValue | null>(null);

export function isAnalysisRoute(pathname: string) {
  return (
    /^\/projects\/[^/]+\/(?:analytics(?:\/(?:events|funnels|paths|retention))?|overview(?:\/[^/]+)?|issues(?:\/[^/]+)?|performance|events|logs|apis|sessions)\/?$/.test(
      pathname,
    ) || /^\/(?:funnels|paths|retention|sessions|events|issues|performance|apis)\/?$/.test(pathname)
  );
}

export function useAnalysisContextState(project: Project | undefined, active: boolean) {
  const href = useSyncExternalStore(subscribeToLocation, currentURL, currentURL);
  const value = useMemo(() => resolveContext(project, new URL(href)), [href, project]);

  const update = useCallback(
    (patch: Partial<Pick<AnalysisContextValue, "from" | "to" | "timePreset" | "environment">>) => {
      if (!project || !value) return;
      const rangeChanged = patch.from !== undefined || patch.to !== undefined;
      const timePreset = patch.timePreset ?? (rangeChanged ? undefined : value.timePreset);
      const next = { ...value, ...patch, timePreset };
      if (timePreset) {
        const preset = findPreset(timePreset);
        if (!preset) return;
        const range = resolvePresetRange(preset, roundedMinute(new Date()));
        next.from = range.from;
        next.to = range.to;
      }
      if (!validRange(next.from, next.to)) return;
      persistContext(next);
      writeContextToURL(next, "push");
    },
    [project, value],
  );

  useEffect(() => {
    if (!active || !value) return;
    persistContext(value);
    const url = new URL(window.location.href);
    if (urlMatchesContext(url.searchParams, value)) return;
    writeContextToURL(value, "replace");
  }, [active, value]);

  useEffect(() => {
    if (!active || !value?.timePreset) return;
    const preset = findPreset(value.timePreset);
    if (!preset) return;
    let timer: number;
    let stopped = false;
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      const range = resolvePresetRange(preset, roundedMinute(new Date()));
      const next = validRange(range.from, range.to)
        ? { ...value, ...range }
        : { ...value, timePreset: undefined };
      if (
        next.timePreset === value.timePreset &&
        next.from.getTime() === value.from.getTime() &&
        next.to.getTime() === value.to.getTime()
      )
        return;
      persistContext(next);
      writeContextToURL(next, "replace");
    };
    const schedule = () => {
      timer = window.setTimeout(
        () => {
          if (stopped) return;
          refresh();
          schedule();
        },
        60_000 - (Date.now() % 60_000) + 50,
      );
    };
    schedule();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [active, value]);

  return value ? { ...value, update } : null;
}

export function AnalysisContextProvider({
  value,
  children,
}: {
  value: AnalysisContextValue | null;
  children: ReactNode;
}) {
  return <AnalysisContext.Provider value={value}>{children}</AnalysisContext.Provider>;
}

export function useAnalysisContext() {
  return useContext(AnalysisContext);
}

export function AnalysisEnvironmentFilter() {
  const context = useAnalysisContext();
  return context ? (
    <Select
      value={context.environment ?? "all"}
      onValueChange={(value) =>
        context.update({ environment: value === "all" ? undefined : value })
      }
    >
      <SelectTrigger size="sm" aria-label="分析环境" className="min-w-36 max-w-48 shrink-0">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">全部环境</SelectItem>
        {projectEnvironments.map(({ id }) => (
          <SelectItem key={id} value={id}>
            {environmentLabel(id)} · {id}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  ) : null;
}

export function AnalysisTimeFilter() {
  const context = useAnalysisContext();
  return context ? <AnalysisContextControls context={context} /> : null;
}

export function AnalysisContextControls({ context }: { context: AnalysisContextValue }) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const wide = useWideLayout();
  // On a phone the calendar sits behind one row, so the presets stay on the first screen.
  const [customOpen, setCustomOpen] = useState(false);
  // A preset under the pointer or focus previews its range on the calendar.
  const [previewPreset, setPreviewPreset] = useState<AnalysisRangePreset | null>(null);
  const [touched, setTouched] = useState(false);
  const [dateDraft, setDateDraft] = useState<DateRange>(() => ({
    from: context.from,
    to: context.to,
  }));
  const [fromTimeDraft, setFromTimeDraft] = useState(() => toTimeInput(context.from));
  const [toTimeDraft, setToTimeDraft] = useState(() => toTimeInput(context.to));
  const preset = findPreset(context.timePreset);
  const draftFrom = combineDateAndTime(dateDraft.from, fromTimeDraft);
  const draftTo = combineDateAndTime(dateDraft.to, toTimeDraft);
  const customError = touched ? validateDraft(draftFrom, draftTo) : undefined;
  const preview = previewPreset
    ? resolvePresetRange(previewPreset, roundedMinute(new Date()))
    : undefined;

  // While a preset is previewed the time fields show its bounds; an edit returns to the draft.
  const shownFrom = preview?.from ?? dateDraft.from;
  const shownTo = preview?.to ?? dateDraft.to;
  const shownFromTime = preview ? toTimeInput(preview.from) : fromTimeDraft;
  const shownToTime = preview ? toTimeInput(preview.to) : toTimeDraft;

  const openPanel = (open: boolean) => {
    if (open) {
      setDateDraft({ from: context.from, to: context.to });
      setFromTimeDraft(toTimeInput(context.from));
      setToTimeDraft(toTimeInput(context.to));
      setTouched(false);
      setPreviewPreset(null);
      setCustomOpen(false);
    }
    setPopoverOpen(open);
  };

  const applyPreset = (item: AnalysisRangePreset) => {
    if (!validRangeForPreset(item)) return;
    context.update({ timePreset: item.value });
    setPopoverOpen(false);
  };

  const summary = preview
    ? {
        caption: "预览",
        label: previewPreset!.label,
        range: formatCompactRange(preview.from, preview.to),
      }
    : touched
      ? {
          caption: "自定义：在日历上点开始和结束日期",
          label: draftFrom && draftTo ? "自定义范围" : "选择结束日期",
          range: draftFrom && draftTo ? formatCompactRange(draftFrom, draftTo) : "—",
        }
      : {
          caption: preset && wide ? "当前范围 · 点左侧选项立即生效" : "当前范围",
          label: preset?.label ?? "自定义范围",
          range: formatCompactRange(context.from, context.to),
        };

  const presetButton = (item: AnalysisRangePreset, className: string, compact = false) => {
    const available = validRangeForPreset(item);
    const selected = preset?.value === item.value;
    return (
      <button
        type="button"
        className={className}
        aria-pressed={selected}
        disabled={!available}
        title={available ? undefined : "当前月份已超过 30 天，请改用最近 30 天或自定义范围"}
        onMouseEnter={() => available && setPreviewPreset(item)}
        onFocus={() => available && setPreviewPreset(item)}
        onClick={() => applyPreset(item)}
        aria-label={compact ? item.label : undefined}
      >
        {/* Three to a row on a phone: 「最近」 is implied by the 相对时间 heading. */}
        {compact ? item.label.replace(/^最近 /, "") : item.label}
      </button>
    );
  };

  const calendar = (
    <div className="grid min-w-0 gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="grid min-w-0 gap-0.5">
          <span className="text-xs text-base-content/70">{summary.caption}</span>
          <span className="text-xl font-bold tracking-tight">{summary.label}</span>
        </div>
        <span className="badge badge-soft badge-primary font-mono">{summary.range}</span>
      </div>
      <Suspense fallback={<div className="analysis-time-popover__calendar-loading" />}>
        <RangeCalendar
          selected={preview ? { from: preview.from, to: preview.to } : dateDraft}
          onSelect={(range) => {
            setPreviewPreset(null);
            setTouched(true);
            setDateDraft(range ?? { from: undefined, to: undefined });
          }}
          defaultMonth={wide ? previousMonth(context.to) : context.to}
          months={wide ? 2 : 1}
        />
      </Suspense>
      <div className="grid grid-cols-2 gap-3 border-t border-base-300 pt-3">
        <fieldset className="fieldset py-0">
          <label className="fieldset-legend pb-1" htmlFor="analysis-range-from-time">
            开始 · {formatDraftDay(shownFrom)}
          </label>
          <input
            id="analysis-range-from-time"
            type="time"
            className={cn("input input-sm w-full", customError && "input-error")}
            value={shownFromTime}
            aria-invalid={Boolean(customError)}
            onChange={(event) => {
              setPreviewPreset(null);
              setTouched(true);
              setFromTimeDraft(event.target.value);
            }}
          />
        </fieldset>
        <fieldset className="fieldset py-0">
          <label className="fieldset-legend pb-1" htmlFor="analysis-range-to-time">
            结束 · {formatDraftDay(shownTo)}
          </label>
          <input
            id="analysis-range-to-time"
            type="time"
            className={cn("input input-sm w-full", customError && "input-error")}
            value={shownToTime}
            aria-invalid={Boolean(customError)}
            onChange={(event) => {
              setPreviewPreset(null);
              setTouched(true);
              setToTimeDraft(event.target.value);
            }}
          />
        </fieldset>
      </div>
      {customError ? (
        <p role="alert" className="text-xs text-error">
          {customError}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-base-300 py-3">
        <p className="text-xs text-base-content/70">
          {resolvedTimeZone()} · 最长 30 天 · 应用后写入当前 URL
        </p>
        <div className="flex gap-2">
          <button type="button" className="btn btn-sm" onClick={() => setPopoverOpen(false)}>
            取消
          </button>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={!touched || Boolean(customError)}
            onClick={() => {
              if (!draftFrom || !draftTo || !validRange(draftFrom, draftTo)) return;
              context.update({ from: draftFrom, to: draftTo });
              setPopoverOpen(false);
            }}
          >
            应用时间
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="analysis-context-bar__controls" role="group" aria-label="全局分析筛选">
      <div className="analysis-time-filter">
        <Popover open={popoverOpen} onOpenChange={openPanel}>
          <PopoverTrigger asChild>
            <button
              type="button"
              // Same field as the environment select beside it: daisyUI's `select` draws the arrow.
              className="analysis-time-filter__trigger select select-sm items-center gap-2 data-[state=open]:border-primary"
              aria-label={`选择时间范围，当前为 ${formatAbsoluteRange(context.from, context.to)}`}
            >
              <CalendarRangeIcon className="size-4 shrink-0 opacity-70" aria-hidden="true" />
              <span className="truncate">{preset?.label ?? "自定义"}</span>
              <span className="hidden truncate font-mono text-xs text-base-content/60 sm:inline">
                {formatCompactRange(context.from, context.to)}
              </span>
            </button>
          </PopoverTrigger>
          <PopoverContent className="analysis-time-popover" align="start" sideOffset={8}>
            {wide ? (
              <div className="grid grid-cols-[300px_minmax(0,1fr)]">
                <div
                  className="grid grid-cols-2 content-start border-r border-base-300 bg-base-200/60 p-2"
                  role="group"
                  aria-label="快捷时间范围"
                  onMouseLeave={() => setPreviewPreset(null)}
                  onBlur={() => setPreviewPreset(null)}
                >
                  {presetGroups.map((group) => (
                    <ul key={group.label} className="menu menu-sm w-full min-w-0 px-1">
                      <li className="menu-title">{group.label}</li>
                      {group.items.map((item) => (
                        <li
                          key={item.value}
                          className={cn(!validRangeForPreset(item) && "menu-disabled")}
                        >
                          {presetButton(
                            item,
                            cn("h-8", preset?.value === item.value && "menu-active"),
                          )}
                        </li>
                      ))}
                    </ul>
                  ))}
                </div>
                <div className="min-w-0 px-5 pt-4">{calendar}</div>
              </div>
            ) : customOpen ? (
              <div className="grid gap-2 p-3">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm w-fit"
                  onClick={() => setCustomOpen(false)}
                >
                  <ArrowLeftIcon className="size-4" aria-hidden="true" />
                  快捷时间范围
                </button>
                {calendar}
              </div>
            ) : (
              <div className="grid gap-3 p-3">
                <div className="grid gap-3" role="group" aria-label="快捷时间范围">
                  {presetGroups.map((group) => (
                    <div key={group.label} className="grid gap-2">
                      <span className="text-xs text-base-content/70">{group.label}</span>
                      <div className="grid grid-cols-3 gap-2">
                        {group.items.map((item) => (
                          <Fragment key={item.value}>
                            {presetButton(
                              item,
                              cn(
                                "btn btn-sm h-11 whitespace-nowrap",
                                preset?.value === item.value && "btn-primary",
                              ),
                              true,
                            )}
                          </Fragment>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <ul className="menu w-full rounded-box border border-base-300 p-0">
                  <li>
                    <button
                      type="button"
                      className="min-h-12 content-center"
                      onClick={() => setCustomOpen(true)}
                    >
                      <CalendarRangeIcon className="size-4" aria-hidden="true" />
                      <span className="grow">自定义日期和时间</span>
                      <ChevronRightIcon className="size-4 opacity-60" aria-hidden="true" />
                    </button>
                  </li>
                </ul>
              </div>
            )}
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}

const WIDE_QUERY = "(min-width: 768px)";

/** Whether the time panel has room for the presets beside a two-month calendar. */
function useWideLayout() {
  return useSyncExternalStore(
    (listener) => {
      if (typeof window.matchMedia !== "function") return () => {};
      const media = window.matchMedia(WIDE_QUERY);
      media.addEventListener?.("change", listener);
      return () => media.removeEventListener?.("change", listener);
    },
    () =>
      typeof window.matchMedia === "function"
        ? (window.matchMedia(WIDE_QUERY)?.matches ?? true)
        : true,
    () => true,
  );
}

function previousMonth(value: Date) {
  return new Date(value.getFullYear(), value.getMonth() - 1, 1);
}

function resolveContext(
  project: Project | undefined,
  url: URL,
): Omit<AnalysisContextValue, "update"> | null {
  if (!project) return null;
  const timePreset = findPreset(url.searchParams.get("timePreset"));
  const environment = cleanEnvironment(url.searchParams.get("environment"));
  if (timePreset) {
    const range = resolvePresetRange(timePreset, roundedMinute(new Date()));
    if (validRange(range.from, range.to)) {
      return { projectId: project.id, ...range, timePreset: timePreset.value, environment };
    }
  }
  const from = parseDate(url.searchParams.get("from"));
  const to = parseDate(url.searchParams.get("to"));
  if (from && to && validRange(from, to)) {
    return {
      projectId: project.id,
      from,
      to,
      environment,
    };
  }
  const stored = readStoredContext(project.id);
  if (stored) return stored;
  const defaultTo = roundedMinute(new Date());
  return {
    projectId: project.id,
    from: new Date(defaultTo.getTime() - DAY),
    to: defaultTo,
    timePreset: "24h",
    // All environments until the user picks one from the switcher.
    environment: undefined,
  };
}

function writeContextToURL(
  context: Omit<AnalysisContextValue, "update">,
  mode: "push" | "replace",
) {
  const url = new URL(window.location.href);
  url.searchParams.set("from", context.from.toISOString());
  url.searchParams.set("to", context.to.toISOString());
  if (context.timePreset) url.searchParams.set("timePreset", context.timePreset);
  else url.searchParams.delete("timePreset");
  if (context.environment) url.searchParams.set("environment", context.environment);
  else url.searchParams.delete("environment");
  url.searchParams.delete("cursor");
  url.searchParams.delete("page");
  window.history[mode === "push" ? "pushState" : "replaceState"]({}, "", url);
  window.dispatchEvent(new Event("openrum:urlchange"));
}

function formatCompactRange(from: Date, to: Date) {
  const sameDay = from.toDateString() === to.toDateString();
  const formatDateTime = (value: Date) =>
    new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(value);
  if (sameDay) {
    const endTime = new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(to);
    return `${formatDateTime(from)} – ${endTime}`;
  }
  return `${formatDateTime(from)} – ${formatDateTime(to)}`;
}

function persistContext(context: Omit<AnalysisContextValue, "update">) {
  try {
    window.localStorage.setItem(
      `${STORAGE_PREFIX}${context.projectId}`,
      JSON.stringify({
        from: context.from.toISOString(),
        to: context.to.toISOString(),
        timePreset: context.timePreset,
        environment: context.environment,
      }),
    );
  } catch {
    // URL state remains authoritative when storage is unavailable.
  }
}

function readStoredContext(projectId: string): Omit<AnalysisContextValue, "update"> | null {
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${projectId}`);
    if (!raw) return null;
    const candidate = JSON.parse(raw) as {
      from?: string;
      to?: string;
      timePreset?: string;
      environment?: string;
    };
    const timePreset = findPreset(candidate.timePreset);
    if (timePreset) {
      const range = resolvePresetRange(timePreset, roundedMinute(new Date()));
      if (validRange(range.from, range.to)) {
        return {
          projectId,
          ...range,
          timePreset: timePreset.value,
          environment: cleanEnvironment(candidate.environment ?? null),
        };
      }
    }
    const from = parseDate(candidate.from ?? null);
    const to = parseDate(candidate.to ?? null);
    if (!from || !to || !validRange(from, to)) return null;
    return {
      projectId,
      from,
      to,
      environment: cleanEnvironment(candidate.environment ?? null),
    };
  } catch {
    return null;
  }
}

function subscribeToLocation(listener: () => void) {
  window.addEventListener("popstate", listener);
  window.addEventListener("openrum:urlchange", listener);
  return () => {
    window.removeEventListener("popstate", listener);
    window.removeEventListener("openrum:urlchange", listener);
  };
}

function currentURL() {
  return window.location.href;
}

function urlMatchesContext(search: URLSearchParams, context: Omit<AnalysisContextValue, "update">) {
  const from = parseDate(search.get("from"));
  const to = parseDate(search.get("to"));
  return (
    from?.getTime() === context.from.getTime() &&
    to?.getTime() === context.to.getTime() &&
    search.get("timePreset") === (context.timePreset ?? null) &&
    cleanEnvironment(search.get("environment")) === context.environment
  );
}

function validRange(from: Date, to: Date) {
  const duration = to.getTime() - from.getTime();
  return !Number.isNaN(duration) && duration > 0 && duration <= MAX_RANGE;
}

function parseDate(value: string | null) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function cleanEnvironment(value: string | null) {
  const trimmed = value?.trim();
  return trimmed && /^[a-z][a-z0-9_-]{0,63}$/.test(trimmed) ? trimmed : undefined;
}

function findPreset(value: string | null | undefined) {
  return analysisRangePresets.find((item) => item.value === value);
}

function validRangeForPreset(item: AnalysisRangePreset) {
  const range = resolvePresetRange(item, roundedMinute(new Date()));
  return validRange(range.from, range.to);
}

function resolvePresetRange(item: AnalysisRangePreset, now: Date) {
  if ("duration" in item) return { from: new Date(now.getTime() - item.duration), to: now };

  const today = startOfLocalDay(now);
  if (item.calendar === "yesterday") {
    return { from: addLocalDays(today, -1), to: today };
  }
  if (item.calendar === "day-before-yesterday") {
    return { from: addLocalDays(today, -2), to: addLocalDays(today, -1) };
  }
  if (item.calendar === "same-day-last-week") {
    return { from: addLocalDays(today, -7), to: addLocalDays(today, -6) };
  }
  if (item.calendar === "last-week") {
    const currentWeek = addLocalDays(today, -((today.getDay() + 6) % 7));
    return { from: addLocalDays(currentWeek, -7), to: currentWeek };
  }
  if (item.calendar === "today") return { from: today, to: now };
  return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: now };
}

function startOfLocalDay(value: Date) {
  const result = new Date(value);
  result.setHours(0, 0, 0, 0);
  return result;
}

function addLocalDays(value: Date, days: number) {
  const result = new Date(value);
  result.setDate(result.getDate() + days);
  return result;
}

function roundedMinute(value: Date) {
  const result = new Date(value);
  result.setSeconds(0, 0);
  return result;
}

function toTimeInput(value: Date) {
  return `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
}

function combineDateAndTime(date: Date | undefined, time: string) {
  if (!date || !/^\d{2}:\d{2}$/.test(time)) return undefined;
  const [hours, minutes] = time.split(":").map(Number);
  const result = new Date(date);
  result.setHours(hours, minutes, 0, 0);
  return Number.isNaN(result.getTime()) ? undefined : result;
}

function validateDraft(from: Date | undefined, to: Date | undefined) {
  if (!from || !to) return "请在日历中选择完整的开始和结束日期。";
  if (to <= from) return "结束时间必须晚于开始时间。";
  if (to.getTime() - from.getTime() > MAX_RANGE) return "时间范围不能超过 30 天。";
  if (to.getTime() > Date.now() + 60_000) return "结束时间不能晚于现在。";
  return undefined;
}

/** The day a time field belongs to, so each time reads with its date beside it. */
function formatDraftDay(day: Date | undefined) {
  return day
    ? new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric" }).format(day)
    : "未选日期";
}

function formatAbsoluteRange(from: Date, to: Date) {
  const format = new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${format.format(from)} – ${format.format(to)}`;
}

function resolvedTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "本地时区";
}
