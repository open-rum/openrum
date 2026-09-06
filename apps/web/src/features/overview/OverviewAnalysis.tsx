import type { OverviewResponse } from "@/lib/api/client";
import type { OverviewFilters } from "@/lib/filters/schema";
import { QualityTrend } from "./QualityTrend";
import { SlowApis } from "./SlowApis";
import { TopIssues } from "./TopIssues";

export default function OverviewAnalysis({
  data,
  filters,
}: {
  data: OverviewResponse;
  filters: OverviewFilters;
}) {
  return (
    <div className="flex flex-col gap-4">
      <QualityTrend data={data} />
      <div className="grid gap-4 xl:grid-cols-2">
        <TopIssues issues={data.topIssues} filters={filters} />
        <SlowApis apis={data.slowApis} filters={filters} />
      </div>
    </div>
  );
}
