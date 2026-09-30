import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";
import {
  BAR_RADIUS_TOP,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "./chart";

const visits = [
  { day: "Mon", web: 1860, mobile: 1240 },
  { day: "Tue", web: 2280, mobile: 1580 },
  { day: "Wed", web: 2030, mobile: 1360 },
  { day: "Thu", web: 2780, mobile: 1810 },
  { day: "Fri", web: 2460, mobile: 1640 },
  { day: "Sat", web: 3180, mobile: 2020 },
  { day: "Sun", web: 3560, mobile: 2350 },
];
const latency = visits.map((row, index) => ({
  day: row.day,
  p50: [124, 142, 136, 164, 138, 152, 128][index],
  previous: [165, 186, 142, 228, 174, 212, 152][index],
}));
const trafficConfig = {
  web: { label: "Web", color: "var(--ds-chart-1)" },
  mobile: { label: "Mobile web", color: "var(--ds-chart-2)" },
} satisfies ChartConfig;
const latencyConfig = {
  p50: { label: "本周期 P50", color: "var(--ds-chart-1)" },
  previous: { label: "上周期 P50", color: "var(--ds-chart-comparison)" },
} satisfies ChartConfig;
const xAxis = {
  dataKey: "day",
  tickLine: false,
  axisLine: false,
  tickMargin: 10,
  minTickGap: 0,
  padding: { left: 10, right: 10 },
};
const grid = <CartesianGrid vertical={false} strokeDasharray="3 4" />;

export default function ChartExamples() {
  return (
    <div className="ds-chart-board">
      <div className="ds-chart-grid">
        <figure className="ds-chart-card">
          <figcaption>
            <span>01 / AREA</span>
            <h3>访问趋势</h3>
            <p>柠檬绿主系列，蓝绿辅助系列，浅色填充表现体量。</p>
          </figcaption>
          <ChartContainer config={trafficConfig} className="ds-chart" id="design-area">
            <AreaChart
              accessibilityLayer
              data={visits}
              margin={{ left: 0, right: 8, top: 12, bottom: 0 }}
            >
              {grid}
              <XAxis {...xAxis} />
              <YAxis hide domain={[0, 4000]} />
              <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
              <Area
                dataKey="mobile"
                type="monotone"
                fill="var(--color-mobile)"
                fillOpacity={0.08}
                stroke="var(--color-mobile)"
                strokeWidth={1.5}
                isAnimationActive={false}
              />
              <Area
                dataKey="web"
                type="monotone"
                fill="var(--ds-chart-area)"
                fillOpacity={0.23}
                stroke="var(--color-web)"
                strokeWidth={2}
                isAnimationActive={false}
              />
            </AreaChart>
          </ChartContainer>
          <div className="ds-chart-legend">
            <span>
              <i />
              Web
            </span>
            <span>
              <i />
              Mobile web
            </span>
            <em>单位：页面浏览</em>
          </div>
        </figure>
        <figure className="ds-chart-card">
          <figcaption>
            <span>02 / BAR</span>
            <h3>每日访问对比</h3>
            <p>同一单位、同一基线，直接比较大小。</p>
          </figcaption>
          <ChartContainer config={trafficConfig} className="ds-chart" id="design-bar">
            <BarChart
              accessibilityLayer
              data={visits}
              barGap={3}
              margin={{ left: 0, right: 8, top: 12, bottom: 0 }}
            >
              {grid}
              <XAxis {...xAxis} />
              <YAxis hide domain={[0, 4000]} />
              <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
              <Bar
                dataKey="web"
                fill="var(--color-web)"
                radius={BAR_RADIUS_TOP}
                isAnimationActive={false}
              />
              <Bar
                dataKey="mobile"
                fill="var(--color-mobile)"
                fillOpacity={0.55}
                radius={BAR_RADIUS_TOP}
                isAnimationActive={false}
              />
            </BarChart>
          </ChartContainer>
          <div className="ds-chart-legend">
            <span>
              <i />
              Web
            </span>
            <span>
              <i />
              Mobile web
            </span>
            <em>单位：页面浏览</em>
          </div>
        </figure>
        <figure className="ds-chart-card">
          <figcaption>
            <span>03 / LINE</span>
            <h3>响应耗时</h3>
            <p>同一指标按周期对比：柠檬绿实线与淡黄虚线。</p>
          </figcaption>
          <ChartContainer config={latencyConfig} className="ds-chart" id="design-line">
            <LineChart
              accessibilityLayer
              data={latency}
              margin={{ left: 0, right: 8, top: 12, bottom: 0 }}
            >
              {grid}
              <XAxis {...xAxis} />
              <YAxis hide domain={[0, 400]} />
              <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
              <Line
                dataKey="p50"
                type="monotone"
                stroke="var(--color-p50)"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                dataKey="previous"
                type="monotone"
                stroke="var(--color-previous)"
                strokeWidth={2}
                strokeDasharray="5 4"
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ChartContainer>
          <div className="ds-chart-legend">
            <span>
              <i />
              本周期 P50
            </span>
            <span>
              <i style={{ background: "var(--ds-chart-comparison)" }} />
              上周期 P50
            </span>
            <em>单位：毫秒</em>
          </div>
        </figure>
      </div>
      <details className="ds-data-table">
        <summary>查看图表示例数据</summary>
        <div>
          <table>
            <caption>仅用于设计预览，不代表线上数据。</caption>
            <thead>
              <tr>
                <th>日期</th>
                <th>Web 页面浏览</th>
                <th>Mobile web 页面浏览</th>
                <th>本周期 P50 / ms</th>
                <th>上周期 P50 / ms</th>
              </tr>
            </thead>
            <tbody>
              {visits.map((row, index) => (
                <tr key={row.day}>
                  <th>{row.day}</th>
                  <td>{row.web}</td>
                  <td>{row.mobile}</td>
                  <td>{latency[index].p50}</td>
                  <td>{latency[index].previous}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
