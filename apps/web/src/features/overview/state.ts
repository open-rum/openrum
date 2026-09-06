import type { OverviewResponse } from "@/lib/api/client";

export function isOverviewEmpty(data: OverviewResponse) {
  return (
    data.kpis.pageViews.samples === 0 &&
    data.kpis.errorRate.numeratorSamples === 0 &&
    data.kpis.apiFailureRate.denominatorSamples === 0
  );
}
