/* eslint-disable react-refresh/only-export-components -- shared analysis context and toolbar are one product contract */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { ArrowLeftIcon, CalendarRangeIcon, CheckIcon, ChevronRightIcon } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { zhCN } from "react-day-picker/locale";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import type { Project } from "@/lib/api/projects";
import { cn } from "@/lib/utils";

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
    /^\/projects\/[^/]+\/(?:analytics(?:\/(?:funnels|paths|retention))?|overview(?:\/[^/]+)?|issues(?:\/[^/]+)?|performance|events|logs|apis|sessions)\/?$/.test(
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

export function AnalysisTimeFilter() {
  const context = useAnalysisContext();
  return context ? <AnalysisContextControls context={context} /> : null;
}

export function AnalysisContextControls({ context }: { context: AnalysisContextValue }) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [view, setView] = useState<"presets" | "custom">("presets");
  const [dateDraft, setDateDraft] = useState<DateRange>(() => ({
    from: context.from,
    to: context.to,
  }));
  const [fromTimeDraft, setFromTimeDraft] = useState(() => toTimeInput(context.from));
  const [toTimeDraft, setToTimeDraft] = useState(() => toTimeInput(context.to));
  const preset = findPreset(context.timePreset);
  const draftFrom = combineDateAndTime(dateDraft.from, fromTimeDraft);
  const draftTo = combineDateAndTime(dateDraft.to, toTimeDraft);
  const customError = validateDraft(draftFrom, draftTo);

  const resetDraft = () => {
    setDateDraft({ from: context.from, to: context.to });
    setFromTimeDraft(toTimeInput(context.from));
    setToTimeDraft(toTimeInput(context.to));
  };

  const applyPreset = (item: AnalysisRangePreset) => {
    if (!validRangeForPreset(item)) return;
    context.update({ timePreset: item.value });
    setPopoverOpen(false);
  };

  return (
    <div className="analysis-context-bar__controls" role="group" aria-label="全局分析筛选">
      <div className="analysis-time-filter">
        <Popover
          open={popoverOpen}
          onOpenChange={(open) => {
            if (open) setView("presets");
            setPopoverOpen(open);
          }}
        >
          <PopoverTrigger asChild>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="analysis-time-filter__trigger"
              aria-label={`选择时间范围，当前为 ${formatAbsoluteRange(context.from, context.to)}`}
            >
              <CalendarRangeIcon data-icon="inline-start" aria-hidden="true" />
              <span>{preset?.label ?? formatCompactRange(context.from, context.to)}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className={cn(
              "analysis-time-popover",
              view === "presets"
                ? "analysis-time-popover--presets"
                : "analysis-time-popover--custom",
            )}
            align="start"
            sideOffset={8}
          >
            {view === "presets" ? (
              <>
                <div
                  className="analysis-time-popover__presets"
                  role="group"
                  aria-label="快捷时间范围"
                >
                  {presetGroups.map((group) => (
                    <div key={group.label} className="analysis-time-popover__column">
                      <p className="analysis-time-popover__label">{group.label}</p>
                      {group.items.map((item) => {
                        const available = validRangeForPreset(item);
                        const selected = preset?.value === item.value;
                        return (
                          <button
                            key={item.value}
                            type="button"
                            className="analysis-time-popover__item"
                            aria-pressed={selected}
                            disabled={!available}
                            title={
                              available
                                ? undefined
                                : "当前月份已超过 30 天，请改用最近 30 天或自定义范围"
                            }
                            onClick={() => applyPreset(item)}
                          >
                            <span>{item.label}</span>
                            {selected ? <CheckIcon aria-hidden="true" /> : null}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
                <Separator />
                <div className="analysis-time-popover__custom">
                  <button
                    type="button"
                    className="analysis-time-popover__item"
                    aria-pressed={!preset}
                    onClick={() => {
                      resetDraft();
                      setView("custom");
                    }}
                  >
                    <span>自定义</span>
                    {!preset ? (
                      <span className="analysis-time-popover__current" aria-hidden="true">
                        {formatCompactRange(context.from, context.to)}
                      </span>
                    ) : null}
                    <ChevronRightIcon aria-hidden="true" />
                  </button>
                </div>
              </>
            ) : (
              <>
                <PopoverHeader className="analysis-time-popover__header">
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label="返回快捷时间范围"
                    onClick={() => setView("presets")}
                  >
                    <ArrowLeftIcon />
                  </Button>
                  <div>
                    <PopoverTitle>自定义时间范围</PopoverTitle>
                    <PopoverDescription>
                      {resolvedTimeZone()} · 最长 30 天 · 应用后会写入当前 URL
                    </PopoverDescription>
                  </div>
                </PopoverHeader>
                <Separator />
                <div className="analysis-time-popover__calendar">
                  <Calendar
                    mode="range"
                    selected={dateDraft}
                    onSelect={(range) => setDateDraft(range ?? { from: undefined, to: undefined })}
                    numberOfMonths={2}
                    max={30}
                    defaultMonth={context.from}
                    locale={zhCN}
                    className="analysis-time-popover__calendar-grid"
                  />
                  <Separator />
                  <FieldGroup className="analysis-time-popover__times">
                    <Field data-invalid={Boolean(customError)}>
                      <FieldLabel htmlFor="analysis-range-from-time">开始时间</FieldLabel>
                      <Input
                        id="analysis-range-from-time"
                        type="time"
                        value={fromTimeDraft}
                        aria-invalid={Boolean(customError)}
                        onChange={(event) => setFromTimeDraft(event.target.value)}
                      />
                    </Field>
                    <Field data-invalid={Boolean(customError)}>
                      <FieldLabel htmlFor="analysis-range-to-time">结束时间</FieldLabel>
                      <Input
                        id="analysis-range-to-time"
                        type="time"
                        value={toTimeDraft}
                        aria-invalid={Boolean(customError)}
                        onChange={(event) => setToTimeDraft(event.target.value)}
                      />
                    </Field>
                  </FieldGroup>
                  <div className="analysis-time-popover__footer">
                    <FieldError>{customError}</FieldError>
                    <div>
                      <Button type="button" variant="outline" onClick={() => setPopoverOpen(false)}>
                        取消
                      </Button>
                      <Button
                        type="button"
                        disabled={Boolean(customError)}
                        onClick={() => {
                          if (!draftFrom || !draftTo || !validRange(draftFrom, draftTo)) return;
                          context.update({ from: draftFrom, to: draftTo });
                          setPopoverOpen(false);
                        }}
                      >
                        应用时间
                      </Button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
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
  return undefined;
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
