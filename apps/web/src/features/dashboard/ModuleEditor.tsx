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
import { useModulePreview } from "./queries";
import { widgetSchema, widgetDescription, type Widget, type WidgetType } from "./model";

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
  const [group, setGroup] = useState("全部");
  const dirty = widget !== null && JSON.stringify(widget) !== JSON.stringify(initial ?? null);
  const parsed = widget ? widgetSchema.safeParse(widget) : undefined;
  const definition = widget ? moduleRegistry[widget.type] : undefined;
  const Editor = definition?.Editor;
  const modules = Object.values(moduleRegistry).filter(
    (module) =>
      (group === "全部" || module.group === group) &&
      `${module.name}${module.description}`.toLowerCase().includes(search.toLowerCase()),
  );
  const close = () => (dirty ? setDiscard(true) : onClose());
  return (
    <>
      <Sheet
        open
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <SheetContent style={{ width: "min(100vw, 520px)", maxWidth: "none" }}>
          <SheetHeader className="shrink-0 pr-12">
            <SheetTitle>{widget ? (initial ? "配置模块" : "添加模块") : "模块库"}</SheetTitle>
            <SheetDescription>
              {widget
                ? "配置数据与展示，预览后添加到概览草稿。"
                : "选择你关心的数据，组合自己的项目概览。"}
            </SheetDescription>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 pb-4">
            {!widget ? (
              <>
                <Input
                  aria-label="搜索模块"
                  placeholder="搜索指标、趋势、分布…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <ToggleGroup
                  type="single"
                  value={group}
                  onValueChange={(value) => {
                    if (value) setGroup(value);
                  }}
                  aria-label="模块分类"
                >
                  {["全部", "指标", "趋势", "分布", "列表"].map((value) => (
                    <ToggleGroupItem key={value} value={value}>
                      {value}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <div className="grid gap-3 sm:grid-cols-2">
                  {modules.map((module) => (
                    <button
                      key={module.type}
                      type="button"
                      onClick={() => setWidget(module.create())}
                      className="dashboard-catalog-item text-left"
                      aria-label={`添加${module.name}`}
                    >
                      <Card className="h-full">
                        <CardHeader>
                          <CardTitle>
                            <span className="flex items-center gap-2">
                              <module.icon className="size-4 text-muted-foreground" />
                              {module.name}
                            </span>
                          </CardTitle>
                          <CardDescription>{module.description}</CardDescription>
                        </CardHeader>
                        <CardContent className="mt-auto">
                          <ModuleMiniature type={module.type} />
                        </CardContent>
                      </Card>
                    </button>
                  ))}
                </div>
                {!modules.length ? (
                  <Empty>
                    <EmptyHeader>
                      <EmptyTitle>没有匹配的模块</EmptyTitle>
                    </EmptyHeader>
                  </Empty>
                ) : null}
              </>
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
                {parsed?.success ? (
                  <Preview widget={parsed.data} filters={filters} userId={userId} />
                ) : (
                  <p role="status" className="text-sm text-destructive">
                    {parsed && !parsed.success
                      ? parsed.error.issues[0]?.message
                      : "请完成模块配置。"}
                  </p>
                )}
              </>
            )}
          </div>
          <SheetFooter className="shrink-0 border-t">
            {widget ? (
              <Button
                disabled={!parsed?.success}
                onClick={() => {
                  if (parsed?.success) onApply(parsed.data);
                }}
              >
                <PlusIcon data-icon="inline-start" />
                {initial ? "应用修改" : "添加到概览"}
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
            <AlertDialogDescription>尚未应用到概览的模块配置将被丢弃。</AlertDialogDescription>
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
      <Card>
        <CardHeader>
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

function ModuleMiniature({ type }: { type: WidgetType }) {
  return (
    <svg viewBox="0 0 180 64" className="h-16 w-full text-primary" aria-hidden="true">
      {type === "stat" ? (
        <>
          <rect x="0" y="8" width="84" height="24" rx="4" fill="currentColor" opacity="0.6" />
          <rect x="0" y="44" width="44" height="6" rx="3" fill="currentColor" opacity="0.2" />
          <rect x="52" y="44" width="62" height="6" rx="3" fill="currentColor" opacity="0.12" />
        </>
      ) : type === "timeseries" ? (
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
      ) : type === "breakdown" ? (
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
