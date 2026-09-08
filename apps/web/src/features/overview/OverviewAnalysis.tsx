import type { OverviewResponse } from "@/lib/api/client";
import type { OverviewFilters } from "@/lib/filters/schema";
import { SlowApis } from "./SlowApis";
import { StabilityTrend } from "./StabilityTrend";
import { TopIssues } from "./TopIssues";
import { TrafficTrend } from "./TrafficTrend";
import { TrendTable } from "./TrendTable";
import { VitalsTrend } from "./VitalsTrend";

export default function OverviewAnalysis({
  data,
  filters,
}: {
  data: OverviewResponse;
  filters: OverviewFilters;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 xl:grid-cols-2">
        <TrafficTrend series={data.series} />
        <StabilityTrend series={data.series} />
      </div>
      <VitalsTrend series={data.series} kpis={data.kpis} />
      <TrendTable series={data.series} />
      <div className="grid gap-4 xl:grid-cols-2">
        <TopIssues issues={data.topIssues} filters={filters} />
        <SlowApis apis={data.slowApis} filters={filters} />
      </div>
    </div>
  );
}
