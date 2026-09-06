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
import { CalendarRangeIcon, ServerIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Project } from "@/lib/api/projects";

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
  { value: "14d", label: "最近 14 天", duration: 14 * DAY },
  { value: "30d", label: "最近 30 天", duration: MAX_RANGE },
] as const;

type AnalysisContextValue = {
  projectId: string;
  from: Date;
  to: Date;
  environment?: string;
  update: (patch: Partial<Pick<AnalysisContextValue, "from" | "to" | "environment">>) => void;
};

const AnalysisContext = createContext<AnalysisContextValue | null>(null);

export function isAnalysisRoute(pathname: string) {
  return (
    /^\/projects\/[^/]+\/(?:analytics(?:\/(?:funnels|paths|retention))?|overview|issues(?:\/[^/]+)?|performance|events|apis|sessions)\/?$/.test(
      pathname,
    ) || /^\/(?:funnels|paths|retention|sessions|events|issues|performance|apis)\/?$/.test(pathname)
  );
}

export function useAnalysisContextState(project: Project | undefined, active: boolean) {
  const href = useSyncExternalStore(subscribeToLocation, currentURL, currentURL);
  const value = useMemo(() => resolveContext(project, new URL(href)), [href, project]);

  const update = useCallback(
    (patch: Partial<Pick<AnalysisContextValue, "from" | "to" | "environment">>) => {
      if (!project || !value) return;
      const next = { ...value, ...patch };
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
    if (validURLRange(url.searchParams)) return;
    writeContextToURL(value, "replace");
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

export function AnalysisContextControls({
  context,
  project,
}: {
  context: AnalysisContextValue;
  project: Project;
}) {
  const [customOpen, setCustomOpen] = useState(false);
  const [fromDraft, setFromDraft] = useState(() => toLocalInput(context.from));
  const [toDraft, setToDraft] = useState(() => toLocalInput(context.to));
  const preset = matchingPreset(context.from, context.to);
  const customError = validateDraft(fromDraft, toDraft);
  const environments = [...new Set([project.environment, "production", "test"])];

  const openCustomRange = () => {
    setFromDraft(toLocalInput(context.from));
    setToDraft(toLocalInput(context.to));
    setCustomOpen(true);
  };

  return (
    <>
      <div className="analysis-context-bar__title">
        <span>分析范围</span>
        <small>切换页面时保持</small>
      </div>
      <div className="analysis-context-bar__controls" role="group" aria-label="全局分析筛选">
        <div className="analysis-context-control">
          <CalendarRangeIcon aria-hidden="true" />
          <span>时间</span>
          <Select
            value={preset?.value ?? "custom"}
            onValueChange={(value) => {
              if (value === "custom") return openCustomRange();
              const selected = analysisRangePresets.find((item) => item.value === value);
              if (!selected) return;
              const to = roundedMinute(new Date());
              context.update({ from: new Date(to.getTime() - selected.duration), to });
            }}
          >
            <SelectTrigger size="sm" aria-label="全局时间范围">
              <SelectValue>
                {preset?.label ?? formatAbsoluteRange(context.from, context.to)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent align="start">
              <SelectGroup>
                {analysisRangePresets.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
                <SelectItem value="custom">自定义绝对时间…</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <div className="analysis-context-control">
          <ServerIcon aria-hidden="true" />
          <span>环境</span>
          <Select
            value={context.environment ?? "all"}
            onValueChange={(value) =>
              context.update({ environment: value === "all" ? undefined : value })
            }
          >
            <SelectTrigger size="sm" aria-label="全局环境">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectGroup>
                <SelectItem value="all">全部环境</SelectItem>
                {environments.map((environment) => (
                  <SelectItem key={environment} value={environment}>
                    {environmentLabel(environment)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Dialog open={customOpen} onOpenChange={setCustomOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>自定义时间范围</DialogTitle>
            <DialogDescription>
              使用本地时区 {resolvedTimeZone()}，最长可查询 30 天。
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field data-invalid={Boolean(customError)}>
              <FieldLabel htmlFor="analysis-range-from">开始时间</FieldLabel>
              <Input
                id="analysis-range-from"
                type="datetime-local"
                value={fromDraft}
                max={toDraft}
                aria-invalid={Boolean(customError)}
                onChange={(event) => setFromDraft(event.target.value)}
              />
            </Field>
            <Field data-invalid={Boolean(customError)}>
              <FieldLabel htmlFor="analysis-range-to">结束时间</FieldLabel>
              <Input
                id="analysis-range-to"
                type="datetime-local"
                value={toDraft}
                min={fromDraft}
                aria-invalid={Boolean(customError)}
                onChange={(event) => setToDraft(event.target.value)}
              />
              <FieldDescription>绝对时间会保留在 URL 中，方便分享同一分析范围。</FieldDescription>
              <FieldError>{customError}</FieldError>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCustomOpen(false)}>
              取消
            </Button>
            <Button
              type="button"
              disabled={Boolean(customError)}
              onClick={() => {
                const from = new Date(fromDraft);
                const to = new Date(toDraft);
                if (!validRange(from, to)) return;
                context.update({ from, to });
                setCustomOpen(false);
              }}
            >
              应用时间
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function resolveContext(
  project: Project | undefined,
  url: URL,
): Omit<AnalysisContextValue, "update"> | null {
  if (!project) return null;
  const from = parseDate(url.searchParams.get("from"));
  const to = parseDate(url.searchParams.get("to"));
  if (from && to && validRange(from, to)) {
    return {
      projectId: project.id,
      from,
      to,
      environment: cleanEnvironment(url.searchParams.get("environment")),
    };
  }
  const stored = readStoredContext(project.id);
  if (stored) return stored;
  const defaultTo = roundedMinute(new Date());
  return {
    projectId: project.id,
    from: new Date(defaultTo.getTime() - DAY),
    to: defaultTo,
    environment: project.environment,
  };
}

function writeContextToURL(
  context: Omit<AnalysisContextValue, "update">,
  mode: "push" | "replace",
) {
  const url = new URL(window.location.href);
  url.searchParams.set("from", context.from.toISOString());
  url.searchParams.set("to", context.to.toISOString());
  if (context.environment) url.searchParams.set("environment", context.environment);
  else url.searchParams.delete("environment");
  url.searchParams.delete("cursor");
  url.searchParams.delete("page");
  window.history[mode === "push" ? "pushState" : "replaceState"]({}, "", url);
  window.dispatchEvent(new Event("openrum:urlchange"));
}

function persistContext(context: Omit<AnalysisContextValue, "update">) {
  try {
    window.localStorage.setItem(
      `${STORAGE_PREFIX}${context.projectId}`,
      JSON.stringify({
        from: context.from.toISOString(),
        to: context.to.toISOString(),
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
    const candidate = JSON.parse(raw) as { from?: string; to?: string; environment?: string };
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

function validURLRange(search: URLSearchParams) {
  const from = parseDate(search.get("from"));
  const to = parseDate(search.get("to"));
  return Boolean(from && to && validRange(from, to));
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

function matchingPreset(from: Date, to: Date) {
  const duration = to.getTime() - from.getTime();
  const nearNow = Math.abs(roundedMinute(new Date()).getTime() - to.getTime()) <= 2 * 60 * 1000;
  return nearNow ? analysisRangePresets.find((item) => item.duration === duration) : undefined;
}

function roundedMinute(value: Date) {
  const result = new Date(value);
  result.setSeconds(0, 0);
  return result;
}

function toLocalInput(value: Date) {
  const offset = value.getTimezoneOffset() * 60 * 1000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 16);
}

function validateDraft(fromValue: string, toValue: string) {
  if (!fromValue || !toValue) return "请选择完整的开始和结束时间。";
  const from = new Date(fromValue);
  const to = new Date(toValue);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return "时间格式无效。";
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

function environmentLabel(value: string) {
  if (value === "production") return "Production";
  if (value === "test") return "Test";
  return value;
}
