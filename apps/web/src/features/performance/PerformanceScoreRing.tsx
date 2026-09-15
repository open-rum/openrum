import { useId } from "react";
import { useChartMotion } from "@/lib/charts/useChartMotion";
import { vitalSeries } from "./combinedTrend";
import { performanceScoreWeights, type overallPerformanceScore } from "./score";

const ringOrder = ["LCP", "FCP", "INP", "CLS", "TTFB"] as const;
const ringSectors = ringOrder.map((name, index) => ({
  name,
  angle: (performanceScoreWeights[name] / 100) * 360,
  startAngle:
    -90 +
    (ringOrder.slice(0, index).reduce((total, name) => total + performanceScoreWeights[name], 0) /
      100) *
      360,
}));
const center = { x: 120, y: 106 };
const radius = 68;

function point(angle: number, distance: number) {
  const radians = (angle * Math.PI) / 180;
  return {
    x: Number((center.x + distance * Math.cos(radians)).toFixed(2)),
    y: Number((center.y + distance * Math.sin(radians)).toFixed(2)),
  };
}

/** Fixed weighted sectors show earned scores; missing values retain neutral tracks. */
export function PerformanceScoreRing({
  scoring,
}: {
  scoring: ReturnType<typeof overallPerformanceScore>;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const animate = useChartMotion();
  return (
    <svg
      className="performance-score-dial"
      viewBox="0 0 240 220"
      role="img"
      aria-label={`性能评分 ${scoring.score ?? "暂无数据"} / 100`}
      aria-describedby={descriptionId}
      data-animate={animate}
    >
      <title id={titleId}>性能评分 {scoring.score ?? "暂无数据"} / 100</title>
      <desc id={descriptionId}>
        五项整体 P75 加权评分。环段大小表示默认权重，彩色部分表示单项得分比例。
        {scoring.metrics
          .map(
            ({ name, score, weight }) =>
              `${name}（权重 ${weight}%）：${score === null ? "暂无数据" : `${score} 分`}`,
          )
          .join("；")}
        。
        {!scoring.complete
          ? "数据不完整或样本不足，仅供参考；缺失项保留灰色环段，总分按可用项权重重新归一。"
          : ""}
      </desc>
      {ringSectors.map(({ name, angle, startAngle }) => {
        const metric = scoring.metrics.find((metric) => metric.name === name)!;
        const color = vitalSeries.find((series) => series.name === name)!.color;
        const start = point(startAngle + 1.5, radius);
        const end = point(startAngle + angle - 1.5, radius);
        const label = point(startAngle + angle / 2, 94);
        const path = `M ${start.x} ${start.y} A ${radius} ${radius} 0 0 1 ${end.x} ${end.y}`;
        return (
          <g key={name} data-score-metric={name} data-score-weight={metric.weight}>
            <title>
              {name} · 权重 {metric.weight}% · P75{" "}
              {metric.score === null ? "暂无数据" : `${metric.score} / 100`}
            </title>
            <path className="performance-score-track" d={path} />
            {metric.score !== null ? (
              <path
                key={metric.score}
                className="performance-score-arc"
                d={path}
                pathLength={100}
                stroke={color}
                strokeDasharray={`${metric.score} 100`}
              />
            ) : null}
            <text
              className="performance-score-label"
              x={label.x}
              y={label.y}
              textAnchor="middle"
              dominantBaseline="middle"
            >
              {name}
            </text>
          </g>
        );
      })}
      <text
        className="performance-score-total"
        x={center.x}
        y={center.y}
        textAnchor="middle"
        dominantBaseline="central"
      >
        {scoring.score ?? "—"}
      </text>
    </svg>
  );
}
