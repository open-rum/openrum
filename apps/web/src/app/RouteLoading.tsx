import { ConsolePage } from "@/components/layout/ConsolePage";
import { Skeleton } from "@/components/ui/skeleton";

/** Keeps the Console frame visible while a route's code is loaded. */
export function RouteLoading() {
  return (
    <ConsolePage width="fluid" aria-label="正在加载页面" aria-busy="true">
      <div className="route-loading" role="status" aria-live="polite">
        <span className="route-loading__indicator" aria-hidden="true" />
        <span>正在加载页面…</span>
      </div>
      <div className="route-loading__skeletons" aria-hidden="true">
        <Skeleton className="h-8 w-44" />
        <Skeleton className="h-4 w-72 max-w-full" />
        <Skeleton className="mt-3 h-24 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    </ConsolePage>
  );
}
