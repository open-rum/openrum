import { useId, useState } from "react";
import { useChartMotion } from "@/lib/charts/useChartMotion";
import { scoreRating, type overallPerformanceScore, type PerformanceRating } from "./score";

const center = 150;
const radius = 96;
// Round caps reach past each end, so the gap leaves room for them.
const gap = 9;

/** Lighthouse's colours: 90+ good, 50–89 needs improvement, below 50 poor. */
const ratingColor: Record<PerformanceRating, string> = {
  good: "var(--color-success)",
  "needs-improvement": "var(--color-warning)",
  poor: "var(--color-error)",
  unknown: "var(--color-base-300)",
};

function at(distance: number, angle: number) {
  const radians = (angle * Math.PI) / 180;
  return {
    x: Number((center + Math.cos(radians) * distance).toFixed(2)),
    y: Number((center + Math.sin(radians) * distance).toFixed(2)),
  };
}

/**
 * A Lighthouse-style ring: one sector per metric, sized by weight and filled by score in the
 * score's own red, amber or green. Pointing at or focusing a sector shows how many points it
 * adds to the total. Missing values keep a neutral track.
 */
export function PerformanceScoreRing({
  scoring,
}: {
  scoring: ReturnType<typeof overallPerformanceScore>;
}) {
  const descriptionId = useId();
  const animate = useChartMotion();
  const [active, setActive] = useState<string | null>(null);
  const availableWeight = scoring.metrics.reduce(
    (total, { score, weight }) => total + (score === null ? 0 : weight),
    0,
  );
  const sectors = scoring.metrics.map((metric, index) => {
    const before = scoring.metrics.slice(0, index).reduce((total, { weight }) => total + weight, 0);
    const angle = -90 + (before / 100) * 360;
    const sweep = (metric.weight / 100) * 360;
    const start = at(radius, angle + gap / 2);
    const end = at(radius, angle + sweep - gap / 2);
    const middle = ((angle + sweep / 2) * Math.PI) / 180;
    const cos = Math.cos(middle);
    const sin = Math.sin(middle);
    return {
      ...metric,
      color: ratingColor[scoreRating(metric.score)],
      // Points this metric adds to the total, on the same renormalised weights.
      contribution:
        metric.score === null || !availableWeight
          ? null
          : Math.round((metric.score * metric.weight) / availableWeight),
      path: `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${sweep - gap > 180 ? 1 : 0} 1 ${end.x} ${end.y}`,
      x: Number((center + cos * (radius + 22)).toFixed(2)),
      y: Number((center + sin * (radius + 22)).toFixed(2)),
      anchor: (Math.abs(cos) < 0.25 ? "middle" : cos > 0 ? "start" : "end") as
        "middle" | "start" | "end",
    };
  });
  const focused = sectors.find(({ name }) => name === active);
  const totalColor = ratingColor[scoreRating(scoring.score)];
  return (
    <svg
      className="performance-score-ring"
      // The ring spans 54–246; the margin holds the labels outside it.
      viewBox="-30 10 360 280"
      role="img"
      aria-label={`性能评分 ${scoring.score ?? "暂无数据"} / 100`}
      aria-describedby={descriptionId}
      data-animate={animate}
      data-active={active ?? undefined}
    >
      <desc id={descriptionId}>
        环段长度表示权重，填色比例表示单项得分，颜色按得分区间显示。
        {sectors
          .map(
            ({ name, score, weight, contribution }) =>
              `${name}（权重 ${weight}%）：${score === null ? "暂无数据" : `${score} 分，贡献 ${contribution} 分`}`,
          )
          .join("；")}
        。
        {!scoring.complete
          ? "数据不完整或样本不足，仅供参考；缺失项保留灰色环段，总分按可用项权重重新归一。"
          : ""}
      </desc>
      <circle
        className="performance-ring-disc"
        cx={center}
        cy={center}
        r={radius - 14}
        fill={focused ? focused.color : totalColor}
      />
      {sectors.map(({ name, weight, score, color, contribution, path, x, y, anchor }) => (
        <g
          key={name}
          className="performance-ring-sector"
          data-score-metric={name}
          data-score-weight={weight}
          data-active={active === name ? "" : undefined}
          tabIndex={0}
          aria-label={`${name} · 权重 ${weight}% · ${score === null ? "暂无数据" : `${score} 分，贡献 +${contribution}`}`}
          onPointerEnter={() => setActive(name)}
          onPointerLeave={() => setActive(null)}
          onFocus={() => setActive(name)}
          onBlur={() => setActive(null)}
        >
          {/* A wide invisible stroke makes the thin ring easy to point at. */}
          <path className="performance-ring-hit" d={path} />
          <path className="performance-ring-track" d={path} stroke={color} />
          {score === null ? null : (
            <path
              key={score}
              className="performance-ring-score"
              d={path}
              pathLength={100}
              stroke={color}
              strokeDasharray={`${score} 100`}
            />
          )}
          <text
            className="performance-ring-name"
            x={x}
            y={y}
            textAnchor={anchor}
            dominantBaseline="central"
          >
            {name}
          </text>
        </g>
      ))}
      {focused ? (
        <>
          <text
            className="performance-ring-contribution"
            x={center}
            y={center - 8}
            textAnchor="middle"
            dominantBaseline="central"
            fill={focused.color}
          >
            {focused.contribution === null ? "—" : `+${focused.contribution}`}
          </text>
          <text className="performance-ring-caption" x={center} y={center + 26} textAnchor="middle">
            {focused.name} · {focused.score === null ? "暂无数据" : `${focused.score} 分`} · 权重{" "}
            {focused.weight}%
          </text>
        </>
      ) : (
        <text
          className="performance-ring-total"
          x={center}
          y={center}
          textAnchor="middle"
          dominantBaseline="central"
          fill={scoring.score === null ? "currentColor" : totalColor}
        >
          {scoring.score ?? "—"}
        </text>
      )}
    </svg>
  );
}
