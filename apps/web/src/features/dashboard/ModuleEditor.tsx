import { useEffect, useState } from "react";
import { ArrowLeftIcon, PlusIcon } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { OverviewFilters } from "@/lib/filters/schema";
import { moduleRegistry } from "./registry";
import { ModuleContent } from "./ModuleContent";
import { useMetricCatalog, useModulePreview } from "./queries";
import { validateCatalogWidget } from "./catalogRules";
import {
  availableEntries,
  libraryDomains,
  type LibraryDomain,
  type LibraryEntry,
  type LibraryPreview,
} from "./library";
import { widgetSchema, widgetDescription, type Widget } from "./model";

export default function ModuleEditor({
  initial,
  filters,
  userId,
  onApply,
  onClose,
}: {
  initial?: Widget;
  filters: OverviewFilters;
  userId: string;
  onApply: (widget: Widget) => void;
  onClose: () => void;
}) {
  const [widget, setWidget] = useState<Widget | null>(initial ?? null);
  const [discard, setDiscard] = useState(false);
  const [search, setSearch] = useState("");
  const [domain, setDomain] = useState<LibraryDomain | "recommended">("recommended");
  const catalogQuery = useMetricCatalog(filters.projectId, userId);
  const catalog = catalogQuery.data;
  const dirty = widget !== null && JSON.stringify(widget) !== JSON.stringify(initial ?? null);
  const parsed = widget ? widgetSchema.safeParse(widget) : undefined;
  // Structure first, then the catalog's own rules — the same order the API checks them in.
  const catalogReason =
    parsed?.success && parsed.data.data.source === "catalog"
      ? catalog
        ? validateCatalogWidget(parsed.data, catalog)
        : "正在加载指标目录…"
      : null;
  const ready = Boolean(parsed?.success) && catalogReason === null;
  const definition = widget ? moduleRegistry[widget.type] : undefined;
  const Editor = definition?.Editor;
  const query = search.trim().toLowerCase();
  // A search looks across every domain; otherwise the selected domain decides.
  const entries = availableEntries(catalog).filter((entry) =>
    query
      ? `${entry.name}${entry.description}`.toLowerCase().includes(query)
      : domain === "recommended"
        ? entry.recommended
        : entry.domain === domain,
  );
  const domainLabel = (id: LibraryDomain) =>
    libraryDomains.find((entry) => entry.id === id)?.label ?? id;
  const close = () => (dirty ? setDiscard(true) : onClose());
  return (
    <>
      <Sheet
        open
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <SheetContent style={{ width: "min(100vw, 1040px)", maxWidth: "none" }}>
          <SheetHeader className="shrink-0 pr-12">
            <SheetTitle>{widget ? (initial ? "配置模块" : "添加模块") : "模块库"}</SheetTitle>
            <SheetDescription>
              {widget
                ? "配置数据与展示，预览后添加到仪表盘草稿。"
                : "选择你关心的数据，组合自己的仪表盘。"}
            </SheetDescription>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 pb-4">
            {!widget ? (
              <div className="dashboard-library grid min-h-0 gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
                <ToggleGroup
                  type="single"
                  orientation="vertical"
                  className="dashboard-library-domains flex h-fit w-full flex-row items-stretch overflow-x-auto sm:flex-col sm:overflow-visible"
                  value={query ? "" : domain}
                  onValueChange={(value) => {
                    if (!value) return;
                    setDomain(value as LibraryDomain | "recommended");
                    setSearch("");
                  }}
                  aria-label="模块分类"
                >
                  {libraryDomains.map((entry) => (
                    <ToggleGroupItem
                      key={entry.id}
                      value={entry.id}
                      className={`justify-start whitespace-nowrap${entry.id === "custom" ? " dashboard-library-custom" : ""}`}
                    >
                      {entry.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <div className="flex min-w-0 flex-col gap-4">
                  <Input
                    aria-label="搜索模块"
                    placeholder="搜索会话、慢 API、错误类型…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  {!catalog ? (
                    <p role="status" className="text-sm text-muted-foreground">
                      {catalogQuery.isError ? (
                        <>
                          暂时无法加载指标目录，部分模块稍后可用。
                          <Button
                            variant="link"
                            size="sm"
                            onClick={() => void catalogQuery.refetch()}
                          >
                            重试
                          </Button>
                        </>
                      ) : (
                        "正在加载指标目录…"
                      )}
                    </p>
                  ) : null}
                  {domain === "custom" && !query ? (
                    <p className="text-sm text-muted-foreground">
                      从空白模块开始，自己选择指标、维度和展示方式。
                    </p>
                  ) : null}
                  <div className="grid gap-3 sm:grid-cols-2">
                    {entries.map((entry) => (
                      <LibraryCard
                        key={entry.id}
                        entry={entry}
                        domainLabel={query ? domainLabel(entry.domain) : undefined}
                        onPick={() => setWidget(entry.create())}
                      />
                    ))}
                  </div>
                  {!entries.length && (catalog || query) ? (
                    <Empty>
                      <EmptyHeader>
                        <EmptyTitle>没有匹配的模块</EmptyTitle>
                      </EmptyHeader>
                    </Empty>
                  ) : null}
                </div>
              </div>
            ) : (
              <>
                {!initial ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-fit"
                    onClick={() => setWidget(null)}
                  >
                    <ArrowLeftIcon data-icon="inline-start" />
                    返回模块库
                  </Button>
                ) : null}
                {Editor && definition ? (
                  <Editor
                    widget={widget}
                    onChange={setWidget}
                    filters={filters}
                    userId={userId}
                    sizes={definition.sizes}
                    views={definition.views}
                  />
                ) : null}
                {parsed?.success && catalogReason === null ? (
                  <Preview widget={parsed.data} filters={filters} userId={userId} />
                ) : (
                  <p role="status" className="text-sm text-destructive">
                    {parsed && !parsed.success
                      ? parsed.error.issues[0]?.message
                      : (catalogReason ?? "请完成模块配置。")}
                  </p>
                )}
              </>
            )}
          </div>
          <SheetFooter className="shrink-0 border-t">
            {widget ? (
              <Button
                disabled={!ready}
                onClick={() => {
                  if (parsed?.success && ready) onApply(parsed.data);
                }}
              >
                <PlusIcon data-icon="inline-start" />
                {initial ? "应用修改" : "添加到仪表盘"}
              </Button>
            ) : null}
            <Button variant="outline" onClick={close}>
              取消
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
      <AlertDialog open={discard} onOpenChange={setDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>放弃这个模块的修改？</AlertDialogTitle>
            <AlertDialogDescription>尚未应用到仪表盘的模块配置将被丢弃。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>继续配置</AlertDialogCancel>
            <AlertDialogAction onClick={onClose}>放弃修改</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function Preview({
  widget,
  filters,
  userId,
}: {
  widget: Widget;
  filters: OverviewFilters;
  userId: string;
}) {
  const [debounced, setDebounced] = useState(widget);
  const serialized = JSON.stringify(widget);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(JSON.parse(serialized) as Widget), 300);
    return () => window.clearTimeout(timer);
  }, [serialized]);
  const query = useModulePreview(debounced, filters, userId);
  return (
    <section className="flex flex-col gap-3" aria-label="模块实时预览">
      <p className="text-xs text-muted-foreground">实时数据预览 · 跟随当前时间和环境</p>
      <Card className={debounced.type === "stat" ? "relative isolate" : undefined}>
        <CardHeader className="relative z-10">
          <CardTitle>{debounced.title}</CardTitle>
          <CardDescription>{widgetDescription(debounced)}</CardDescription>
        </CardHeader>
        <CardContent>
          <ModuleContent record={debounced} query={query} filters={filters} />
        </CardContent>
      </Card>
    </section>
  );
}

function LibraryCard({
  entry,
  domainLabel,
  onPick,
}: {
  entry: LibraryEntry;
  domainLabel?: string;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className="dashboard-catalog-item text-left"
      aria-label={`添加${entry.name}`}
      data-library-entry={entry.id}
    >
      <Card className="h-full">
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2">
            <span>{entry.name}</span>
            {domainLabel ? (
              <span className="text-xs font-normal text-muted-foreground">{domainLabel}</span>
            ) : null}
          </CardTitle>
          <CardDescription>{entry.description}</CardDescription>
        </CardHeader>
        <CardContent className="mt-auto">
          <ModuleMiniature preview={entry.preview} />
        </CardContent>
      </Card>
    </button>
  );
}

function ModuleMiniature({ preview }: { preview: LibraryPreview }) {
  return (
    <svg viewBox="0 0 180 64" className="h-16 w-full text-primary" aria-hidden="true">
      {preview === "donut" ? (
        <>
          <circle
            cx="34"
            cy="32"
            r="23"
            fill="none"
            stroke="currentColor"
            strokeWidth="12"
            opacity="0.16"
          />
          <circle
            cx="34"
            cy="32"
            r="23"
            fill="none"
            stroke="currentColor"
            strokeWidth="12"
            strokeDasharray="92 145"
            transform="rotate(-90 34 32)"
          />
          {[0, 1, 2].map((index) => (
            <g key={index} opacity={0.7 - index * 0.2}>
              <circle cx="86" cy={12 + index * 20} r="3" fill="currentColor" />
              <rect
                x="96"
                y={9 + index * 20}
                width={72 - index * 15}
                height="6"
                rx="3"
                fill="currentColor"
              />
            </g>
          ))}
        </>
      ) : preview === "stat" ? (
        <>
          <rect x="0" y="8" width="84" height="24" rx="4" fill="currentColor" opacity="0.6" />
          <rect x="0" y="44" width="44" height="6" rx="3" fill="currentColor" opacity="0.2" />
          <path
            d="M112 40L126 30L140 34L154 20L168 24L180 12"
            stroke="currentColor"
            strokeWidth="2"
            fill="none"
            opacity="0.5"
          />
        </>
      ) : preview === "line" ? (
        <>
          <path
            d="M0 52L20 39L40 44L60 25L80 31L100 14L120 22L140 6L160 13L180 2V64H0Z"
            fill="currentColor"
            opacity="0.1"
          />
          <path
            d="M0 52L20 39L40 44L60 25L80 31L100 14L120 22L140 6L160 13L180 2"
            stroke="currentColor"
            fill="none"
            strokeWidth="2"
          />
        </>
      ) : preview === "stacked" ? (
        <>
          <path
            d="M0 64L0 44L30 40L60 42L90 34L120 36L150 28L180 30V64Z"
            fill="currentColor"
            opacity="0.55"
          />
          <path
            d="M0 44L30 40L60 42L90 34L120 36L150 28L180 30L180 18L150 16L120 24L90 20L60 26L30 22L0 28Z"
            fill="currentColor"
            opacity="0.3"
          />
          <path
            d="M0 28L30 22L60 26L90 20L120 24L150 16L180 18L180 8L150 6L120 12L90 8L60 14L30 10L0 16Z"
            fill="currentColor"
            opacity="0.14"
          />
        </>
      ) : preview === "bars" ? (
        [150, 110, 78, 42].map((width, index) => (
          <rect
            key={index}
            x="0"
            y={index * 16}
            width={width}
            height="9"
            rx="3"
            fill="currentColor"
            opacity={0.65 - index * 0.12}
          />
        ))
      ) : preview === "matrix" ? (
        [0, 1, 2, 3].map((row) => (
          <g key={row} opacity={0.65 - row * 0.12}>
            <rect x="0" y={row * 16 + 2} width="46" height="7" rx="3" fill="currentColor" />
            {[70, 110, 150].map((x) => (
              <rect
                key={x}
                x={x}
                y={row * 16 + 2}
                width="28"
                height="7"
                rx="3"
                fill="currentColor"
                opacity="0.5"
              />
            ))}
          </g>
        ))
      ) : preview === "ranked" ? (
        [0, 1, 2].map((row) => (
          <g key={row} opacity={0.65 - row * 0.15}>
            <rect x="0" y={row * 22 + 5} width="64" height="7" rx="3" fill="currentColor" />
            <rect
              x="76"
              y={row * 22 + 5}
              width="28"
              height="7"
              rx="3"
              fill="currentColor"
              opacity="0.5"
            />
            <path
              d={`M120 ${row * 22 + 12}L132 ${row * 22 + 6}L144 ${row * 22 + 10}L156 ${row * 22 + 3}L168 ${row * 22 + 8}L180 ${row * 22 + 2}`}
              stroke="currentColor"
              strokeWidth="1.5"
              fill="none"
            />
          </g>
        ))
      ) : (
        [0, 1, 2].map((index) => (
          <g key={index} opacity={0.6 - index * 0.15}>
            <rect x="0" y={index * 22 + 2} width="12" height="12" rx="3" fill="currentColor" />
            <rect
              x="22"
              y={index * 22 + 5}
              width={90 - index * 10}
              height="6"
              rx="3"
              fill="currentColor"
              opacity="0.4"
            />
            <rect
              x="148"
              y={index * 22 + 5}
              width="30"
              height="6"
              rx="3"
              fill="currentColor"
              opacity="0.4"
            />
          </g>
        ))
      )}
    </svg>
  );
}
