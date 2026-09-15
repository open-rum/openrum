import {
  ArrowLeftIcon,
  BracesIcon,
  ChevronRightIcon,
  Clock3Icon,
  GaugeIcon,
  Globe2Icon,
  MonitorSmartphoneIcon,
  PackageIcon,
  RouteIcon,
  SearchIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import type { SessionFilters, SessionsResponse } from "@/lib/api/sessions";

type FilterKey =
  | "signal"
  | "route"
  | "release"
  | "browser"
  | "deviceType"
  | "country"
  | "minimumEvents"
  | "minimumDuration";

type FilterOption = {
  value: string | number;
  label: string;
  count?: number;
};

const dimensions: { key: FilterKey; label: string; hint: string }[] = [
  { key: "signal", label: "关键信号", hint: "错误、API 失败、慢请求、较差体验" },
  { key: "route", label: "页面与旅程", hint: "筛选会话经过的 Route" },
  { key: "release", label: "版本", hint: "按 Release 定位回归" },
  { key: "browser", label: "浏览器", hint: "Chrome、Safari、Firefox 等" },
  { key: "deviceType", label: "设备类型", hint: "桌面端、移动端、平板" },
  { key: "country", label: "国家 / 地区", hint: "按访问来源国家筛选" },
  { key: "minimumEvents", label: "事件数量", hint: "仅显示行为较丰富的会话" },
  { key: "minimumDuration", label: "会话时长", hint: "设置最短持续时间" },
];

export function SessionFilterComposer({
  filters,
  facets,
  sessions,
  onChange,
}: {
  filters: SessionFilters;
  facets?: SessionsResponse["facets"];
  sessions?: SessionsResponse["sessions"];
  onChange: (patch: Partial<SessionFilters>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<FilterKey>();
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const tokens = filterTokens(filters);
  const options = useMemo(
    () => (active ? optionsFor(active, facets, sessions) : []),
    [active, facets, sessions],
  );
  const normalizedDraft = draft.trim().toLowerCase();
  const visibleDimensions = dimensions.filter((dimension) =>
    `${dimension.label} ${dimension.hint}`.toLowerCase().includes(normalizedDraft),
  );
  const visibleOptions = options.filter((option) =>
    option.label.toLowerCase().includes(normalizedDraft),
  );

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (
        event.key !== "/" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isEditableTarget(event.target)
      )
        return;
      event.preventDefault();
      inputRef.current?.focus();
      setOpen(true);
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  const selectDimension = (key: FilterKey) => {
    setActive(key);
    setDraft("");
    inputRef.current?.focus();
  };
  const selectValue = (key: FilterKey, value: string | number) => {
    onChange({ [key]: value });
    setActive(undefined);
    setDraft("");
    inputRef.current?.focus();
  };
  const commitDraft = () => {
    const value = draft.trim();
    if (!value) {
      setOpen(false);
      return;
    }
    if (!active) onChange({ search: value });
    else if (active === "minimumEvents" || active === "minimumDuration") {
      const number = Number(value);
      if (Number.isFinite(number) && number >= 0) onChange({ [active]: number });
    } else selectValue(active, value);
    setDraft("");
    setActive(undefined);
  };
  const removeToken = (key: keyof SessionFilters) => {
    if (key === "signal") onChange({ signal: "all" });
    else onChange({ [key]: undefined });
  };

  return (
    <div className="session-filter-composer">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <InputGroup className="h-auto min-h-[var(--control-height)] flex-wrap bg-background">
            <InputGroupAddon className="flex-wrap justify-start gap-1.5">
              <SearchIcon aria-hidden="true" />
              {tokens.map((token) => (
                <Badge key={token.key} variant="secondary" className="h-7 gap-1 pl-2.5 pr-0.5">
                  {token.label}
                  <InputGroupButton
                    size="icon-xs"
                    aria-label={`移除筛选：${token.label}`}
                    onClick={() => removeToken(token.key)}
                  >
                    <XIcon />
                  </InputGroupButton>
                </Badge>
              ))}
            </InputGroupAddon>
            <InputGroupInput
              ref={inputRef}
              className="min-w-44 flex-[1_1_12rem]"
              aria-label="搜索会话或添加筛选条件"
              aria-expanded={open}
              placeholder={active ? `输入${dimensionLabel(active)}的值…` : "搜索或添加筛选条件…"}
              value={draft}
              onFocus={() => setOpen(true)}
              onClick={() => setOpen(true)}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitDraft();
                }
                if (event.key === "Backspace" && !draft && tokens.length) {
                  removeToken(tokens.at(-1)!.key);
                }
              }}
            />
            <InputGroupAddon align="inline-end">
              <kbd>/</kbd>
            </InputGroupAddon>
          </InputGroup>
        </PopoverAnchor>

        <PopoverContent
          align="start"
          sideOffset={8}
          className="w-[min(720px,calc(100vw-2rem))] max-w-none gap-0 overflow-hidden p-0"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onFocusOutside={(event) => {
            if (event.target === inputRef.current) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            const target = event.target;
            const anchor = inputRef.current?.closest('[data-slot="input-group"]');
            if (target instanceof Node && anchor?.contains(target)) event.preventDefault();
          }}
        >
          {active ? (
            <>
              <PopoverHeader className="flex-row items-center gap-3 p-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="返回筛选条件"
                  onClick={() => {
                    setActive(undefined);
                    setDraft("");
                    inputRef.current?.focus();
                  }}
                >
                  <ArrowLeftIcon />
                </Button>
                <div>
                  <PopoverTitle>{dimensionLabel(active)}</PopoverTitle>
                  <PopoverDescription>选择一个值，或在搜索框输入自定义值。</PopoverDescription>
                </div>
              </PopoverHeader>
              <Separator />
              <div className="grid max-h-72 gap-1 overflow-y-auto p-2 sm:grid-cols-2">
                {visibleOptions.map((option) => (
                  <Button
                    key={`${active}:${option.value}`}
                    type="button"
                    variant="ghost"
                    className="h-auto min-h-11 justify-start px-3 py-2 text-left whitespace-normal"
                    onClick={() => selectValue(active, option.value)}
                  >
                    <span className="min-w-0 flex-1">
                      <strong className="block font-medium">{option.label}</strong>
                      {option.count !== undefined ? (
                        <small className="text-muted-foreground">
                          {option.count.toLocaleString()} 个会话
                        </small>
                      ) : null}
                    </span>
                    <ChevronRightIcon data-icon="inline-end" />
                  </Button>
                ))}
                {visibleOptions.length === 0 ? (
                  <p className="col-span-full px-3 py-8 text-center text-sm text-muted-foreground">
                    没有匹配的建议值，可直接按 Enter 使用当前输入。
                  </p>
                ) : null}
              </div>
            </>
          ) : (
            <>
              <PopoverHeader className="p-3">
                <PopoverTitle>添加筛选条件</PopoverTitle>
                <PopoverDescription>
                  条件会显示在搜索框内；可继续组合多个条件。
                </PopoverDescription>
              </PopoverHeader>
              <div className="flex flex-wrap gap-2 px-3 pb-3">
                <Button type="button" size="sm" variant="secondary" onClick={() => onChange({ signal: "error" })}>
                  有错误
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => onChange({ signal: "api_failure" })}>
                  API 失败
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => onChange({ signal: "poor_vital" })}>
                  体验较差
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => onChange({ deviceType: "mobile" })}>
                  移动端
                </Button>
              </div>
              <Separator />
              <div className="grid max-h-80 gap-1 overflow-y-auto p-2 sm:grid-cols-2">
                {visibleDimensions.map((dimension) => (
                  <Button
                    key={dimension.key}
                    type="button"
                    variant="ghost"
                    className="h-auto min-h-14 justify-start gap-3 px-3 py-2 text-left whitespace-normal"
                    onClick={() => selectDimension(dimension.key)}
                  >
                    <DimensionIcon filterKey={dimension.key} />
                    <span className="min-w-0 flex-1">
                      <strong className="block font-medium">{dimension.label}</strong>
                      <small className="text-muted-foreground">{dimension.hint}</small>
                    </span>
                    <ChevronRightIcon data-icon="inline-end" />
                  </Button>
                ))}
                {visibleDimensions.length === 0 ? (
                  <p className="col-span-full px-3 py-8 text-center text-sm text-muted-foreground">
                    按 Enter 将当前内容作为关键词搜索。
                  </p>
                ) : null}
              </div>
            </>
          )}
          <Separator />
          <div className="flex items-center justify-between gap-3 px-3 py-2 text-xs text-muted-foreground">
            <span>{active ? "选择建议值或输入自定义值" : "输入可搜索条件或全文内容"}</span>
            <span>Enter 添加 · Esc 关闭</span>
          </div>
        </PopoverContent>
      </Popover>
      <Button type="button" onClick={commitDraft}>
        查询
      </Button>
    </div>
  );
}

function DimensionIcon({ filterKey }: { filterKey: FilterKey }) {
  if (filterKey === "signal") return <TriangleAlertIcon aria-hidden="true" />;
  if (filterKey === "route") return <RouteIcon aria-hidden="true" />;
  if (filterKey === "release") return <PackageIcon aria-hidden="true" />;
  if (filterKey === "browser" || filterKey === "deviceType")
    return <MonitorSmartphoneIcon aria-hidden="true" />;
  if (filterKey === "country") return <Globe2Icon aria-hidden="true" />;
  if (filterKey === "minimumEvents") return <BracesIcon aria-hidden="true" />;
  if (filterKey === "minimumDuration") return <Clock3Icon aria-hidden="true" />;
  return <GaugeIcon aria-hidden="true" />;
}

function filterTokens(filters: SessionFilters) {
  const tokens: { key: keyof SessionFilters; label: string }[] = [];
  if (filters.search) tokens.push({ key: "search", label: `关键词：${filters.search}` });
  if (filters.signal !== "all")
    tokens.push({ key: "signal", label: signalLabel(filters.signal) });
  if (filters.route) tokens.push({ key: "route", label: `Route：${filters.route}` });
  if (filters.release) tokens.push({ key: "release", label: `版本：${filters.release}` });
  if (filters.browser) tokens.push({ key: "browser", label: `浏览器：${filters.browser}` });
  if (filters.deviceType)
    tokens.push({ key: "deviceType", label: `设备：${filters.deviceType}` });
  if (filters.country) tokens.push({ key: "country", label: `国家：${filters.country}` });
  if (filters.minimumEvents)
    tokens.push({ key: "minimumEvents", label: `事件 ≥ ${filters.minimumEvents}` });
  if (filters.minimumDuration)
    tokens.push({ key: "minimumDuration", label: `时长 ≥ ${filters.minimumDuration}s` });
  return tokens;
}

function optionsFor(
  key: FilterKey,
  facets?: SessionsResponse["facets"],
  sessions?: SessionsResponse["sessions"],
): FilterOption[] {
  if (key === "signal")
    return [
      { value: "error", label: "发生错误" },
      { value: "api_failure", label: "API 失败" },
      { value: "slow_api", label: "慢请求 ≥ 1s" },
      { value: "poor_vital", label: "体验评分较差" },
    ];
  if (key === "minimumEvents")
    return [5, 10, 20, 50].map((value) => ({ value, label: `至少 ${value} 个事件` }));
  if (key === "minimumDuration")
    return [30, 60, 300, 600].map((value) => ({
      value,
      label: value < 60 ? `至少 ${value} 秒` : `至少 ${value / 60} 分钟`,
    }));
  if (key === "route") {
    const routes = new Set(
      sessions?.flatMap((session) => [session.entryRoute, session.exitRoute]).filter(Boolean),
    );
    return [...routes].map((value) => ({ value: value!, label: value! }));
  }
  const source =
    key === "release"
      ? facets?.releases
      : key === "browser"
        ? facets?.browsers
        : key === "deviceType"
          ? facets?.deviceTypes
          : facets?.countries;
  return (source ?? [])
    .filter((option) => option.value)
    .map((option) => ({ value: option.value, label: option.value, count: option.sessions }));
}

function signalLabel(signal: SessionFilters["signal"]) {
  return {
    all: "全部信号",
    error: "发生错误",
    api_failure: "API 失败",
    slow_api: "慢请求 ≥ 1s",
    poor_vital: "体验评分较差",
  }[signal];
}

function dimensionLabel(key: FilterKey) {
  return dimensions.find((dimension) => dimension.key === key)?.label ?? "筛选条件";
}

function isEditableTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}
