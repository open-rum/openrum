import { useMemo } from "react";
import { ChartCard } from "@/components/charts/ChartCard";
import { PlotChart } from "@/components/charts/PlotChart";
import type { APITrendPoint } from "@/lib/api/apis";
import { apiLatencyPlot, apiRequestsPlot, apiStatusPlot, type ApiTrendRange } from "./plotData";

/**
 * Request count, request time and response status for the current filter, side by side in
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
  const status = useMemo(() => apiStatusPlot(trend, range), [trend, range]);
  return (
    <div className="api-charts">
      <ChartCard
        id="api-requests-title"
        title="请求数"
        info={
          <>
            <p>{scope}的请求次数与失败请求次数（5xx 和网络失败，不含 4xx），成功率读右侧坐标轴。</p>
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
        id="api-status-title"
        title="状态码"
        info={
          <p>
            {scope}
            的响应状态，按类别堆叠：成功、4xx、5xx、网络错误（没有收到响应）。每根柱的高度就是该时段的请求数。
          </p>
        }
      >
        <PlotChart data={status} view="stacked-bar" title="状态码" compact />
      </ChartCard>
    </div>
  );
}
