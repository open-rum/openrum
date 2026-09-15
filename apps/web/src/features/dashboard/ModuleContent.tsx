import { Component, type ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { HTTPError } from "@/lib/auth/session";
import type { OverviewFilters } from "@/lib/filters/schema";
import { moduleRegistry } from "./registry";
import { readWidget, type StoredWidget, type Widget } from "./model";
import type { ModuleQuery } from "./queries";
import { ModuleDetailContent } from "./ModuleDetails";

export function ModuleContent({
  record,
  query,
  filters,
  detailed = false,
}: {
  record: StoredWidget;
  query?: ModuleQuery;
  filters: OverviewFilters;
  detailed?: boolean;
}) {
  const widget = readWidget(record);
  if (!widget)
    return (
      <Alert>
        <AlertTitle>此模块暂不可用</AlertTitle>
        <AlertDescription>
          当前版本不支持该模块或其配置。配置已保留，可在编辑模式移除它。
        </AlertDescription>
      </Alert>
    );
  if (query?.isError)
    return (
      <Alert variant="destructive">
        <AlertTitle>模块数据暂不可用</AlertTitle>
        <AlertDescription>
          <span>
            {query.error instanceof HTTPError
              ? query.error.code === "QUERY_TOO_EXPENSIVE"
                ? "查询超出预算，请缩短时间范围或增加筛选。"
                : query.error.message
              : "无法完成查询，请稍后重试。"}
          </span>
          <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
            重试
          </Button>
        </AlertDescription>
      </Alert>
    );
  if (!query?.data)
    return (
      <Skeleton
        className={widget.type === "stat" ? "h-24 w-full" : "h-64 w-full"}
        aria-label="正在加载模块"
      />
    );
  return (
    <ModuleBoundary key={`${widget.id}-${JSON.stringify(widget)}-${query.dataUpdatedAt}`}>
      {detailed ? (
        <ModuleDetailContent widget={widget} data={query.data} filters={filters} />
      ) : (
        <ResolvedModule widget={widget} data={query.data} filters={filters} />
      )}
    </ModuleBoundary>
  );
}

function ResolvedModule({
  widget,
  data,
  filters,
}: {
  widget: Widget;
  data: NonNullable<ModuleQuery["data"]>;
  filters: OverviewFilters;
}) {
  const definition = moduleRegistry[widget.type];
  const Render = definition.Render;
  return <Render widget={widget} data={definition.adapt(widget, data, filters)} />;
}

class ModuleBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <Alert variant="destructive">
        <AlertTitle>模块暂时无法显示</AlertTitle>
        <AlertDescription>
          <span>其余模块仍可使用，配置已保留。</span>
          <Button size="sm" variant="outline" onClick={() => this.setState({ failed: false })}>
            重新显示
          </Button>
        </AlertDescription>
      </Alert>
    ) : (
      this.props.children
    );
  }
}
