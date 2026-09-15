import type { ReactNode } from "react";
import type { ComponentProps } from "react";
import { PanelLeftOpen, SlidersHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { cn } from "@/lib/utils";

type ConsolePageWidth = "fluid" | "wide" | "narrow";

const widthClasses: Record<ConsolePageWidth, string> = {
  fluid: "max-w-none",
  wide: "max-w-[1280px]",
  narrow: "max-w-[1024px]",
};

export function ConsolePage({
  width = "wide",
  rail,
  railLabel = "页面导航",
  children,
  className,
  ...props
}: Omit<ComponentProps<"section">, "children"> & {
  width?: ConsolePageWidth;
  rail?: ReactNode;
  railLabel?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cn("w-full px-4 py-6 sm:px-6 lg:px-8 lg:py-8", className)}
      data-console-page=""
      data-width={width}
      {...props}
    >
      {rail ? (
        <div className="mb-5 lg:hidden">
          <Drawer direction="left">
            <DrawerTrigger asChild>
              <Button type="button" variant="outline">
                <PanelLeftOpen data-icon="inline-start" />
                {railLabel}
              </Button>
            </DrawerTrigger>
            <DrawerContent>
              <DrawerHeader>
                <DrawerTitle>{railLabel}</DrawerTitle>
                <DrawerDescription>选择当前页面的分区或视图。</DrawerDescription>
              </DrawerHeader>
              <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">{rail}</div>
            </DrawerContent>
          </Drawer>
        </div>
      ) : null}

      <div
        className={cn(
          "grid min-w-0",
          rail ? "gap-8 lg:grid-cols-[208px_minmax(0,1fr)]" : "grid-cols-1",
        )}
      >
        {rail ? (
          <aside className="hidden min-w-0 lg:block" aria-label={railLabel}>
            {rail}
          </aside>
        ) : null}
        <div
          className={cn(
            "flex w-full min-w-0 flex-col gap-6",
            widthClasses[width],
            !rail && "mx-auto",
          )}
        >
          {children}
        </div>
      </div>
    </section>
  );
}

export function ConsolePageRail({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("flex min-w-0 flex-col gap-5", className)}>{children}</div>;
}

export function ConsolePageHeader({
  title,
  description,
  actions,
  back,
  titleId,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: ReactNode;
  titleId?: string;
  className?: string;
}) {
  return (
    <header className={cn("flex min-w-0 flex-col gap-2", className)} data-console-page-header="">
      {back ? <div className="mb-1">{back}</div> : null}
      <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1
            id={titleId}
            className="text-2xl leading-tight font-semibold tracking-tight text-foreground"
          >
            {title}
          </h1>
          {description ? (
            <div className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              {description}
            </div>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2" data-console-page-actions="">
            {actions}
          </div>
        ) : null}
      </div>
    </header>
  );
}

export function ConsolePageTabs({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 border-b border-border", className)} data-console-page-tabs="">
      {children}
    </div>
  );
}

export function ConsoleFilterBar({
  primary,
  secondary,
  sticky = false,
  mobileSecondaryLabel = "更多筛选",
  className,
}: {
  primary?: ReactNode;
  secondary?: ReactNode;
  sticky?: boolean;
  mobileSecondaryLabel?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3 shadow-(--shadow-control)",
        sticky && "sticky top-[74px] z-20",
        className,
      )}
      data-console-filter-bar=""
    >
      {primary ? (
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{primary}</div>
      ) : null}
      {secondary ? (
        <>
          <div className="ml-auto hidden flex-wrap items-center justify-end gap-2 md:flex">
            {secondary}
          </div>
          <div className="ml-auto md:hidden">
            <Drawer>
              <DrawerTrigger asChild>
                <Button type="button" variant="outline">
                  <SlidersHorizontal data-icon="inline-start" />
                  {mobileSecondaryLabel}
                </Button>
              </DrawerTrigger>
              <DrawerContent>
                <DrawerHeader>
                  <DrawerTitle>{mobileSecondaryLabel}</DrawerTitle>
                  <DrawerDescription>调整当前页面的辅助筛选条件。</DrawerDescription>
                </DrawerHeader>
                <div className="flex flex-col gap-3 px-4 pb-6">{secondary}</div>
              </DrawerContent>
            </Drawer>
          </div>
        </>
      ) : null}
    </div>
  );
}

export function ConsolePageContent({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)} data-console-page-content="">
      {children}
    </div>
  );
}
