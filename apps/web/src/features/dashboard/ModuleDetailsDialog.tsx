import type { RefObject } from "react";
import { ChartNoAxesCombinedIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { OverviewFilters } from "@/lib/filters/schema";
import { ModuleContent } from "./ModuleContent";
import { readWidget, widgetDescription, type StoredWidget } from "./model";
import type { ModuleQuery } from "./queries";

/** Dashboard-only detail surface. Shared Dialog primitives keep their normal motion. */
export function ModuleDetailsDialog({
  record,
  query,
  filters,
  sourceRef,
}: {
  record: StoredWidget;
  query?: ModuleQuery;
  filters: OverviewFilters;
  sourceRef: RefObject<HTMLDivElement | null>;
}) {
  const widget = readWidget(record);
  const title = typeof record.title === "string" ? record.title : "模块";

  return (
    <DialogContent
      className="dashboard-detail-dialog gap-0 p-0 sm:max-w-[1160px]"
      showCloseButton={false}
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        sourceRef.current?.querySelector<HTMLButtonElement>(".dashboard-settings-trigger")?.focus();
      }}
    >
      <DialogHeader className="dashboard-detail-header">
        <div className="flex min-w-0 items-center gap-3">
          <span className="dashboard-detail-icon" aria-hidden="true">
            <ChartNoAxesCombinedIcon className="size-5" />
          </span>
          <div className="flex min-w-0 flex-col gap-2">
            <DialogTitle className="text-xl leading-snug">{title} 详情</DialogTitle>
            <DialogDescription>
              {widget ? widgetDescription(widget) : "当前筛选范围内的详细数据"}
            </DialogDescription>
          </div>
        </div>
        <DialogClose asChild>
          <Button variant="ghost" size="icon" className="shrink-0" aria-label="关闭详情">
            <XIcon />
          </Button>
        </DialogClose>
      </DialogHeader>
      <div className="dashboard-detail-body">
        <ModuleContent record={record} query={query} filters={filters} detailed />
      </div>
    </DialogContent>
  );
}
