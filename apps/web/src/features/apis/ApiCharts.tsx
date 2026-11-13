import { useMemo } from "react";
import { ChartCard } from "@/components/charts/ChartCard";
import { PlotChart } from "@/components/charts/PlotChart";
import type { APITrendPoint } from "@/lib/api/apis";
import {
  apiErrorsPlot,
  apiLatencyPlot,
  apiRequestsPlot,
  hasApiErrors,
  type ApiTrendRange,
} from "./plotData";

/**
 * Request count, request time and failed responses for the current filter, side by side in
 * cards of one height. The same three charts describe every endpoint together and a single
 * endpoint, so the page reads the same wherever you are.
 */
export function ApiCharts({
  trend,
  range,
  scope,
}: {
  trend: readonly APITrendPoint[];
  range: ApiTrendRange;
  /** What the charts cover, for the cards' explanations: "全部 endpoint" or "该 endpoint". */
  scope: string;
}) {
  const requests = useMemo(() => apiRequestsPlot(trend, range), [trend, range]);
  const latency = useMemo(() => apiLatencyPlot(trend, range), [trend, range]);
  const errors = useMemo(() => apiErrorsPlot(trend, range), [trend, range]);
  return (
    <div className="api-charts">
      <ChartCard
        id="api-requests-title"
        title="请求数"
        info={
          <>
            <p>{scope}的请求次数，失败率（5xx 和网络失败，不含 4xx）读右侧坐标轴。</p>
            <p>次数按采样事件计数。{requests.edgeNote ? `${requests.edgeNote}。` : ""}</p>
          </>
        }
      >
        <PlotChart data={requests} view="line" title="请求数" compact />
      </ChartCard>
      <ChartCard
        id="api-latency-title"
        title="请求耗时"
        info={
          <>
            <p>{scope}的请求耗时：中位数、P75 和 P95。</p>
            <p>
              各时间桶独立计算分位数，不能相加或平均。
              {latency.edgeNote ? `${latency.edgeNote}。` : ""}
            </p>
          </>
        }
      >
        <PlotChart data={latency} view="line" title="请求耗时" compact />
      </ChartCard>
      <ChartCard
        id="api-errors-title"
        title="异常响应"
        info={
          <p>
            {scope}
            没有成功的请求，按类别堆叠：4xx、5xx、网络错误（没有收到响应）。成功的请求不在图里，数量见请求数。
          </p>
        }
      >
        {/* No requests at all is the chart's own empty state; requests without a single
            error is good news and says so. */}
        {errors.empty || hasApiErrors(trend) ? (
          <PlotChart data={errors} view="stacked-bar" title="异常响应" compact />
        ) : (
          <p className="api-charts__none">这段时间没有 4xx、5xx 或网络错误。</p>
        )}
      </ChartCard>
    </div>
  );
}
